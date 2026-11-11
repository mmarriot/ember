"""NanoAOD -> .evdb conversion, driven by a display profile (evdtools/profiles/*.json, keys in docs/profiles.md).

A Converter resolves the profile against the tables of a file: entries for tables the file lacks are dropped, so one
profile serves legacy-only, SoA-only and mixed files. Tables of the Runs tree are per-run tables: read once per run,
available to lookups, written once per run.

Per event: read tables -> derive columns -> relations (CSR) -> gather -> row cuts -> event selection -> renumber
index columns and cut relations (links to removed rows dropped) -> drop internal and per-run tables.
"""
import datetime
import fnmatch
import itertools
import json
import os
import sys
from collections import defaultdict

import numpy as np
import uproot

from . import __version__
from .bundle import BundleWriter, type_code

PROFILES = os.path.join(os.path.dirname(__file__), "profiles")
OPS = {"<": np.less, "<=": np.less_equal, ">": np.greater, ">=": np.greater_equal, "==": np.equal, "!=": np.not_equal}
# Profile keys the converter acts on; every other top-level key is a viewer setting, copied to the header verbatim.
PROFILE_KEYS = {"name", "note", "include", "exclude", "internal", "sameRows", "derive", "relations", "cuts", "select",
                "display", "kinds", "prefer", "stages"}
HEADER_KEYS = {"schema", "source", "profile", "tables"}  # written by the converter, not taken from the profile


def _merge(a, b):
    """`b` over `a`: dicts merge key by key (recursively), lists concatenate, anything else: `b` wins."""
    if isinstance(a, dict) and isinstance(b, dict):
        return {**a, **{k: _merge(a[k], v) if k in a else v for k, v in b.items()}}
    if isinstance(a, list) and isinstance(b, list):
        return a + b
    return b


def load_profile(name_or_path, _within=()):
    """A profile with its `include`s resolved: the included profiles (by name or path, looked up next to the
    including profile first, then among the built-in ones) merged in order, then the profile's own keys over them.
    An included profile's `name` is not inherited."""
    here = os.path.dirname(_within[-1]) if _within else ""
    candidates = [os.path.join(here, name_or_path), os.path.join(here, f"{name_or_path}.json")] if here else \
        [name_or_path]
    path = next((c for c in candidates if os.path.isfile(c)), os.path.join(PROFILES, f"{name_or_path}.json"))
    path = os.path.realpath(path)
    if path in _within:
        raise ValueError(f"profile {path} includes itself (through {' -> '.join(_within)})")
    with open(path) as f:
        profile = json.load(f)
    merged = {}
    for name in profile.pop("include", []):
        included = load_profile(name, (*_within, path))
        included.pop("name", None)
        merged = _merge(merged, included)
    return _merge(merged, profile)


def discover(tree):
    """Collection tables of a NanoAOD tree: {table: {"doc": str, "columns": {column: (dtype, doc)}}}."""
    branches = tree.keys()  # file order = the producers' column order
    keys = set(branches)
    columns = defaultdict(dict)
    for branch in branches:
        table, sep, column = branch.partition("_")
        if sep and f"n{table}" in keys:
            columns[table][column] = (tree[branch].interpretation.content.from_dtype, tree[branch].title)
    return {t: {"doc": tree[f"n{t}"].title, "columns": cols} for t, cols in columns.items()}


def _column(spec):
    """"Table.column" -> (table, column)."""
    table, _, column = spec.partition(".")
    return table, column


# Row conditions: [expr, op, number] with expr a column or a ratio "a/b"; {"defined": column};
# {"reachedBy": relation or [relations]} (reached through any of them)
def _operands(expr):
    return expr.split("/", 1)


def _condition(cond, cols):
    """Row mask of an [expr, op, number] condition."""
    expr, op, value = cond
    with np.errstate(divide="ignore", invalid="ignore"):  # x/0 -> inf or nan, and nan fails every comparison
        operands = [cols[c] for c in _operands(expr)]
        return OPS[op](operands[0] / operands[1] if len(operands) == 2 else operands[0], value)


def _describe(cond):
    if not isinstance(cond, dict):
        return " ".join(map(str, cond))
    return f"reached by {' or '.join(cond['reachedBy'])}" if "reachedBy" in cond else f"{cond['defined']} defined"


# Derived columns
def _gathered(d):
    return list(dict.fromkeys(c for src in d["gather"] for c in src["columns"]))


def _lookup_dtype(dtype):
    """Lookup columns are signed, so that -1 can mark rows without a lookup row: the narrowest signed type that
    holds every value of `dtype` (bool -> i8, u8 -> i16, u16 -> i32, u32 and u64 -> i64)."""
    dt = np.dtype(dtype)
    if dt.kind == "b":
        return np.dtype(np.int8)
    return np.dtype(f"i{min(2 * dt.itemsize, 8)}") if dt.kind == "u" else dt


def _derived_columns(d, tables):
    """{column: (dtype, doc)} of the columns a derive adds to its table (`tables`: the file's table metadata)."""
    if "lookup" in d:
        source, own = tables[d["lookup"]]["columns"], tables[d["table"]]["columns"]
        out = {}
        for new, col in d["columns"].items():
            if col not in source or d["index"] not in own:
                raise ValueError(f"lookup {d['table']} -> {d['lookup']}: no column {col} or {d['index']}")
            dtype, doc = source[col]
            out[new] = (_lookup_dtype(dtype), f"{doc} (from {d['lookup']}.{col} by {d['index']})")
        return out
    if "gather" in d:
        names, doc = _gathered(d), f"copied through {', '.join(s['relation'] for s in d['gather'])} (first linked row)"
    elif "xyFromEtaPhiZ" in d:
        names, doc = ["x", "y"], f"derived from {', '.join(d['xyFromEtaPhiZ'])}"
    else:
        names = [d["column"]]
        doc = (f"derived: {d.get('scale', 1.0):g} x distance to neighbour {d.get('k', 1)} in "
               f"({', '.join(d['neighbourDistance'])})" + (f" per {d['groupBy']}" if "groupBy" in d else ""))
    return {c: (np.dtype("f4"), doc) for c in names}


def _derive(d, tables):
    """Add the columns of a lookup, xyFromEtaPhiZ or neighbourDistance derive to its table."""
    n, cols = tables[d["table"]]
    if "lookup" in d:  # the lookup table's row named by the index column; none: NaN, or -1 for integers
        n_source, source = tables[d["lookup"]]
        idx = np.asarray(cols[d["index"]], np.int64)
        ok = (idx >= 0) & (idx < n_source)
        for new, col in d["columns"].items():
            src = source[col]
            cols[new] = np.full(n, np.nan if src.dtype.kind == "f" else -1, _lookup_dtype(src.dtype))
            cols[new][ok] = src[idx[ok]]
    elif "xyFromEtaPhiZ" in d:
        eta, phi, z = (cols[c].astype(np.float64) for c in d["xyFromEtaPhiZ"])
        r = z / np.sinh(eta)  # transverse radius: tan(theta) = 1 / sinh(eta)
        cols["x"], cols["y"] = (r * np.cos(phi)).astype(np.float32), (r * np.sin(phi)).astype(np.float32)
    else:
        cols[d["column"]] = _neighbour_distance(d, cols)


def _neighbour_distance(d, cols):
    """scale x the distance of each row to its k-th nearest other row of the same `groupBy` value."""
    from scipy.spatial import cKDTree  # only this derive needs scipy
    points = np.column_stack([cols[c] for c in d["neighbourDistance"]]).astype(np.float64)
    groups = cols[d["groupBy"]] if "groupBy" in d else np.zeros(len(points))
    k, out = d.get("k", 1), np.zeros(len(points), np.float32)
    for g in np.unique(groups):
        rows = groups == g
        if rows.sum() > k:
            out[rows] = cKDTree(points[rows]).query(points[rows], k=k + 1)[0][:, k]
    return out * np.float32(d.get("scale", 1.0))


def _gather(d, tables, relations, profile_relations):
    """Columns copied from the first row each row of `table` points to through a relation; the sources are tried in
    order. A source that places a row sets the columns it does not name to 0; rows no source reaches get `fill`
    (default NaN)."""
    n, cols = tables[d["table"]]
    out = {c: np.full(n, d.get("fill", np.nan), np.float32) for c in _gathered(d)}
    placed = np.zeros(n, bool)
    for src in d["gather"]:
        rel = relations.get(src["relation"])
        if rel is None:
            continue
        offsets = np.asarray(rel["offsets"], np.int64)
        todo = (np.diff(offsets) > 0) & ~placed
        rows = np.asarray(rel["indices"])[offsets[:-1][todo]]
        target = tables[profile_relations[src["relation"]]["to"]][1]
        for c in out:
            out[c][todo] = target[src["columns"][c]][rows] if c in src["columns"] else 0
        placed |= todo
    cols.update(out)


# Relations, as CSR: {"offsets": n_from + 1, "indices": rows of `to`, "weights": {name: one per index}}
def _relation(rel, tables):
    """A profile relation of any kind but compose, normalised to CSR."""
    col = lambda spec: tables[_column(spec)[0]][1][_column(spec)[1]]
    n_from, n_to = tables[rel["from"]][0], tables[rel["to"]][0]
    weights = {_column(w)[1]: col(w) for w in rel.get("weights", [])}
    kind = rel["kind"]
    if kind == "offsets":  # explicit n+1 offsets (e.g. an exported AssociationMap)
        offsets, indices = col(rel["offsets"]), col(rel["indices"])
    elif kind == "counts":  # NanoAOD per-object counts + flat list
        offsets, indices = np.concatenate([[0], np.cumsum(col(rel["counts"]), dtype=np.int64)]), col(rel["indices"])
    elif kind == "links":  # one row per (from, to) pair; to < 0 means no target
        src, dst = col(rel["fromIndex"]), col(rel["toIndex"])
        keep = dst >= 0
        if np.any(np.diff(src) < 0):  # CSR needs the pairs grouped by `from`
            keep = np.flatnonzero(keep)[np.argsort(src[keep], kind="stable")]
        src, indices = src[keep], dst[keep]
        weights = {w: a[keep] for w, a in weights.items()}
        offsets = np.concatenate([[0], np.cumsum(np.bincount(src, minlength=n_from))])
    elif kind == "index":  # a column holding one row of the other table (< 0: none)
        idx = col(rel["index"])
        if "via" in rel:  # the index column names a row of a lookup column holding the `to` row
            via = col(rel["via"])
            ok = (idx >= 0) & (idx < len(via))
            idx = np.where(ok, via[np.where(ok, idx, 0)], -1)
        if _column(rel["index"])[0] == rel["to"]:  # on `to` (each hit names its cluster): a `from` row gets the
            rows = np.flatnonzero(idx >= 0)        # `to` rows that name it
            indices = rows[np.argsort(idx[rows], kind="stable")]
            offsets = np.concatenate([[0], np.cumsum(np.bincount(idx[indices], minlength=n_from))])
        else:
            offsets, indices = np.concatenate([[0], np.cumsum(idx >= 0)]), idx[idx >= 0]
    elif kind == "key":  # rows of `from` and `to` with equal key columns (e.g. the same DetId in two hit tables)
        key_from, key_to = col(rel["fromKey"]), col(rel["toKey"])
        order = np.argsort(key_to, kind="stable")
        pos = np.searchsorted(key_to[order], key_from)
        found = (pos < len(order)) & (key_to[order][np.minimum(pos, len(order) - 1)] == key_from) if len(order) else \
            np.zeros(len(key_from), bool)
        offsets, indices = np.concatenate([[0], np.cumsum(found, dtype=np.int64)]), order[pos[found]]
    else:
        raise ValueError(f"relation {rel['name']}: unknown kind {kind}")
    if len(offsets) != n_from + 1 or offsets[-1] != len(indices) or (len(indices) and indices.max() >= n_to):
        raise ValueError(f"relation {rel['name']}: inconsistent with tables {rel['from']} ({n_from}) and "
                         f"{rel['to']} ({n_to})")
    return {"offsets": offsets, "indices": indices, "weights": weights}


def _compose(a, b):
    """A->C from A->B and B->C: each row of A reaches the union of what its B rows reach."""
    a_off, b_off = np.asarray(a["offsets"], np.int64), np.asarray(b["offsets"], np.int64)
    offsets, indices = [0], []
    for f in range(len(a_off) - 1):
        mids = a["indices"][a_off[f]:a_off[f + 1]]
        reached = np.unique(np.concatenate([b["indices"][b_off[m]:b_off[m + 1]] for m in mids])) \
            if len(mids) else np.zeros(0, np.int64)
        indices.append(reached)
        offsets.append(offsets[-1] + len(reached))
    return {"offsets": np.array(offsets), "indices": np.concatenate(indices) if indices else np.zeros(0, np.int64),
            "weights": {}}


def cut_relation(rel, keep_from, keep_to):
    """A relation restricted to kept rows (masks, or None for an uncut table): rows of removed `from` objects and
    links to removed `to` rows are dropped, and the remaining indices are renumbered."""
    if keep_from is None and keep_to is None:
        return rel
    offsets, indices = np.asarray(rel["offsets"], np.int64), np.asarray(rel["indices"])
    owner = np.repeat(np.arange(len(offsets) - 1), np.diff(offsets))
    keep = np.ones(len(indices), bool)
    if keep_from is not None:
        keep &= keep_from[owner]
    if keep_to is not None:
        keep &= keep_to[indices]
        indices = np.cumsum(keep_to)[indices] - 1
    counts = np.bincount(owner[keep], minlength=len(offsets) - 1)
    if keep_from is not None:
        counts = counts[keep_from]
    return {"offsets": np.concatenate([[0], np.cumsum(counts)]), "indices": indices[keep],
            "weights": {w: a[keep] for w, a in rel["weights"].items()}}


def _check_same(s, tables, event_id):
    """sameRows: the dropped table must have the kept table's rows, in the same order."""
    (n_keep, keep), (n_drop, drop) = tables[s["keep"]], tables[s["drop"]]
    bad = [f"{a}/{b}" for a, b in s["columns"]
           if n_keep == n_drop and not np.allclose(keep[a], drop[b], rtol=1e-5, atol=1e-6)]
    if n_keep != n_drop or bad:
        raise ValueError(f"sameRows {s['keep']} / {s['drop']}: event {tuple(int(x) for x in event_id)} differs "
                         f"({f'{n_keep} vs {n_drop} rows' if n_keep != n_drop else ', '.join(bad)}); "
                         "remove this sameRows entry from the profile to keep both tables")


def _display(profile, tables, relations):
    """Display layers for the tables present. A layer with a `kind` takes that kind's style from the profile's
    `kinds` (its own keys win; `cut` is merged key by key) and is grouped under the kind's label, kinds in profile
    order. Within a kind, layers whose `source` ranks below the best source present (profile `prefer`, first is
    best) start hidden and are marked `alternative`, so a file with both SoA and legacy objects shows one of them.

    Profile `stages` lists kinds in reconstruction order (e.g. trackster, linked trackster, candidate). The
    preferred layers of the stage kinds present get `stage` 0, 1, ...; all but the last start hidden, so the default
    view shows the final objects. `"colourBy": "stage"` becomes the relation from the latest stage that reaches the
    layer's table (or is dropped if none does)."""
    kinds, prefer = profile.get("kinds", {}), profile.get("prefer", [])
    rank = lambda layer: prefer.index(layer["source"]) if layer.get("source") in prefer else len(prefer)
    layers = []
    for layer in profile.get("display", []):
        if layer["table"] not in tables:
            continue
        kind = kinds.get(layer.get("kind"))
        if kind is not None:
            style = {k: v for k, v in kind.items() if k != "label"}
            cut = {**style.get("cut", {}), **layer.get("cut", {})} if "cut" in style or "cut" in layer else None
            layer = {**style, "group": kind["label"], **layer, **({"cut": cut} if cut else {})}
        layers.append(dict(layer))
    best = {}
    for layer in layers:
        if layer.get("kind"):
            best[layer["kind"]] = min(best.get(layer["kind"], len(prefer)), rank(layer))
    for layer in layers:
        if layer.get("kind") and rank(layer) > best[layer["kind"]]:
            layer["visible"] = False
            layer["alternative"] = True
    preferred = [layer for layer in layers if layer.get("kind") and rank(layer) == best[layer["kind"]]]
    stages = [k for k in profile.get("stages", []) if any(layer["kind"] == k for layer in preferred)]
    for layer in preferred:
        kind = layer.get("stageOf", layer["kind"])  # e.g. tracks shown with the candidates that use them
        if kind in stages:
            layer["stage"] = stages.index(kind)
            if layer["stage"] < len(stages) - 1:
                layer["visible"] = False
    for layer in layers:
        layer.pop("stageOf", None)  # a profile key, not a display hint
        if layer.get("colourBy") != "stage":
            continue
        del layer["colourBy"]
        for k in reversed(range(len(stages))):
            sources = {x["table"] for x in preferred if x.get("stage") == k}
            name = next((n for n, r in relations.items() if r["from"] in sources and r["to"] == layer["table"]), None)
            if name:
                layer["colourBy"] = {"relation": name}
                break
    order = list(kinds)
    return sorted(layers, key=lambda layer: order.index(layer["kind"]) if layer.get("kind") in kinds else len(order))


class Converter:
    def __init__(self, tables, profile, run_tables=None):
        """`tables`: the per-event tables of the file (see discover); `run_tables`: the per-run ones (Runs tree).
        Derived columns are added to their table's metadata."""
        keep = lambda t: not any(fnmatch.fnmatch(t, p) for p in profile.get("exclude", []))
        run_tables = {t: m for t, m in (run_tables or {}).items() if keep(t) and t not in tables}
        self.run_scope = set(run_tables)
        self.tables = {t: m for t, m in {**tables, **run_tables}.items() if keep(t)}
        # sameRows: tables with the same rows as another (e.g. legacy objects converted 1:1 from SoA) are checked on
        # every event and not written; relations to or from them are redirected to the kept table.
        self.same = [s for s in profile.get("sameRows", []) if s["keep"] in self.tables and s["drop"] in self.tables]
        self.internal = (set(profile.get("internal", [])) & set(self.tables)) | {s["drop"] for s in self.same}
        self.derived = set()
        for s in self.same:  # `copy`: columns of the dropped table that the kept one takes over
            keep, drop = self.tables[s["keep"]]["columns"], self.tables[s["drop"]]["columns"]
            for c in s.get("copy", []):
                if c not in drop or c in keep:
                    raise ValueError(f"sameRows {s['keep']} / {s['drop']}: cannot copy column {c} (missing from "
                                     f"{s['drop']}, or already in {s['keep']})")
                keep[c] = drop[c]
                self.derived.add((s["keep"], c))

        self.derive = [d for d in profile.get("derive", [])
                       if d["table"] in self.tables and d.get("lookup", d["table"]) in self.tables]
        for d in self.derive:
            for c, meta in _derived_columns(d, self.tables).items():
                self.tables[d["table"]]["columns"][c] = meta
                self.derived.add((d["table"], c))

        rename = {s["drop"]: s["keep"] for s in self.same}
        self.relations = {}
        for r in profile.get("relations", []):
            if r["kind"] == "compose":  # its ends are those of the chain
                if all(v in self.relations for v in r["via"]):
                    self.relations[r["name"]] = {**r, "from": self.relations[r["via"][0]]["from"],
                                                 "to": self.relations[r["via"][-1]]["to"]}
                continue
            r = {**r, "from": rename.get(r["from"], r["from"]), "to": rename.get(r["to"], r["to"])}
            if self._available(r):
                self.relations[r["name"]] = r

        def usable(c):  # a reachedBy condition keeps the relations present (as a list); none: the condition is dropped
            if not (isinstance(c, dict) and "reachedBy" in c):
                return c
            names = [r for r in ([c["reachedBy"]] if isinstance(c["reachedBy"], str) else c["reachedBy"])
                     if r in self.relations]
            return {"reachedBy": names} if names else None
        cuts = {t: [u for u in map(usable, conds) if u is not None] for t, conds in profile.get("cuts", {}).items()
                if t in self.tables}
        self.cuts = {t: conds for t, conds in cuts.items() if conds}
        self.select = [s for s in profile.get("select", []) if s["table"] in self.tables]
        for t, conds in self.cuts.items():
            for c in conds:
                self._check(t, c)
            self.tables[t]["doc"] += f" (cut: {' and '.join(map(_describe, conds))})"
        for s in self.select:
            for c in s.get("where", []):
                self._check(s["table"], c)

        self.display = _display(profile, self.written(), self.relations)
        for layer in self.display:
            self._check_display(layer)
        self.viewer_hints = {k: v for k, v in profile.items() if k not in PROFILE_KEYS}
        if set(self.viewer_hints) & HEADER_KEYS:
            raise ValueError(f"profile keys {sorted(set(self.viewer_hints) & HEADER_KEYS)} are the bundle header's own")

    def _available(self, rel):
        """A relation is kept if all its tables are in the file; then every column it names must exist."""
        keys = ("offsets", "counts", "indices", "index", "via", "fromIndex", "toIndex", "fromKey", "toKey")
        specs = [s for s in [rel.get(k) for k in keys] + rel.get("weights", []) if s]
        tables = {rel["from"], rel["to"], rel.get("table")} | {_column(s)[0] for s in specs}
        if not all(t is None or t in self.tables for t in tables):
            return False
        for table, column in map(_column, specs):
            if column not in self.tables[table]["columns"]:
                raise ValueError(f"relation {rel['name']}: table {table} has no column {column}; "
                                 f"it has: {', '.join(self.tables[table]['columns'])}")
        return True

    def _check(self, table, cond):
        """A cut or selection condition must be well formed and name existing columns."""
        if isinstance(cond, dict):
            if "defined" in cond and cond["defined"] not in self.tables[table]["columns"]:
                raise ValueError(f"cut on {table}: no column {cond['defined']}")
            return
        expr, op, value = cond
        if op not in OPS or not isinstance(value, (int, float)):
            raise ValueError(f"cut on {table}: bad condition {cond}; use [column, one of {list(OPS)}, number]")
        missing = [c for c in _operands(expr) if c not in self.tables[table]["columns"]]
        if missing:
            raise ValueError(f"cut on {table}: no column {', '.join(missing)}")

    def _check_display(self, layer):
        table = layer["table"]
        cut = layer.get("cut") or {}
        named = [*layer["position"], *layer.get("end", []), *layer.get("axis", []), *layer.get("extent", []),
                 *layer.get("momentum", []), *(layer.get(k) for k in ("colour", "size", "time", "charge")),
                 cut.get("column")]
        missing = [c for c in named if c and c not in self.tables[table]["columns"]]
        if missing:
            raise ValueError(f"display {table}: no column {', '.join(missing)}; "
                             f"it has: {', '.join(self.tables[table]['columns'])}")

    def written(self):
        """Tables written to the bundle: all but the internal ones (read only to build relations or cuts)."""
        return {t: m for t, m in self.tables.items() if t not in self.internal}

    def header(self, files, profile_name):
        written = self.written()
        return {
            "schema": "evd/1",
            "source": {"files": [os.path.basename(f) for f in files], "converter": f"evdtools {__version__}",
                       "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")},
            "profile": profile_name,
            "tables": {t: {"doc": m["doc"], **({"scope": "run"} if t in self.run_scope else {}),
                           "columns": {c: {"type": type_code(dt), "doc": doc} for c, (dt, doc) in m["columns"].items()}}
                       for t, m in written.items()},
            "relations": {n: {"from": r["from"], "to": r["to"],
                              "weights": [_column(w)[1] for w in r.get("weights", [])],
                              **{k: r[k] for k in ("association", "best") if k in r}}  # viewer hints
                          for n, r in self.relations.items() if r["from"] in written and r["to"] in written},
            "display": self.display,
            **self.viewer_hints,
        }

    def branches(self, scope="event"):
        """Branches to read: of the per-event tables (Events tree), or with scope="run" of the per-run ones (Runs)."""
        tables = {t: m for t, m in self.tables.items() if (t in self.run_scope) == (scope == "run")}
        out = [f"n{t}" for t in tables]
        out += [f"{t}_{c}" for t, m in tables.items() for c in m["columns"] if (t, c) not in self.derived]
        return out + ["run"] + (["luminosityBlock", "event"] if scope == "event" else [])

    def selection_branches(self):
        """Branches that decide the event selection, so that a first pass can skip unselected events cheaply.
        None if there is no selection, or if it depends on derived columns or relations (then read everything)."""
        if not self.select:
            return None
        tables = {s["table"] for s in self.select}
        conds = [(t, c) for t in tables for c in self.cuts.get(t, [])]
        if any(isinstance(c, dict) for _, c in conds):
            return None
        conds += [(s["table"], c) for s in self.select for c in s.get("where", [])]
        cols = {(t, c) for t, cond in conds for c in _operands(cond[0])}
        if cols & self.derived:
            return None
        return sorted(f"n{t}" for t in tables) + sorted(f"{t}_{c}" for t, c in cols)

    def _read(self, arrays, i):
        """Tables of entry i, with whichever of their columns `arrays` holds."""
        return {t: (int(arrays[f"n{t}"][i]), {c: arrays[f"{t}_{c}"][i] for c in m["columns"] if f"{t}_{c}" in arrays})
                for t, m in self.tables.items() if f"n{t}" in arrays}

    def _derive(self, tables, skip=()):
        """Column derives (all but gather, which needs the relations) of the tables present, in profile order."""
        for d in self.derive:
            if "gather" not in d and d["table"] in tables and d["table"] not in skip \
                    and d.get("lookup", d["table"]) in tables:
                _derive(d, tables)

    def _masks(self, tables, relations, skip=()):
        """Row masks of the cut tables, in profile order: a reachedBy cut sees the cuts of the tables before it."""
        masks = {}
        for t, conds in self.cuts.items():
            if t not in tables or t in skip:
                continue
            n, cols = tables[t]
            keep = np.ones(n, bool)
            for cond in conds:
                if not isinstance(cond, dict):
                    keep &= _condition(cond, cols)
                elif "defined" in cond:  # not NaN (e.g. a gathered column)
                    keep &= ~np.isnan(np.asarray(cols[cond["defined"]], np.float64))
                else:  # rows of `to` that a kept `from` row points to, through any of the relations
                    reached = np.zeros(n, bool)
                    for name in cond["reachedBy"]:
                        rel, src = relations[name], masks.get(self.relations[name]["from"])
                        owner = np.repeat(np.arange(len(rel["offsets"]) - 1), np.diff(rel["offsets"]))
                        reached[rel["indices"] if src is None else rel["indices"][src[owner]]] = True
                    keep &= reached
            masks[t] = keep
        return masks

    def _selected(self, tables, masks):
        """Every requirement {"table", "where": [conditions], "min", "max"} holds for the rows that pass the cuts."""
        for s in self.select:
            n, cols = tables[s["table"]]
            rows = masks.get(s["table"], np.ones(n, bool)).copy()
            for cond in s.get("where", []):
                rows &= _condition(cond, cols)
            count = int(rows.sum())
            if count < s.get("min", 0) or count > s.get("max", count):
                return False
        return True

    def _cut_tables(self, tables, masks, skip=()):
        """The tables to write: rows cut by `masks`, internal tables (and `skip`) left out."""
        return {t: (int(masks[t].sum()), {c: a[masks[t]] for c, a in cols.items()}) if t in masks else (n, cols)
                for t, (n, cols) in tables.items() if t not in self.internal and t not in skip}

    def _renumber_index_columns(self, tables, masks):
        """An index column that an `index` relation reads (e.g. a candidate's track row, or a hit's cluster) must
        still name the same object after the table it points into is cut: rows are renumbered, removed ones -1."""
        for rel in self.relations.values():
            if rel["kind"] != "index" or "via" in rel:
                continue
            table, column = _column(rel["index"])
            target = rel["to"] if table == rel["from"] else rel["from"]  # the column may sit on either end
            if target not in masks:
                continue
            cols, keep = tables[table][1], masks[target]
            if cols[column].dtype.kind == "u":
                raise ValueError(f"relation {rel['name']}: index column {rel['index']} is unsigned, so it cannot "
                                 f"mark rows of the cut table {target} as removed")
            idx = np.asarray(cols[column], np.int64)
            ok = (idx >= 0) & (idx < len(keep))
            ok[ok] = keep[idx[ok]]
            cols[column] = np.where(ok, np.cumsum(keep)[np.where(ok, idx, 0)] - 1, -1).astype(cols[column].dtype)

    def passes(self, arrays, i):
        """The event selection, on the branches of selection_branches() only."""
        tables = self._read(arrays, i)
        return self._selected(tables, self._masks(tables, {}))

    def run_tables(self, arrays, i):
        """The per-run tables of entry i of the Runs tree, uncut (lookups index them by row)."""
        tables = self._read(arrays, i)
        self._derive(tables)
        return tables

    def run_record(self, run, tables):
        """(run id, tables, relations) written once for a run: its tables cut (plain conditions only)."""
        return (run, 0, 0), self._cut_tables(tables, self._masks(tables, {})), {}

    def event(self, arrays, i, run_tables=None):
        """Entry i of an uproot chunk -> (event id, tables, relations), or None if the event is not selected.
        `run_tables`: the tables of the event's run (see run_tables()), for lookups."""
        tables = self._read(arrays, i)
        event_id = (arrays["run"][i], arrays["luminosityBlock"][i], arrays["event"][i])
        tables.update(run_tables or {})
        for s in self.same:
            _check_same(s, tables, event_id)
            tables[s["keep"]][1].update({c: tables[s["drop"]][1][c] for c in s.get("copy", [])})
        self._derive(tables, skip=self.run_scope)
        relations = {}
        for name, rel in self.relations.items():  # in profile order, so a composition follows its parts
            relations[name] = _compose(*(relations[v] for v in rel["via"])) if rel["kind"] == "compose" \
                else _relation(rel, tables)
        for d in self.derive:
            if "gather" in d:
                _gather(d, tables, relations, self.relations)
        masks = self._masks(tables, relations, skip=self.run_scope)
        if not self._selected(tables, masks):
            return None
        self._renumber_index_columns(tables, masks)
        ends = {name: (rel["from"], rel["to"]) for name, rel in self.relations.items()}
        relations = {name: cut_relation(rel, masks.get(ends[name][0]), masks.get(ends[name][1]))
                     for name, rel in relations.items() if not set(ends[name]) & self.internal}
        return event_id, self._cut_tables(tables, masks, skip=self.run_scope), relations


def _open(path):
    """uproot.open; root:// URLs go through the XRootD bindings directly (fsspec-xrootd is not in CMSSW)."""
    if path.startswith("root://"):
        return uproot.open(path, handler=uproot.source.xrootd.XRootDSource)
    return uproot.open(path)


def _run_tables(conv, f):
    """{run: per-run tables} of an open file (empty if the profile uses no per-run table)."""
    if not conv.run_scope or "Runs" not in f:
        return {}
    arrays = f["Runs"].arrays([b for b in conv.branches("run") if b in f["Runs"].keys()], library="np")
    return {int(arrays["run"][i]): conv.run_tables(arrays, i) for i in range(len(arrays["run"]))}


def parse_events(spec):
    """Event numbers from "416622,416630-416640" (ranges inclusive)."""
    out = set()
    for part in filter(None, (p.strip() for p in spec.split(","))):
        lo, _, hi = part.partition("-")
        out.update(range(int(lo), int(hi or lo) + 1))
    return out


def _entries(tree, conv, events, progress):
    """(arrays, i) of the entries of an Events tree to convert. `events`: only these event numbers, found from the
    event branch alone and read one at a time, in event order. Otherwise, with an event selection on plain columns,
    a first pass reads only the branches that decide it, and an entry is read in full only if it passes;
    progress(entries scanned) is called after each chunk."""
    full = conv.branches()
    entry = lambda e: tree.arrays(full, entry_start=e, entry_stop=e + 1, library="np")
    if events is not None:
        numbers = tree["event"].array(library="np")
        chosen = np.flatnonzero(np.isin(numbers, list(events)))
        progress(len(chosen))
        for e in chosen[np.argsort(numbers[chosen], kind="stable")]:  # before, during, after
            yield entry(e), 0
        return
    pre = conv.selection_branches()
    for arrays, report in tree.iterate(pre or full, step_size="200 MB", library="np", report=True):
        for i in range(report.tree_entry_stop - report.tree_entry_start):
            if pre is None:
                yield arrays, i
            elif conv.passes(arrays, i):
                yield entry(report.tree_entry_start + i), 0
        progress(report.tree_entry_stop)


def _records(conv, files, log, events=None, runs=None):
    """(record, run tables) of the converted events of `files`, in order. `events`: only these event numbers;
    `runs`: per-run tables to use instead of each file's own."""
    def progress(n):
        if events is not None:
            print(f"{name}: {n} of the requested events", file=log)
        elif conv.select:
            print(f"{name}: scanned {n}, selected {selected}", file=log)

    for path in files:
        name, selected = os.path.basename(path), 0
        with _open(path) as f:
            file_runs = _run_tables(conv, f) if runs is None else runs
            for arrays, i in _entries(f["Events"], conv, events, progress):
                run_tables = file_runs.get(int(arrays["run"][i]))
                record = conv.event(arrays, i, run_tables)
                if record is not None:
                    selected += 1
                    yield record, run_tables


def convert(files, output, profile_name="hgcal", max_events=None, log=sys.stderr, data_time=None, run_info=None,
            events=None, run_tables=None):
    """Write the (selected) events of `files` to the bundle `output`; `data_time`: when the input was produced;
    `run_info`: where to find information about the runs (see runinfo.load); `events`: only these event numbers;
    `run_tables`: a NanoAOD file whose Runs tree has the per-run tables (e.g. the channel table) of the same runs,
    for inputs made without them."""
    profile = load_profile(profile_name)
    with _open(files[0]) as f, _open(run_tables or files[0]) as r:
        conv = Converter(discover(f["Events"]), profile, discover(r["Runs"]) if "Runs" in r else None)
        runs = _run_tables(conv, r) if run_tables else None
    if run_tables:
        print(f"per-run tables of run(s) {sorted(runs)} from {os.path.basename(run_tables)}", file=log)
    print(f"{len(conv.written())} tables, {len(conv.relations)} relations, {len(conv.display)} display layers",
          file=log)
    header = conv.header(files, profile.get("name", profile_name))
    if data_time:
        header["source"]["data_time"] = data_time.isoformat(timespec="seconds")
    written, runs_written = 0, set()
    with BundleWriter(output, header) as out:
        for record, per_run in itertools.islice(_records(conv, files, log, events, runs), max_events):
            run = int(record[0][0])
            if per_run and run not in runs_written:
                out.add_run(*conv.run_record(run, per_run))
                runs_written.add(run)
            out.add(*record)
            written += 1
        if run_info:
            from .runinfo import load
            info = load(run_info, out.runs(), log=log)
            print(f"run info for {len(info)} run(s) from {run_info}", file=log)
            out.set_run_info(info)
    return written
