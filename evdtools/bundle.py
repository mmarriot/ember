"""Write and read .evdb bundles; docs/format.md is the format.

    "EVDB" | u32 version | u32 header length | header JSON     (padded so that the next byte is 8-aligned)
    record | record | ...                                      (each one gzip member: events and per-run records)
    index JSON                                                 (where each record is, and the rows of its tables)
    u64 index offset | u32 index length | "EVDB"

A record is "EVD1" | u32 length | JSON of where each array is | the arrays, each 8-aligned. Tables are held as
{name: (rows, {column: array})}, relations as {name: {"offsets", "indices", "weights": {name: array}}}.
"""

import collections
import gzip
import json
import os
import struct
from concurrent.futures import ThreadPoolExecutor

import numpy as np

MAGIC, RECORD_MAGIC, VERSION = b"EVDB", b"EVD1", 1
TYPES = {  # evd column type -> numpy dtype (little-endian)
    "f32": "<f4",
    "f64": "<f8",
    "i8": "<i1",
    "u8": "<u1",
    "i16": "<i2",
    "u16": "<u2",
    "i32": "<i4",
    "u32": "<u4",
    "i64": "<i8",
    "u64": "<u8",
}
RELATION_TYPES = {"offsets": "<u4", "indices": "<u4", "weights": "<f4"}


def type_code(dtype):
    """The evd type code of a numpy dtype (booleans are stored as u8)."""
    dt = np.dtype(dtype)
    if dt.kind == "b":
        return "u8"
    return {"f": "f", "i": "i", "u": "u"}[dt.kind] + str(8 * dt.itemsize)


# Writing


class BundleWriter:
    """Writes a bundle to `path`. It is written to a temporary file that is renamed when the writer is closed, so
    readers never see a partial file; leaving the `with` block on an error removes it."""

    def __init__(self, path, header, compresslevel=4, sort=False, threads=1):
        """`header`: the header JSON (docs/format.md).
        `sort`: list the events in (run, lumi, event) order in the index, whatever order they were added in (records
        are found by offset, so this costs no I/O).
        `threads`: records are compressed on this many threads (zlib releases the interpreter lock) and written in
        the order they were added; `pool` is that thread pool, or None for one thread.
        `compresslevel` 4: on a PU200 event, half the time of level 6 for 0.3% more bytes."""
        self._path, self._tmp, self._level, self._sort = path, f"{path}.tmp{os.getpid()}", compresslevel, sort
        self._file = open(self._tmp, "wb")  # noqa: SIM115 (closed by close() or _abandon())
        head = _padded_json(header, 12)
        self._file.write(MAGIC + struct.pack("<II", VERSION, len(head)) + head)
        self._events, self._runs, self._run_info = [], [], {}
        self._threads, self.pool = threads, ThreadPoolExecutor(threads) if threads > 1 else None
        self._queue = collections.deque()  # (index entry, compressed record or its future), oldest first

    def add(self, event_id, tables, relations):
        """Add an event: `event_id` is (run, lumi, event)."""
        run, lumi, event = (int(x) for x in event_id)
        self._events.append({"run": run, "lumi": lumi, "event": event})
        self._write(self._events[-1], event_id, tables, relations)

    def add_run(self, run_id, tables, relations):
        """Add the per-run tables of a run, written once; readers add them to every event of that run. `run_id` is
        (run, 0, 0)."""
        self._runs.append({"run": int(run_id[0])})
        self._write(self._runs[-1], run_id, tables, relations)

    def runs(self):
        """The runs of the events added so far."""
        return {e["run"] for e in self._events}

    def set_run_info(self, info):
        """{run: {field: value}}: information about the runs (type, setup, beam, ...), stored in the index."""
        self._run_info = {int(r): dict(v) for r, v in info.items() if v}

    def close(self):
        """Write the remaining records and the index, and rename the file into place."""
        while self._queue:
            self._store_oldest()
        if self.pool:
            self.pool.shutdown()
        runs = {r["run"]: r for r in self._runs}
        for run, info in self._run_info.items():
            runs.setdefault(run, {"run": run})["info"] = info
        runs = [runs[r] for r in sorted(runs)]
        if self._sort:
            self._events.sort(key=lambda e: (e["run"], e["lumi"], e["event"]))
        index = json.dumps({"events": self._events, **({"runs": runs} if runs else {})}, separators=(",", ":")).encode()
        offset = self._file.tell()
        self._file.write(index + struct.pack("<QI", offset, len(index)) + MAGIC)
        self._file.close()
        os.replace(self._tmp, self._path)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        if exc_type is not None:
            self._abandon()
            return
        try:
            self.close()  # a record that failed to compress on a thread raises here
        except BaseException:
            self._abandon()
            raise

    def _write(self, entry, record_id, tables, relations):
        """Compress a record and append it to the file. Its index entry `entry` gets where the record is and the rows
        of each table. With threads, at most `threads` records wait (compressed or being compressed) before the
        oldest is written, which bounds the memory they hold."""
        entry.update(offset=0, length=0, counts={t: int(n) for t, (n, _) in tables.items()})
        if self.pool is None:
            return self._store(entry, _pack(self._level, record_id, tables, relations))
        self._queue.append((entry, self.pool.submit(_pack, self._level, record_id, tables, relations)))
        while len(self._queue) > self._threads:
            self._store_oldest()

    def _store_oldest(self):
        entry, blob = self._queue.popleft()
        self._store(entry, blob.result())

    def _store(self, entry, blob):
        entry.update(offset=self._file.tell(), length=len(blob))
        self._file.write(blob)

    def _abandon(self):
        """Stop writing and remove the temporary file."""
        if self.pool:
            self.pool.shutdown(cancel_futures=True)
        self._file.close()
        os.remove(self._tmp)


def encode_record(event_id, tables, relations):
    """The bytes of a record, before compression: its JSON (where each array is, as [offset, length] after the JSON)
    and the arrays, each at an 8-aligned offset so that a reader can view them in place."""
    arrays, size = [], 0

    def put(array, dtype):
        """Plan where `array` goes; returns its [offset, length]."""
        nonlocal size
        data = np.ascontiguousarray(array, dtype=dtype)  # the array itself when it already has this type
        size += -size % 8
        arrays.append((size, data))
        location = [size, len(data)]
        size += data.nbytes
        return location

    meta = {"event": [int(x) for x in event_id], "tables": {}, "relations": {}}
    for name, (n, columns) in tables.items():
        meta["tables"][name] = {
            "n": int(n),
            "columns": {c: put(a, TYPES[type_code(a.dtype)]) for c, a in columns.items()},
        }
    for name, rel in relations.items():
        meta["relations"][name] = {
            "offsets": put(rel["offsets"], RELATION_TYPES["offsets"]),
            "indices": put(rel["indices"], RELATION_TYPES["indices"]),
            "weights": {w: put(a, RELATION_TYPES["weights"]) for w, a in rel.get("weights", {}).items()},
        }
    header = _padded_json(meta, 8)
    base = 8 + len(header)

    # One buffer of the final size, each array copied into it once (zero-filled, which is the padding).
    record = bytearray(base + size)
    record[:base] = RECORD_MAGIC + struct.pack("<I", len(header)) + header
    for offset, data in arrays:
        if data.nbytes:
            record[base + offset : base + offset + data.nbytes] = data.view(np.uint8).data
    return record


def _pack(level, event_id, tables, relations):
    """A record as it is stored: one gzip member, with no timestamp, so that the same event always gives the same
    bytes."""
    return gzip.compress(encode_record(event_id, tables, relations), compresslevel=level, mtime=0)


def _padded_json(obj, starts_at):
    """Compact JSON bytes, padded with spaces so that the byte after them is 8-aligned when they start at byte
    `starts_at`."""
    data = json.dumps(obj, separators=(",", ":")).encode()
    return data + b" " * (-(starts_at + len(data)) % 8)


# Reading


class Bundle:
    """Random access to the events of a bundle file, which stays open."""

    def __init__(self, path):
        """Reads the header and the index; ValueError if the file is not a complete bundle."""
        self._file = open(path, "rb")  # noqa: SIM115 (kept open for random access to the records)
        try:
            magic, version, hlen = struct.unpack("<4sII", self._file.read(12))
            if magic != MAGIC or version != VERSION:
                raise ValueError(f"{path}: not an evd/{VERSION} bundle")
            self.header = json.loads(self._file.read(hlen))
            self._file.seek(-16, os.SEEK_END)
            offset, length, magic = struct.unpack("<QI4s", self._file.read(16))
            if magic != MAGIC:
                raise ValueError(f"{path}: missing trailer (incomplete file?)")
            self._file.seek(offset)
            index = json.loads(self._file.read(length))
            self.events, self.runs = index["events"], index.get("runs", [])
        except (struct.error, KeyError, TypeError, OSError) as e:  # too short, or not what the format says
            self._file.close()
            raise ValueError(f"{path}: not a complete bundle ({type(e).__name__})") from None
        except ValueError:
            self._file.close()
            raise

    def __len__(self):
        return len(self.events)

    def close(self):
        self._file.close()

    def event(self, i):
        """Event i: {"event": [run, lumi, event], "tables": {name: (n, {col: array})}, "relations": {name: {...}}}.
        The arrays are read-only views of the decompressed record."""
        return self._record(self.events[i])

    def run(self, run):
        """The per-run tables of `run` ({name: (n, {col: array})}), or {} if the bundle has none for it."""
        entry = next((r for r in self.runs if r["run"] == run and "offset" in r), None)
        return self._record(entry)["tables"] if entry else {}

    def run_info(self, run):
        """Information about `run` (type, setup, beam, ...), or {}."""
        return next((r.get("info", {}) for r in self.runs if r["run"] == run), {})

    def _record(self, entry):
        self._file.seek(entry["offset"])
        data = gzip.decompress(self._file.read(entry["length"]))
        if data[:4] != RECORD_MAGIC:
            raise ValueError(f"record at {entry['offset']}: bad record")
        hlen = struct.unpack("<I", data[4:8])[0]
        meta = json.loads(data[8 : 8 + hlen])
        base = 8 + hlen

        def view(location, dtype):
            return np.frombuffer(data, dtype=dtype, count=location[1], offset=base + location[0])

        types = self.header["tables"]
        tables = {
            t: (m["n"], {c: view(loc, TYPES[types[t]["columns"][c]["type"]]) for c, loc in m["columns"].items()})
            for t, m in meta["tables"].items()
        }
        relations = {
            r: {
                "offsets": view(m["offsets"], RELATION_TYPES["offsets"]),
                "indices": view(m["indices"], RELATION_TYPES["indices"]),
                "weights": {w: view(loc, RELATION_TYPES["weights"]) for w, loc in m["weights"].items()},
            }
            for r, m in meta["relations"].items()
        }
        return {"event": meta["event"], "tables": tables, "relations": relations}


def summary(path):
    """(header, number of events) of a bundle file; ValueError if it is not a complete bundle."""
    bundle = Bundle(path)
    bundle.close()
    return bundle.header, len(bundle)


def validate(path):
    """Check the structure of every record of the bundle at `path` (row counts, relation offsets and indices, weight
    lengths, a record for the per-run tables of each run); returns the problems found, in words."""
    bundle, problems = Bundle(path), []
    rels = bundle.header["relations"]
    per_run = [t for t, m in bundle.header["tables"].items() if m.get("scope") == "run"]
    for entry in bundle.runs:
        for t, (n, cols) in bundle.run(entry["run"]).items():
            problems += [
                f"run {entry['run']}: {t}.{c} has {len(a)} rows, expected {n}" for c, a in cols.items() if len(a) != n
            ]
    if per_run:
        missing = {e["run"] for e in bundle.events} - {r["run"] for r in bundle.runs}
        problems += [f"run {r}: no record of the per-run tables {', '.join(per_run)}" for r in sorted(missing)]

    for i in range(len(bundle)):
        ev = bundle.event(i)
        for t, (n, cols) in ev["tables"].items():
            problems += [f"event {i}: {t}.{c} has {len(a)} rows, expected {n}" for c, a in cols.items() if len(a) != n]
        for r, rel in ev["relations"].items():
            n_from = ev["tables"].get(rels[r]["from"], (0, {}))[0]
            n_to = ev["tables"].get(rels[r]["to"], (0, {}))[0]
            off, idx = rel["offsets"], rel["indices"]
            if (
                len(off) != n_from + 1
                or off[0] != 0
                or off[-1] != len(idx)
                or np.any(np.diff(off.astype(np.int64)) < 0)
            ):
                problems.append(f"event {i}: relation {r} has bad offsets")
            if len(idx) and idx.max() >= n_to:
                problems.append(f"event {i}: relation {r} points past {rels[r]['to']} ({n_to} rows)")
            problems += [
                f"event {i}: relation {r} weight {w} has {len(a)} entries, expected {len(idx)}"
                for w, a in rel["weights"].items()
                if len(a) != len(idx)
            ]
    return problems
