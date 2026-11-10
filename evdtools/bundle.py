"""Read and write .evdb bundles (docs/format.md)."""
import gzip
import json
import os
import struct

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
    chunks, size = [], 0

    def put(array, dtype):
        nonlocal size
        pad = -size % 8
        data = np.ascontiguousarray(array, dtype=dtype).tobytes()
        chunks.append(b"\0" * pad + data)
        location = [size + pad, len(array)]
        size += pad + len(data)
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
    return RECORD_MAGIC + struct.pack("<I", len(header)) + header + b"".join(chunks)


class BundleWriter:
    """Writes a bundle to `path` atomically: readers never see a partial file."""

    def __init__(self, path, header, compresslevel=6):
        self._path, self._tmp, self._level = path, f"{path}.tmp{os.getpid()}", compresslevel
        self._file = open(self._tmp, "wb")
        head = _json(header, 12)
        self._file.write(MAGIC + struct.pack("<II", VERSION, len(head)) + head)
        self._events, self._runs, self._run_info = [], [], {}

    def _write(self, record_id, tables, relations):
        """Append a compressed record; returns its index entry: where it is and the rows of each table."""
        blob = gzip.compress(encode_record(record_id, tables, relations), compresslevel=self._level)
        entry = {"offset": self._file.tell(), "length": len(blob),
                 "counts": {t: int(n) for t, (n, _) in tables.items()}}
        self._file.write(blob)
        return entry

    def add_run(self, run_id, tables, relations):
        """The per-run tables of a run, written once; readers add them to every event of that run."""
        self._runs.append({"run": int(run_id[0]), **self._write(run_id, tables, relations)})

    def runs(self):
        """Runs of the events written so far."""
        return {e["run"] for e in self._events}

    def set_run_info(self, info):
        """{run: {field: value}}: information about the runs (type, setup, beam, ...), stored in the index."""
        self._run_info = {int(r): dict(v) for r, v in info.items() if v}

    def add(self, event_id, tables, relations):
        run, lumi, event = (int(x) for x in event_id)
        self._events.append({"run": run, "lumi": lumi, "event": event, **self._write(event_id, tables, relations)})

    def close(self):
        runs = {r["run"]: r for r in self._runs}
        for run, info in self._run_info.items():
            runs.setdefault(run, {"run": run})["info"] = info
        runs = [runs[r] for r in sorted(runs)]
        index = json.dumps({"events": self._events, **({"runs": runs} if runs else {})}, separators=(",", ":")).encode()
        offset = self._file.tell()
        self._file.write(index + struct.pack("<QI", offset, len(index)) + MAGIC)
        self._file.close()
        os.replace(self._tmp, self._path)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *_):
        if exc_type is None:
            self.close()
        else:
            self._file.close()
            os.remove(self._tmp)


class Bundle:
    """Random access to the events of a bundle."""

    def __init__(self, path):
        self._file = open(path, "rb")
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
