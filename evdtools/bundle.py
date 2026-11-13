"""Read and write .evdb bundles (docs/format.md)."""
import collections
import gzip
import json
import os
import struct
from concurrent.futures import ThreadPoolExecutor

import numpy as np

MAGIC, RECORD_MAGIC, VERSION = b"EVDB", b"EVD1", 1
TYPES = {"f32": "<f4", "f64": "<f8", "i8": "<i1", "u8": "<u1", "i16": "<i2", "u16": "<u2",
         "i32": "<i4", "u32": "<u4", "i64": "<i8", "u64": "<u8"}
RELATION_TYPES = {"offsets": "<u4", "indices": "<u4", "weights": "<f4"}


def type_code(dtype):
    """evd type code of a numpy dtype (booleans are stored as u8)."""
    dt = np.dtype(dtype)
    if dt.kind == "b":
        return "u8"
    return {"f": "f", "i": "i", "u": "u"}[dt.kind] + str(8 * dt.itemsize)


def _json(obj, aligned_at):
    """JSON bytes, space-padded so that the following byte is 8-aligned."""
    data = json.dumps(obj, separators=(",", ":")).encode()
    return data + b" " * (-(aligned_at + len(data)) % 8)


def encode_record(event_id, tables, relations):
    """tables: {name: (n, {column: array})}; relations: {name: {"offsets", "indices", "weights": {w: array}}}."""
    arrays, size = [], 0

    def put(array, dtype):
        nonlocal size
        data = np.ascontiguousarray(array, dtype=dtype)  # the array itself when it already has this type
        size += -size % 8
        arrays.append((size, data))
        location = [size, len(data)]
        size += data.nbytes
        return location

    meta = {"event": [int(x) for x in event_id], "tables": {}, "relations": {}}
    for name, (n, columns) in tables.items():
        meta["tables"][name] = {"n": int(n), "columns": {c: put(a, TYPES[type_code(a.dtype)]) for c, a in columns.items()}}
    for name, rel in relations.items():
        meta["relations"][name] = {
            "offsets": put(rel["offsets"], RELATION_TYPES["offsets"]),
            "indices": put(rel["indices"], RELATION_TYPES["indices"]),
            "weights": {w: put(a, RELATION_TYPES["weights"]) for w, a in rel.get("weights", {}).items()}}
    header = _json(meta, 8)
    base = 8 + len(header)
    # One buffer of the final size, each array copied into it once (zero-filled, which is the padding).
    record = bytearray(base + size)
    record[:base] = RECORD_MAGIC + struct.pack("<I", len(header)) + header
    for offset, data in arrays:
        if data.nbytes:
            record[base + offset:base + offset + data.nbytes] = data.view(np.uint8).data
    return record


def _pack(level, event_id, tables, relations):
    """A record as it is stored: one gzip member (no timestamp, so the same event always gives the same bytes)."""
    return gzip.compress(encode_record(event_id, tables, relations), compresslevel=level, mtime=0)


class BundleWriter:
    """Writes a bundle to `path` atomically: readers never see a partial file."""

    def __init__(self, path, header, compresslevel=4, sort=False, threads=1):
        """`sort`: list the events in (run, lumi, event) order in the index, whatever order they were added in (records
        are found by offset, so this costs no I/O). `threads`: records are compressed on this many threads (zlib
        releases the interpreter lock) and written in the order they were added; `pool` is that thread pool, or None.
        `compresslevel` 4: on a PU200 event half the time of 6 for 0.3% more bytes."""
        self._path, self._tmp, self._level, self._sort = path, f"{path}.tmp{os.getpid()}", compresslevel, sort
        self._file = open(self._tmp, "wb")
        head = _json(header, 12)
        self._file.write(MAGIC + struct.pack("<II", VERSION, len(head)) + head)
        self._events, self._runs, self._run_info = [], [], {}
        self._threads, self.pool = threads, ThreadPoolExecutor(threads) if threads > 1 else None
        self._queue = collections.deque()  # (index entry, compressed record or its future), oldest first

    def _write(self, entry, record_id, tables, relations):
        """Compress a record and append it; `entry`, its index entry, gets where it is and the rows of each table.
        With threads, at most `threads` records wait (compressed or being compressed) before the oldest is written."""
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

    def add_run(self, run_id, tables, relations):
        """The per-run tables of a run, written once; readers add them to every event of that run."""
        self._runs.append({"run": int(run_id[0])})
        self._write(self._runs[-1], run_id, tables, relations)

    def runs(self):
        """Runs of the events added so far."""
        return {e["run"] for e in self._events}

    def set_run_info(self, info):
        """{run: {field: value}}: information about the runs (type, setup, beam, ...), stored in the index."""
        self._run_info = {int(r): dict(v) for r, v in info.items() if v}

    def add(self, event_id, tables, relations):
        run, lumi, event = (int(x) for x in event_id)
        self._events.append({"run": run, "lumi": lumi, "event": event})
        self._write(self._events[-1], event_id, tables, relations)

    def close(self):
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
        try:
            if exc_type is None:
                return self.close()  # a record that failed on a thread fails here
        except BaseException:
            self._abandon()
            raise
        self._abandon()

    def _abandon(self):
        if self.pool:
            self.pool.shutdown(cancel_futures=True)
        self._file.close()
        os.remove(self._tmp)


def summary(path):
    """(header, number of events) of a bundle file; ValueError if it is not a complete bundle."""
    bundle = Bundle(path)
    bundle._file.close()
    return bundle.header, len(bundle)


class Bundle:
    """Random access to the events of a bundle."""

    def __init__(self, path):
        """ValueError if the file is not a complete bundle."""
        self._file = open(path, "rb")
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

    def run(self, run):
        """The per-run tables of `run` ({name: (n, {col: array})}), or {} if the bundle has none for it."""
        entry = next((r for r in self.runs if r["run"] == run and "offset" in r), None)
        return self._record(entry)["tables"] if entry else {}

    def run_info(self, run):
        """Information about `run` (type, setup, beam, ...), or {}."""
        return next((r.get("info", {}) for r in self.runs if r["run"] == run), {})

    def event(self, i):
        """{"event": [run, lumi, event], "tables": {name: (n, {col: array})}, "relations": {name: {...}}}"""
        return self._record(self.events[i])

    def _record(self, entry):
        self._file.seek(entry["offset"])
        data = gzip.decompress(self._file.read(entry["length"]))
        if data[:4] != RECORD_MAGIC:
            raise ValueError(f"record at {entry['offset']}: bad record")
        hlen = struct.unpack("<I", data[4:8])[0]
        meta = json.loads(data[8:8 + hlen])
        base = 8 + hlen
        view = lambda loc, dtype: np.frombuffer(data, dtype=dtype, count=loc[1], offset=base + loc[0])
        types = self.header["tables"]
        tables = {t: (m["n"], {c: view(loc, TYPES[types[t]["columns"][c]["type"]]) for c, loc in m["columns"].items()})
                  for t, m in meta["tables"].items()}
        relations = {r: {"offsets": view(m["offsets"], RELATION_TYPES["offsets"]),
                         "indices": view(m["indices"], RELATION_TYPES["indices"]),
                         "weights": {w: view(loc, RELATION_TYPES["weights"]) for w, loc in m["weights"].items()}}
                     for r, m in meta["relations"].items()}
        return {"event": meta["event"], "tables": tables, "relations": relations}
