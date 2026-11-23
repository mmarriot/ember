"""Derived columns: columns a profile's `derive` entries add to a table (docs/profiles.md, "derive").

Kinds of derive, by the key that names them:
  lookup             columns copied from the row of another table (often a per-run table) named by an index column,
                     or from one fixed `row` of it (e.g. the leading primary vertex); with `missing`, only where the
                     table lacks the column or the value is NaN
  impact             a track's transverse and longitudinal impact parameters to a point (one row of another table)
  flight             a secondary vertex's flight from a primary one: distances, their significances, pointing angle
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


def derived_columns(d, tables, relations=None):
    """{column: (dtype, doc)} of the columns that the derive `d` adds to its table. `tables` is the file's table
    metadata ({name: {"doc", "columns": {column: (dtype, doc)}}}); `relations` the profile's, by name (a gathered
    column takes the doc, and so the unit, of the column it is copied from)."""
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
    if "impact" in d:
        at = f"{d['impact']} row {d['row']}" + (" (the beam line at the track's z)" if "beamLine" in d else "")
        return {new: (np.dtype("f4"), IMPACT[q].format(at)) for q, new in d["columns"].items()}
    if "flight" in d:
        at = f"{d['flight']} row {d['row']}"
        return {c: (np.dtype("f4"), f"{doc} from {at}") for c, doc in FLIGHT.items()}
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
        out = {}
        for src in d["gather"]:
            target = tables.get((relations or {}).get(src["relation"], {}).get("to"), {}).get("columns", {})
            for new, col in src["columns"].items():
                if new not in out:
                    doc = f"{target[col][1]}; " if col in target and target[col][1] else ""
                    out[new] = (np.dtype("f4"), f"{doc}copied from {col} through {src['relation']} (first linked row)")
        return out
    if "xyFromEtaPhiZ" in d:
        names, doc = ["x", "y"], f"derived from {', '.join(d['xyFromEtaPhiZ'])}"
    else:
        names = [d["column"]]
        doc = (
            f"derived: {d.get('scale', 1.0):g} x distance to neighbour {d.get('k', 1)} in "
            f"({', '.join(d['neighbourDistance'])})" + (f" per {d['groupBy']}" if "groupBy" in d else "")
        )
    return {c: (np.dtype("f4"), doc) for c in names}


# The quantities of an impact derive, with their docs ({} is the point).
IMPACT = {
    "dxy": "transverse impact parameter to {}, signed as CMSSW's TrackBase::dxy [cm]",
    "dz": "longitudinal impact parameter to {}, as CMSSW's TrackBase::dz [cm]",
    "dxyErr": "uncertainty of the transverse impact parameter to {}: the track's and the point's [cm]",
    "dzErr": "uncertainty of the longitudinal impact parameter to {}: the track's and the point's [cm]",
}

# The columns of a flight derive, named as standard NanoAOD's secondary vertices name them.
FLIGHT = {
    "dlen": "3D flight distance [cm]",
    "dlenSig": "3D flight distance over its uncertainty (both vertices' covariances)",
    "dxy": "transverse flight distance [cm]",
    "dxySig": "transverse flight distance over its uncertainty (both vertices' covariances)",
    "pAngle": "pointing angle: between the flight direction and the momentum [rad]",
}


def inputs(d):
    """(other table, {table: columns}) that an impact or flight derive reads; None for other derives."""
    if "impact" in d:
        errors = any(q.endswith("Err") for q in d["columns"])
        own = [
            *d["origin"],
            *d["direction"],
            *(d["errors"] if errors else []),
            *([d["beamLine"]] if "beamLine" in d else []),
        ]
        point = ["x", "y", "z", *(["xErr", "yErr", "covXY"] if "dxyErr" in d["columns"] else [])]
        point += ["zErr"] if "dzErr" in d["columns"] else []
        point += ["dxdz", "dydz", "widthX", "widthY", "sigmaZ"] if "beamLine" in d else []
        return d["impact"], {d["table"]: own, d["impact"]: point}
    if "flight" in d:
        position = ["x", "y", "z", "xErr", "yErr", "zErr", "covXY", "covXZ", "covYZ"]
        return d["flight"], {d["table"]: [*position, "px", "py", "pz"], d["flight"]: position}
    return None


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
            values = np.full(n, np.nan if src.dtype.kind == "f" else -1, lookup_dtype(src.dtype))
            values[ok] = src[idx[ok]]
            if d.get("missing") and new in cols and cols[new].dtype.kind == "f":  # its own numbers stay
                values = np.where(np.isnan(cols[new]), values, cols[new]).astype(cols[new].dtype)
            cols[new] = values
    elif "impact" in d:
        cols.update(_impact(d, cols, n, tables[d["impact"]]))
    elif "flight" in d:
        cols.update(_flight(cols, n, tables[d["flight"]], d["row"]))
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


def _impact(d, cols, n, point_table):
    """The `columns` of an impact derive: each track's impact parameters to the point (x, y, z) in row `row` of
    `point_table`, as CMSSW's TrackBase::dxy(point) and dz(point), and their uncertainties.

    They are the track's impact parameters to the origin (`origin`: dxy, dz) moved to the point along its direction
    (`direction`: eta, phi), not worked out from its reference point: the point is near the origin, so the rounding of
    the stored eta and phi hardly counts. With `beamLine` (the track's z column), the point is the beam line at the
    track's z, and its covariance the beam spot's (widths, tilted along the beam line, plus the position's own), as
    TrackBase::dxy(BeamSpot) and dxyError(BeamSpot). The uncertainties add the track's (`errors`) and the point's in
    quadrature; CMSSW's dxyError(point) has also the track's phi uncertainty times the point's distance from the origin
    across the track, which is left out (below 0.1 um for a primary vertex within 1 mm of the beam line)."""
    if d["row"] >= point_table[0]:
        return {c: np.full(n, np.nan, np.float32) for c in d["columns"].values()}
    p = {c: float(v[d["row"]]) for c, v in point_table[1].items()}
    dxy0, dz0, eta, phi = (np.asarray(cols[c], np.float64) for c in (*d["origin"], *d["direction"]))
    x0, y0, z0 = p["x"], p["y"], p["z"]
    if "beamLine" in d:  # the beam line at the track's z
        shift = np.asarray(cols[d["beamLine"]], np.float64) - z0
        x0, y0 = x0 + p["dxdz"] * shift, y0 + p["dydz"] * shift
    cos, sin = np.cos(phi), np.sin(phi)  # px / pt, py / pt
    out = {
        "dxy": dxy0 + x0 * sin - y0 * cos,
        "dz": dz0 - z0 + (x0 * cos + y0 * sin) * np.sinh(eta),  # pz / pt = sinh(eta)
    }
    if "dxyErr" in d["columns"]:
        cxx, cyy, cxy = _beam_spot_xy(p) if "beamLine" in d else (p["xErr"] ** 2, p["yErr"] ** 2, p["covXY"])
        dxy_err = np.asarray(cols[d["errors"][0]], np.float64)
        out["dxyErr"] = np.sqrt(dxy_err**2 + sin * sin * cxx + cos * cos * cyy - 2 * sin * cos * cxy)
    if "dzErr" in d["columns"]:
        out["dzErr"] = np.hypot(np.asarray(cols[d["errors"][1]], np.float64), p["zErr"])
    return {new: out[q].astype(np.float32) for q, new in d["columns"].items()}


def _beam_spot_xy(p):
    """(cxx, cyy, cxy) of the beam spot's transverse covariance, as reco::BeamSpot::rotatedCovariance3D(): its widths
    (widthX, widthY, sigmaZ) rotated from the z axis onto the beam line (dxdz, dydz), plus its position's covariance."""
    z, n = np.array([0.0, 0.0, 1.0]), np.array([p["dxdz"], p["dydz"], 1.0])
    n /= np.linalg.norm(n)
    axis, angle = np.cross(z, n), -np.arccos(np.clip(z @ n, -1, 1))
    r = np.eye(3)
    if np.linalg.norm(axis) > 0:  # Rodrigues' rotation about the axis
        k = axis / np.linalg.norm(axis)
        kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
        r = np.eye(3) + np.sin(angle) * kx + (1 - np.cos(angle)) * kx @ kx
    c = r @ np.diag([p["widthX"] ** 2, p["widthY"] ** 2, p["sigmaZ"] ** 2]) @ r.T
    return c[0, 0] + p["xErr"] ** 2, c[1, 1] + p["yErr"] ** 2, c[0, 1] + p["covXY"]


def _covariance(cols):
    """The position covariances (n, 3, 3) of the rows of a vertex table: xErr, yErr, zErr, covXY, covXZ, covYZ."""
    ex, ey, ez, xy, xz, yz = (
        np.asarray(cols[c], np.float64) for c in ("xErr", "yErr", "zErr", "covXY", "covXZ", "covYZ")
    )
    return np.stack(
        [np.stack([ex * ex, xy, xz], -1), np.stack([xy, ey * ey, yz], -1), np.stack([xz, yz, ez * ez], -1)], -2
    )


def _flight(cols, n, pv_table, row):
    """FLIGHT columns of each secondary vertex from the primary vertex in row `row` of `pv_table`: the distances and
    their significances as CMSSW's VertexDistance3D and VertexDistanceXY give them (uncertainty^2 = d^T (C_sv + C_pv)
    d / |d|^2, d the flight vector, C the position covariances; in the transverse plane, d and C without z), and the
    angle between d and the vertex's momentum (px, py, pz)."""
    if row >= pv_table[0]:  # no primary vertex
        return {c: np.full(n, np.nan, np.float32) for c in FLIGHT}
    pv = pv_table[1]
    d = np.stack([np.asarray(cols[c], np.float64) - float(pv[c][row]) for c in ("x", "y", "z")], -1)
    cov = _covariance(cols) + _covariance({c: pv[c][row : row + 1] for c in pv})
    p = np.stack([np.asarray(cols[c], np.float64) for c in ("px", "py", "pz")], -1)
    out = {}
    with np.errstate(divide="ignore", invalid="ignore"):
        for name, k in (("dlen", 3), ("dxy", 2)):
            dk = d[:, :k]
            length = np.sqrt((dk * dk).sum(-1))
            error = np.sqrt(np.einsum("ni,nij,nj->n", dk, cov[:, :k, :k], dk)) / length
            out[name], out[name + "Sig"] = length, length / error
        cos = (d * p).sum(-1) / (out["dlen"] * np.sqrt((p * p).sum(-1)))
        out["pAngle"] = np.arccos(np.clip(cos, -1, 1))
    return {c: v.astype(np.float32) for c, v in out.items()}


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
    out = {c: np.full(n, d.get("fill", np.nan), np.float32) for c in gathered_columns(d)}
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


def gathered_columns(d):
    """The columns a gather derive writes: those of all its sources, each once, in order."""
    return list(dict.fromkeys(c for src in d["gather"] for c in src["columns"]))
