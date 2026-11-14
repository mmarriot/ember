"""Derived columns: columns a profile's `derive` entries add to a table (docs/profiles.md, "derive").

Kinds of derive, by the key that names them:
  lookup             columns copied from the row of another table (often a per-run table) named by an index column
  rowIndex           the row's number in the event, before cuts
  xyFromEtaPhiZ      x and y from eta, phi and z
  neighbourDistance  scale x the distance to the k-th nearest other row (a cell size estimated from the hits' spacing)
  gather             columns copied from the first row reached through a relation (needs the event's relations)

Tables here are an event's tables as the converter holds them: {name: (rows, {column: array})}.
"""

import numpy as np


def derived_columns(d, tables):
    """{column: (dtype, doc)} of the columns that the derive `d` adds to its table. `tables` is the file's table
    metadata ({name: {"doc", "columns": {column: (dtype, doc)}}})."""
    if "lookup" in d:
        source, own = tables[d["lookup"]]["columns"], tables[d["table"]]["columns"]
        out = {}
        for new, col in d["columns"].items():
            if col not in source or d["index"] not in own:
                raise ValueError(f"lookup {d['table']} -> {d['lookup']}: no column {col} or {d['index']}")
            dtype, doc = source[col]
            out[new] = (lookup_dtype(dtype), f"{doc} (from {d['lookup']}.{col} by {d['index']})")
        return out
    if "rowIndex" in d:
        return {d["rowIndex"]: (np.dtype("i4"), "row number in the event (0 first), e.g. the leading primary vertex")}

    if "gather" in d:
        names = _gathered_columns(d)
        doc = f"copied through {', '.join(s['relation'] for s in d['gather'])} (first linked row)"
    elif "xyFromEtaPhiZ" in d:
        names, doc = ["x", "y"], f"derived from {', '.join(d['xyFromEtaPhiZ'])}"
    else:
        names = [d["column"]]
        doc = (
            f"derived: {d.get('scale', 1.0):g} x distance to neighbour {d.get('k', 1)} in "
            f"({', '.join(d['neighbourDistance'])})" + (f" per {d['groupBy']}" if "groupBy" in d else "")
        )
    return {c: (np.dtype("f4"), doc) for c in names}


def lookup_dtype(dtype):
    """The type of a column copied by a lookup. It is signed, so that -1 can mark rows that have no lookup row: the
    narrowest signed type that holds every value of `dtype` (bool -> i8, u8 -> i16, u16 -> i32, u32 and u64 -> i64).
    Floats keep their type (rows without a lookup row get NaN)."""
    dt = np.dtype(dtype)
    if dt.kind == "b":
        return np.dtype(np.int8)
    return np.dtype(f"i{min(2 * dt.itemsize, 8)}") if dt.kind == "u" else dt


def apply_derive(d, tables):
    """Add the columns of a lookup, rowIndex, xyFromEtaPhiZ or neighbourDistance derive to its table in `tables`."""
    n, cols = tables[d["table"]]
    if "rowIndex" in d:
        cols[d["rowIndex"]] = np.arange(n, dtype=np.int32)
    elif "lookup" in d:
        n_source, source = tables[d["lookup"]]
        idx = np.asarray(cols[d["index"]], np.int64)
        ok = (idx >= 0) & (idx < n_source)
        for new, col in d["columns"].items():
            src = source[col]
            cols[new] = np.full(n, np.nan if src.dtype.kind == "f" else -1, lookup_dtype(src.dtype))
            cols[new][ok] = src[idx[ok]]
    elif "xyFromEtaPhiZ" in d:
        eta, phi, z = (cols[c].astype(np.float64) for c in d["xyFromEtaPhiZ"])
        r = z / np.sinh(eta)  # the transverse radius, as tan(theta) = 1 / sinh(eta)
        cols["x"], cols["y"] = (r * np.cos(phi)).astype(np.float32), (r * np.sin(phi)).astype(np.float32)
    else:
        cols[d["column"]] = _neighbour_distance(d, cols)


def _neighbour_distance(d, cols):
    """scale x the distance of each row to its k-th nearest other row with the same `groupBy` value (e.g. the same
    layer). A group with k rows or fewer gets 0."""
    from scipy.spatial import cKDTree  # only this derive needs scipy

    points = np.column_stack([cols[c] for c in d["neighbourDistance"]]).astype(np.float64)
    groups = cols[d["groupBy"]] if "groupBy" in d else np.zeros(len(points))
    k, out = d.get("k", 1), np.zeros(len(points), np.float32)
    for g in np.unique(groups):
        rows = groups == g
        if rows.sum() > k:
            # k + 1 neighbours, as the nearest point to each row is the row itself
            out[rows] = cKDTree(points[rows]).query(points[rows], k=k + 1)[0][:, k]
    return out * np.float32(d.get("scale", 1.0))


def gather(d, tables, relations, profile_relations):
    """Apply a gather derive: copy columns from the first row that each row of the table links to through a relation.

    The `gather` sources are tried in order, and a row takes its values from the first source that links it. A source
    sets the columns it does not name to 0; rows that no source links get `fill` (default NaN). With `"missing": true`,
    a column the table already has keeps its finite values and only its NaN values are filled (e.g. a PF candidate
    without an ECAL entrance point takes its track's outermost state). `relations` are the event's CSR relations,
    `profile_relations` the profile's (for each relation's `to` table)."""
    n, cols = tables[d["table"]]
    out = {c: np.full(n, d.get("fill", np.nan), np.float32) for c in _gathered_columns(d)}
    placed = np.zeros(n, bool)
    for src in d["gather"]:
        rel = relations.get(src["relation"])
        if rel is None:
            continue
        offsets = np.asarray(rel["offsets"], np.int64)
        todo = (np.diff(offsets) > 0) & ~placed  # rows this source links, and no earlier source did
        rows = np.asarray(rel["indices"])[offsets[:-1][todo]]  # the first row each of them links to
        target = tables[profile_relations[src["relation"]]["to"]][1]
        for c, values in out.items():
            values[todo] = target[src["columns"][c]][rows] if c in src["columns"] else 0
        placed |= todo
    if d.get("missing"):
        out = {
            c: np.where(np.isnan(cols[c]), v, cols[c]).astype(np.float32) if c in cols else v for c, v in out.items()
        }
    cols.update(out)


def _gathered_columns(d):
    """The columns a gather derive writes: those of all its sources, each once, in order."""
    return list(dict.fromkeys(c for src in d["gather"] for c in src["columns"]))
