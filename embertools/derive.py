"""Derived columns: columns a profile's `derive` entries add to a table (docs/profiles.md, "derive").

Kinds of derive, by the key that names them:
  lookup             columns copied from the row of another table (often a per-run table) named by an index column,
                     or from one fixed `row` of it (e.g. the leading primary vertex)
  rowIndex           the row's number in the event, before cuts
  parentRow          the row of the parent, for children stored in their parents' order with a count on each parent
                     (the hits of tracks), so that the children can be split and still name their parent
  nanUnless          NaN in columns where a condition fails (a track's time where it has none)
  timeAtOrigin       a hit's time minus the light's flight from the origin to it (comparable to tracks' t0)
  xyFromEtaPhiZ      x and y from eta, phi and z
  momentum           px, py and pz from pt, eta and phi (or pt and phi: pz 0, e.g. missing transverse momentum)
  bits               integer columns cut out of the bits of another (e.g. the subdetector of a DetId)
  cell               the size of calorimeter cells from their DetId and position (cells.py)
  neighbourDistance  scale x the distance to the k-th nearest other row (a cell size estimated from the hits' spacing)
  gather             columns copied from the first row reached through a relation (needs the event's relations)
  split              (converter.py) new tables of the rows of a table that pass conditions, e.g. one per subdetector

Tables here are an event's tables as the converter holds them: {name: (rows, {column: array})}.
"""

import numpy as np

from . import cells

# The comparison operators of row conditions ([expression, operator, number]: cuts, splits, nanUnless).
OPS = {"<": np.less, "<=": np.less_equal, ">": np.greater, ">=": np.greater_equal, "==": np.equal, "!=": np.not_equal}
C = 29.9792458  # the speed of light [cm/ns]


def derived_columns(d, tables):
    """{column: (dtype, doc)} of the columns that the derive `d` adds to its table. `tables` is the file's table
    metadata ({name: {"doc", "columns": {column: (dtype, doc)}}})."""
    if "lookup" in d:
        source, own = tables[d["lookup"]]["columns"], tables[d["table"]]["columns"]
        by = f"row {d['row']}" if "row" in d else f"by {d.get('index')}"
        out = {}
        for new, col in d["columns"].items():
            if col not in source or ("row" not in d and d.get("index") not in own):
                raise ValueError(f"lookup {d['table']} -> {d['lookup']}: no column {col} or {d.get('index')}")
            dtype, doc = source[col]
            out[new] = (lookup_dtype(dtype), f"{doc} (from {d['lookup']}.{col}, {by})")
        return out
    if "bits" in d:
        own = tables[d["table"]]["columns"]
        for new, (col, first, count) in d["bits"].items():
            if col not in own:
                raise ValueError(f"bits {d['table']}.{new}: no column {col}")
        return {
            new: (np.dtype("i4"), f"bits {first} to {first + count - 1} of {col}")
            for new, (col, first, count) in d["bits"].items()
        }
    if "cell" in d:
        if d["cell"] not in cells.COLUMNS:
            raise ValueError(f"cell {d['table']}: unknown rule {d['cell']}; known: {', '.join(cells.COLUMNS)}")
        return {c: (np.dtype("f4"), f"{doc} (from the DetId)") for c, doc in cells.COLUMNS[d["cell"]].items()}
    if "momentum" in d:
        return {
            c: (np.dtype("f4"), f"derived from {', '.join(filter(None, d['momentum']))}") for c in ("px", "py", "pz")
        }
    if "rowIndex" in d:
        return {d["rowIndex"]: (np.dtype("i4"), "row number in the event (0 first), e.g. the leading primary vertex")}
    if "parentRow" in d:
        return {d["parentRow"]: (np.dtype("i4"), f"row of the parent (from {d['counts']}, children in parents' order)")}
    if "nanUnless" in d:
        own = tables[d["table"]]["columns"]
        col, op, _ = d["nanUnless"]
        missing = [c for c in [col, *d["columns"]] if c not in own]
        if missing or op not in OPS:
            raise ValueError(f"nanUnless {d['table']}: no column {', '.join(missing)} or bad operator {op}")
        return {c: own[c] for c in d["columns"]}
    if "timeAtOrigin" in d:
        return {d["timeAtOrigin"]: (np.dtype("f4"), f"{d['time']} minus the flight from the origin at c [ns]")}

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
    """Add the columns of a derive (any kind but gather and split) to its table in `tables`."""
    n, cols = tables[d["table"]]
    if "rowIndex" in d:
        cols[d["rowIndex"]] = np.arange(n, dtype=np.int32)
    elif "parentRow" in d:
        parent, col = d["counts"].split(".")
        counts = np.asarray(tables[parent][1][col], np.int64)
        if counts.sum() != n:  # children of the wrong parents otherwise
            raise ValueError(f"parentRow {d['table']}: {counts.sum()} children counted in {d['counts']}, {n} rows")
        cols[d["parentRow"]] = np.repeat(np.arange(len(counts), dtype=np.int32), counts)
    elif "nanUnless" in d:
        col, op, value = d["nanUnless"]
        fails = ~OPS[op](np.asarray(cols[col]), value)
        for c in d["columns"]:
            cols[c] = np.where(fails, np.nan, cols[c]).astype(cols[c].dtype)
    elif "timeAtOrigin" in d:
        x, y, z = (np.asarray(cols[c], np.float64) for c in d["position"])
        flight = np.sqrt(x * x + y * y + z * z) / C
        cols[d["timeAtOrigin"]] = (np.asarray(cols[d["time"]], np.float64) - flight).astype(np.float32)
    elif "lookup" in d:
        n_source, source = tables[d["lookup"]]
        idx = np.full(n, d["row"], np.int64) if "row" in d else np.asarray(cols[d["index"]], np.int64)
        ok = (idx >= 0) & (idx < n_source)
        for new, col in d["columns"].items():
            src = source[col]
            cols[new] = np.full(n, np.nan if src.dtype.kind == "f" else -1, lookup_dtype(src.dtype))
            cols[new][ok] = src[idx[ok]]
    elif "bits" in d:
        for new, (col, first, count) in d["bits"].items():
            cols[new] = ((np.asarray(cols[col]).astype(np.int64) >> first) & ((1 << count) - 1)).astype(np.int32)
    elif "cell" in d:
        detid, *position = (cols[c] for c in (d["detId"], *d["position"]))
        cols.update(cells.compute(d["cell"], detid, *position, d.get("geometry", "run3")))
    elif "momentum" in d:
        pt, eta, phi = (None if c is None else cols[c].astype(np.float64) for c in d["momentum"])
        cols["px"], cols["py"] = (pt * np.cos(phi)).astype(np.float32), (pt * np.sin(phi)).astype(np.float32)
        if eta is None:
            pz = np.zeros(n)
        else:  # pt 0: ROOT writes eta = +-(22756 + |pz|), so pz = sign(eta) (|eta| - 22756)
            with np.errstate(over="ignore", invalid="ignore"):
                pz = np.where(pt > 0, pt * np.sinh(eta), np.sign(eta) * np.maximum(np.abs(eta) - 22756, 0))
        cols["pz"] = pz.astype(np.float32)
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
            c: np.where(np.isnan(cols[c]), v, cols[c]).astype(cols[c].dtype) if c in cols else v for c, v in out.items()
        }
    cols.update(out)


def _gathered_columns(d):
    """The columns a gather derive writes: those of all its sources, each once, in order."""
    return list(dict.fromkeys(c for src in d["gather"] for c in src["columns"]))
