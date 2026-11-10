"""NanoAOD -> .evdb conversion, driven by a display profile (evdtools/profiles/*.json).

The profile names tables to drop, derived columns, relations, row cuts, an event selection and display layers.
Anything that refers to a table the file does not contain is dropped, so one profile serves legacy-only, SoA-only
and mixed files. The profile keys are described in README.md ("Profiles").

Per event: read tables -> derive columns -> build relations (CSR) -> row cuts -> event selection -> cut relations
(indices remapped, links to removed rows dropped) -> drop internal tables.
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


def load_profile(name_or_path):
    path = name_or_path if os.path.exists(name_or_path) else os.path.join(PROFILES, f"{name_or_path}.json")
    with open(path) as f:
        return json.load(f)


def discover(tree):
    """Collection tables of a NanoAOD Events tree: {table: {"doc": str, "columns": {column: (dtype, doc)}}}."""
    branches = tree.keys()  # file order = the producers' column order
    keys = set(branches)
    columns = defaultdict(dict)
    for branch in branches:
        table, sep, column = branch.partition("_")
        if sep and f"n{table}" in keys:
            columns[table][column] = (tree[branch].interpretation.content.from_dtype, tree[branch].title)
    return {t: {"doc": tree[f"n{t}"].title, "columns": cols} for t, cols in columns.items()}


def _column(spec):
    table, _, column = spec.partition(".")
    return table, column


def _operands(expr):
    """Columns of a condition's left-hand side: "col" or "col/col"."""
    return expr.split("/", 1)


def _condition(cond, cols):
    """Row mask of one [expr, op, value] condition; expr is a column or a ratio "a/b" of two columns."""
    expr, op, value = cond
    num, _, den = expr.partition("/")
    with np.errstate(divide="ignore", invalid="ignore"):  # x/0 -> inf or nan, and nan fails every comparison
        lhs = cols[num] / cols[den] if den else cols[num]
        return OPS[op](lhs, value)


def _derived_columns(d):
    if "lookup" in d:
        return list(d["columns"])
    if "gather" in d:
        return list(dict.fromkeys(c for src in d["gather"] for c in src["columns"]))
    return ["x", "y"] if "xyFromEtaPhiZ" in d else [d["column"]]


def _gather(d, tables, relations, profile_relations):
    """Columns copied from the first row each row of `table` points to through a relation; the sources are tried in
    order. A source that places a row sets the columns it does not name to 0; rows no source reaches stay NaN."""
    n, cols = tables[d["table"]]
    out = {c: np.full(n, np.nan, np.float32) for c in _derived_columns(d)}
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


def _lookup(d, tables):
    """Columns copied from the row of a lookup table (e.g. a per-run channel table) whose position is given by an
    index column: `columns` maps new column -> lookup column. Rows with an index outside the table get NaN (floats)
    or -1 (integers)."""
    n, cols = tables[d["table"]]
    _, source = tables[d["lookup"]]
    idx = np.asarray(cols[d["index"]], np.int64)
    some = next(iter(source.values()), np.zeros(0))
    ok = (idx >= 0) & (idx < len(some))
    for new, col in d["columns"].items():
        src = np.asarray(source[col])
        fill = np.nan if src.dtype.kind == "f" else -1
        out = np.full(n, fill, src.dtype if src.dtype.kind != "u" else np.int64)
        out[ok] = src[idx[ok]]
        cols[new] = out


def _compose(a, b):
    """CSR relation A->C from A->B and B->C: each row of A reaches the union of what its B rows reach."""
    a_off, b_off = np.asarray(a["offsets"], np.int64), np.asarray(b["offsets"], np.int64)  # "counts" offsets may be float
    offsets, indices = [0], []
    for f in range(len(a_off) - 1):
        mids = a["indices"][a_off[f]:a_off[f + 1]]
        reached = np.unique(np.concatenate([b["indices"][b_off[m]:b_off[m + 1]] for m in mids])) \
            if len(mids) else np.zeros(0, np.int64)
        indices.append(reached)
        offsets.append(offsets[-1] + len(reached))
    return {"offsets": np.array(offsets), "indices": np.concatenate(indices) if indices else np.zeros(0, np.int64),
            "weights": {}}


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


def cut_relation(rel, keep_from, keep_to):
    """A CSR relation restricted to kept rows (masks, or None for an uncut table): rows of removed `from` objects
    and links to removed `to` rows are dropped, and the remaining indices are renumbered."""
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


def _display(profile, tables, relations):
    """Display layers for the tables present. A layer with a `kind` takes that kind's style from the profile's
    `kinds` (its own keys win; `cut` is merged key by key) and is grouped under the kind's label, kinds in profile
    order. Within a kind, layers whose `source` ranks below the best source present (profile `prefer`, first is
    best) start hidden, so a file with both SoA and legacy objects shows one of them by default.

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
    preferred = [layer for layer in layers if layer.get("kind") and rank(layer) == best[layer["kind"]]]
    stages = [k for k in profile.get("stages", []) if any(layer["kind"] == k for layer in preferred)]
    for layer in preferred:
        kind = layer.get("stageOf", layer["kind"])  # e.g. tracks shown with the candidates that use them
        if kind in stages:
            layer["stage"] = stages.index(kind)
            if layer["stage"] < len(stages) - 1:
                layer["visible"] = False
    for layer in layers:
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
        """`tables`: the per-event tables of the file; `run_tables`: the per-run tables (NanoAOD Runs tree), which
        are written once per run and can be looked up from event tables (derive `lookup`)."""
        keep = lambda t: not any(fnmatch.fnmatch(t, p) for p in profile.get("exclude", []))
        run_tables = {t: m for t, m in (run_tables or {}).items() if keep(t) and t not in tables}
        self.run_scope = set(run_tables)
        self.tables = {t: m for t, m in {**tables, **run_tables}.items() if keep(t)}
        self.internal = set(profile.get("internal", [])) & set(self.tables)
        # Tables with the same rows as another (e.g. legacy objects converted 1:1 from SoA): checked on every event,
        # not written, and relations to or from them are redirected to the table that is kept.
        self.same = [s for s in profile.get("sameRows", []) if s["keep"] in self.tables and s["drop"] in self.tables]
        rename = {s["drop"]: s["keep"] for s in self.same}
        self.internal |= set(rename)
        self.derive = [d for d in profile.get("derive", []) if d["table"] in self.tables and d.get("lookup", d["table"]) in self.tables]
        self.derived = set()
        for d in self.derive:
            for c in _derived_columns(d):
                if "lookup" in d:
                    src = d["columns"][c]
                    if src not in self.tables[d["lookup"]]["columns"] or d["index"] not in self.tables[d["table"]]["columns"]:
                        raise ValueError(f"lookup {d['table']} -> {d['lookup']}: no column {src} or {d['index']}")
                    dtype, doc = self.tables[d["lookup"]]["columns"][src]
                    dtype = np.dtype(np.int64) if np.dtype(dtype).kind == "u" else np.dtype(dtype)
                    self.tables[d["table"]]["columns"][c] = (dtype, f"{doc} (from {d['lookup']}.{src} by {d['index']})")
                    self.derived.add((d["table"], c))
                    continue
                doc = ("copied through " + ", ".join(s["relation"] for s in d["gather"]) + " (first linked row)" if "gather" in d else
                       f"derived from {', '.join(d['xyFromEtaPhiZ'])}" if "xyFromEtaPhiZ" in d else
                       f"derived: {d.get('scale', 1.0):g} x distance to neighbour {d.get('k', 1)} in "
                       f"({', '.join(d['neighbourDistance'])})" + (f" per {d['groupBy']}" if "groupBy" in d else ""))
                self.tables[d["table"]]["columns"][c] = (np.dtype("f4"), doc)
                self.derived.add((d["table"], c))
        self.relations = {}
        for r in profile.get("relations", []):
            r = {**r, "from": rename.get(r["from"], r["from"]), "to": rename.get(r["to"], r["to"])}
            if self._available(r):
                self.relations[r["name"]] = r
        self.cuts = {t: [c for c in conds if not isinstance(c, dict) or c.get("reachedBy", "") in self.relations
                         or "defined" in c]
                     for t, conds in profile.get("cuts", {}).items() if t in self.tables}
        self.select = [s for s in profile.get("select", []) if s["table"] in self.tables]
        for t, cond in [(t, c) for t, conds in self.cuts.items() for c in conds if not isinstance(c, dict)] + \
                       [(s["table"], c) for s in self.select for c in s.get("where", [])]:
            self._check(t, cond)
        for t, conds in self.cuts.items():
            for c in conds:
                if isinstance(c, dict) and "defined" in c and c["defined"] not in self.tables[t]["columns"]:
                    raise ValueError(f"cut on {t}: no column {c['defined']}")
            text = " and ".join(f"reached by {c['reachedBy']}" if isinstance(c, dict) and "reachedBy" in c else
                                f"{c['defined']} defined" if isinstance(c, dict) else " ".join(map(str, c)) for c in conds)
            self.tables[t]["doc"] += f" (cut: {text})"
        self.display = _display(profile, self.written(), self.relations)
        for layer in self.display:
            self._check_display(layer)
        self.replay = profile.get("replay")  # passed to the viewer verbatim
        self.profile_extra = profile  # `view` and `summaries` are passed to the viewer verbatim too

    def _available(self, rel):
        """A relation is kept if all its tables (for "compose": the relations it chains) are in the file; then every
        column it names must exist."""
        if rel["kind"] == "compose":
            return all(name in self.relations for name in rel["via"])
        specs = [rel.get(k) for k in ("offsets", "counts", "indices", "index", "via", "fromIndex", "toIndex")]
        specs = [s for s in specs + rel.get("weights", []) if s]
        tables = {rel["from"], rel["to"], rel.get("table")} | {_column(s)[0] for s in specs}
        if not all(t is None or t in self.tables for t in tables):
            return False
        for table, column in map(_column, specs):
            if column not in self.tables[table]["columns"]:
                raise ValueError(f"relation {rel['name']}: table {table} has no column {column}; "
                                 f"it has: {', '.join(self.tables[table]['columns'])}")
        return True

    def _check_display(self, layer):
        table = layer["table"]
        cut = layer.get("cut") or {}
        named = [*layer["position"], *layer.get("end", []), *layer.get("axis", []), *layer.get("extent", []),
                 *(layer.get(k) for k in ("colour", "size", "time")), cut.get("column")]
        missing = [c for c in named if c and c not in self.tables[table]["columns"]]
        if missing:
            raise ValueError(f"display {table}: no column {', '.join(missing)}; "
                             f"it has: {', '.join(self.tables[table]['columns'])}")

    def _check(self, table, cond):
        expr, op, value = cond
        if op not in OPS or not isinstance(value, (int, float)):
            raise ValueError(f"cut on {table}: bad condition {cond}; use [column, one of {list(OPS)}, number]")
        missing = [c for c in _operands(expr) if c not in self.tables[table]["columns"]]
        if missing:
            raise ValueError(f"cut on {table}: no column {', '.join(missing)}")

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
            "relations": {n: {"from": r["from"], "to": r["to"], "weights": [_column(w)[1] for w in r.get("weights", [])]}
                          for n, r in self.relations.items() if r["from"] in written and r["to"] in written},
            "display": self.display,
            **({"replay": self.replay} if self.replay else {}),
            **{k: self.profile_extra[k] for k in ("view", "summaries") if k in self.profile_extra},
        }

    def branches(self, scope="event"):
        """Branches to read: of the per-event tables (Events tree), or with scope="run" of the per-run ones."""
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

    def _masks(self, tables, relations, skip=()):
        """Row masks of the cut tables, in profile order: a reachedBy cut sees the cuts of the tables before it."""
        masks = {}
        for t, conds in self.cuts.items():
            if t not in tables or t in skip:
                continue
            n, cols = tables[t]
            keep = np.ones(n, bool)
            for cond in conds:
                if isinstance(cond, dict) and "defined" in cond:  # a value that is not NaN (e.g. a gathered column)
                    keep &= ~np.isnan(np.asarray(cols[cond["defined"]], np.float64))
                elif isinstance(cond, dict):  # rows of `to` that a kept `from` row points to
                    name = cond["reachedBy"]
                    rel, src = relations[name], masks.get(self.relations[name]["from"])
                    owner = np.repeat(np.arange(len(rel["offsets"]) - 1), np.diff(rel["offsets"]))
                    reached = np.zeros(n, bool)
                    reached[rel["indices"] if src is None else rel["indices"][src[owner]]] = True
                    keep &= reached
                else:
                    keep &= _condition(cond, cols)
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

    def passes(self, arrays, i):
        """The event selection on the branches of selection_branches() only."""
        tables = self._read(arrays, i)
        return self._selected(tables, self._masks(tables, {}))

    def run_tables(self, arrays, i):
        """The per-run tables of entry i of the Runs tree, as read (uncut: lookups index them by row)."""
        tables = self._read(arrays, i)
        for d in self.derive:
            if d["table"] in tables and "neighbourDistance" in d:
                tables[d["table"]][1][d["column"]] = _neighbour_distance(d, tables[d["table"]][1])
        return tables

    def run_record(self, run, tables):
        """What is written of a run's tables: cut (plain conditions only), internal ones dropped."""
        masks = {t: m for t, m in self._masks({t: v for t, v in tables.items()}, {}).items() if t in tables}
        return (run, 0, 0), {t: (int(masks[t].sum()), {c: a[masks[t]] for c, a in cols.items()}) if t in masks else (n, cols)
                             for t, (n, cols) in tables.items() if t not in self.internal}, {}

    def event(self, arrays, i, run_tables=None):
        """One entry of an uproot chunk -> (event id, tables, relations), or None if the event is not selected.
        `run_tables`: this event's run's tables (see run_tables()), for lookups."""
        tables = self._read(arrays, i)
        event_id = (arrays["run"][i], arrays["luminosityBlock"][i], arrays["event"][i])
        tables.update(run_tables or {})
        for s in self.same:
            self._check_same(s, tables, event_id)
        for d in self.derive:
            if d["table"] not in tables or d["table"] in self.run_scope:
                continue
            _, cols = tables[d["table"]]
            if "lookup" in d:
                if d["lookup"] in tables:
                    _lookup(d, tables)
            elif "xyFromEtaPhiZ" in d:
                eta, phi, z = (cols[c].astype(np.float64) for c in d["xyFromEtaPhiZ"])
                r = z / np.sinh(eta)  # transverse radius: tan(theta) = 1 / sinh(eta)
                cols["x"], cols["y"] = (r * np.cos(phi)).astype(np.float32), (r * np.sin(phi)).astype(np.float32)
            elif "neighbourDistance" in d:
                cols[d["column"]] = _neighbour_distance(d, cols)
        relations = {}
        for name, rel in self.relations.items():  # in profile order, so a composed relation follows its parts
            relations[name] = _compose(*(relations[v] for v in rel["via"])) if rel["kind"] == "compose" \
                else self._relation(rel, tables)
        for d in self.derive:
            if "gather" in d:
                _gather(d, tables, relations, self.relations)
        masks = self._masks(tables, relations, skip=self.run_scope)
        if not self._selected(tables, masks):
            return None
        ends = {name: (self.relations[name]["from"], self.relations[name]["to"]) for name in relations}
        relations = {name: cut_relation(rel, masks.get(ends[name][0]), masks.get(ends[name][1]))
                     if ends[name][0] in masks or ends[name][1] in masks else rel
                     for name, rel in relations.items() if not set(ends[name]) & self.internal}
        tables = {t: (int(masks[t].sum()), {c: a[masks[t]] for c, a in cols.items()}) if t in masks else (n, cols)
                  for t, (n, cols) in tables.items() if t not in self.internal and t not in self.run_scope}
        return event_id, tables, relations

    @staticmethod
    def _check_same(s, tables, event_id):
        """sameRows: the dropped table must have the kept table's rows, in the same order."""
        (n_keep, keep), (n_drop, drop) = tables[s["keep"]], tables[s["drop"]]
        bad = [f"{a}/{b}" for a, b in s["columns"] if n_keep == n_drop and not np.allclose(keep[a], drop[b], rtol=1e-5, atol=1e-6)]
        if n_keep != n_drop or bad:
            raise ValueError(f"sameRows {s['keep']} / {s['drop']}: event {tuple(int(x) for x in event_id)} differs "
                             f"({f'{n_keep} vs {n_drop} rows' if n_keep != n_drop else ', '.join(bad)}); "
                             "remove this sameRows entry from the profile to keep both tables")

    @staticmethod
    def _relation(rel, tables):
        """Normalise any source form to CSR: offsets (n_from + 1), indices, weights."""
        col = lambda spec: tables[_column(spec)[0]][1][_column(spec)[1]]
        n_from, n_to = tables[rel["from"]][0], tables[rel["to"]][0]
        weights = {_column(w)[1]: col(w) for w in rel.get("weights", [])}
        kind = rel["kind"]
        if kind == "offsets":  # explicit n+1 offsets (e.g. an exported AssociationMap)
            offsets, indices = col(rel["offsets"]), col(rel["indices"])
        elif kind == "counts":  # NanoAOD per-object counts + flat list
            offsets, indices = np.concatenate([[0], np.cumsum(col(rel["counts"]))]), col(rel["indices"])
        elif kind == "links":  # one row per (from, to) pair, ordered by `from`; to < 0 means no target
            src, dst = col(rel["fromIndex"]), col(rel["toIndex"])
            keep = dst >= 0
            src, indices = src[keep], dst[keep]
            weights = {w: a[keep] for w, a in weights.items()}
            offsets = np.concatenate([[0], np.cumsum(np.bincount(src, minlength=n_from))])
        elif kind == "index":  # a column of `from` holding one row of `to` (< 0: none), optionally through a lookup
            idx = col(rel["index"])
            if "via" in rel:  # `via` maps the index column to rows of `to`, e.g. a dense index -> digi row table
                via = col(rel["via"])
                ok = (idx >= 0) & (idx < len(via))
                idx = np.where(ok, via[np.where(ok, idx, 0)], -1)
            offsets, indices = np.concatenate([[0], np.cumsum(idx >= 0)]), idx[idx >= 0]
        else:
            raise ValueError(f"relation {rel['name']}: unknown kind {kind}")
        if len(offsets) != n_from + 1 or offsets[-1] != len(indices) or (len(indices) and indices.max() >= n_to):
            raise ValueError(f"relation {rel['name']}: inconsistent with tables {rel['from']} ({n_from}) and "
                             f"{rel['to']} ({n_to})")
        return {"offsets": offsets, "indices": indices, "weights": weights}


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


def _records(conv, files, log):
    """(record, run tables) of the converted events of `files`, in order. With an event selection on plain columns,
    a first pass reads only the branches that decide it, and the full event is read only for the selected entries."""
    pre, full = conv.selection_branches(), conv.branches()
    scanned = selected = 0
    for path in files:
        with _open(path) as f:
            runs = _run_tables(conv, f)
            tree = f["Events"]
            for arrays, report in tree.iterate(pre or full, step_size="200 MB", library="np", report=True):
                n = report.tree_entry_stop - report.tree_entry_start
                for i in range(n):
                    run_tables = runs.get(int(arrays["run"][i])) if runs else None
                    if pre is None:
                        record = conv.event(arrays, i, run_tables)
                    elif conv.passes(arrays, i):
                        e = report.tree_entry_start + i
                        record = conv.event(tree.arrays(full, entry_start=e, entry_stop=e + 1, library="np"), 0, run_tables)
                    else:
                        continue
                    if record is not None:
                        selected += 1
                        yield record, run_tables
                scanned += n
                if conv.select:
                    print(f"{os.path.basename(path)}: scanned {scanned}, selected {selected}", file=log)


def convert(files, output, profile_name="hgcal", max_events=None, log=sys.stderr, data_time=None):
    """Write the (selected) events of `files` to the bundle `output`; `data_time`: when the input was produced."""
    profile = load_profile(profile_name)
    with _open(files[0]) as f:
        conv = Converter(discover(f["Events"]), profile, discover(f["Runs"]) if "Runs" in f else None)
    print(f"{len(conv.written())} tables, {len(conv.relations)} relations, {len(conv.display)} display layers", file=log)
    written = 0
    header = conv.header(files, profile.get("name", profile_name))
    if data_time:
        header["source"]["data_time"] = data_time.isoformat(timespec="seconds")
    with BundleWriter(output, header) as out:
        runs_written = set()
        for record, run_tables in itertools.islice(_records(conv, files, log), max_events):
            run = int(record[0][0])
            if run_tables and run not in runs_written:
                out.add_run(*conv.run_record(run, run_tables))
                runs_written.add(run)
            out.add(*record)
            written += 1
    return written
