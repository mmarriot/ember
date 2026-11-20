"""The Converter: a display profile resolved against the tables of one file, which turns events into bundle records.

Resolving a profile drops its entries for tables the file lacks, so that one profile serves legacy-only, SoA-only and
mixed files; of a mixed file it writes one source per kind (profile `prefer`). Tables of the Runs tree are per-run
tables: read once per run, available to lookups, and written once per run. A NanoAOD singleton table (one row per
event, no counter, e.g. MET) is kept only if the profile uses it, and with `"keepUnused": false` every table the
profile does not use is left out (a standard NanoAOD has a hundred tables of which a profile draws a few).

Each event then goes through these steps (Converter.event):
  read its tables -> derive columns (and split tables) -> build the relations (CSR) -> gather columns through them ->
  row cuts -> event selection -> renumber index columns and cut the relations (links to removed rows dropped) ->
  leave out the internal and per-run tables.

Tables are held as {name: (rows, {column: numpy array})}; relations as in relations.py.
"""

import datetime
import fnmatch
import os
import re

import numpy as np

from . import __version__
from .bundle import type_code
from .derive import OPS, apply_derive, derived_columns, gather

# The names that viewer filter expressions read as constants, not columns (viewer/src/model/expr.ts CONSTANTS).
CONSTANTS = {"pi"}
from .display import display_layers, less_preferred, named_columns
from .profile import table_column
from .relations import build_relation, compose_relations, cut_relation, owner_rows

# Profile keys the converter acts on; every other top-level key is a viewer setting, copied to the header as it is.
PROFILE_KEYS = {
    "name",
    "note",
    "include",
    "exclude",
    "internal",
    "sameRows",
    "derive",
    "relations",
    "cuts",
    "select",
    "display",
    "kinds",
    "order",
    "prefer",
    "stages",
    "keepUnused",
    "omit",
}
HEADER_KEYS = {"schema", "source", "profile", "tables"}  # written by the converter, never taken from the profile


class Converter:
    """A profile resolved against a file's tables. Built once per conversion; event() converts one event."""

    def __init__(self, tables, profile, run_tables=None):
        """`tables`: the per-event tables of the file, `run_tables` the per-run ones (Runs tree), as discover() gives
        them (see nano.discover). The metadata of derived and copied columns is added to these dictionaries."""

        used = used_tables(profile)
        keep_unused = profile.get("keepUnused", True)

        def wanted(table, meta):
            if any(fnmatch.fnmatch(table, p) for p in profile.get("exclude", [])):
                return False
            return table in used or (keep_unused and not meta.get("singleton"))

        run_tables = {t: m for t, m in (run_tables or {}).items() if wanted(t, m) and t not in tables}
        self.run_scope = set(run_tables)
        self.tables = {t: m for t, m in {**tables, **run_tables}.items() if wanted(t, m)}
        self.made = set()  # tables made by a split, not read from the file
        # omit: "Table.column" of columns neither read nor written (e.g. one a producer writes that nothing uses)
        for spec in profile.get("omit", []):
            table, column = table_column(spec)
            self.tables.get(table, {}).get("columns", {}).pop(column, None)

        # sameRows: a table with the same rows as another (e.g. legacy objects converted 1:1 from SoA) is checked on
        # every event and not written; relations to or from it are redirected to the kept table.
        self.same = [s for s in profile.get("sameRows", []) if s["keep"] in self.tables and s["drop"] in self.tables]
        self.internal = (set(profile.get("internal", [])) & set(self.tables)) | {s["drop"] for s in self.same}
        # One source per kind (profile `prefer`): the tables of the less preferred sources are not written.
        self.internal |= less_preferred(profile, set(self.tables) - self.internal)
        self.derived = set()  # (table, column) of the columns that are made here, not read from the file
        self._take_over_copied_columns()

        self.derive = self._resolve_derives(profile)
        self.relations = self._resolve_relations(profile)
        self.cuts = self._resolve_cuts(profile)
        self.select = [s for s in profile.get("select", []) if s["table"] in self.tables]
        for s in self.select:
            for c in s.get("where", []):
                self._check_condition(s["table"], c)

        self.display = self._resolve_display(profile)
        self.viewer_hints = self._viewer_hints(profile)

    # Resolving the profile against the file's tables, in the order __init__ calls them.

    def _take_over_copied_columns(self):
        """sameRows `copy`: columns of the dropped table that the kept table takes over."""
        for s in self.same:
            keep, drop = self.tables[s["keep"]]["columns"], self.tables[s["drop"]]["columns"]
            for c in s.get("copy", []):
                if c not in drop or c in keep:
                    raise ValueError(
                        f"sameRows {s['keep']} / {s['drop']}: cannot copy column {c} (missing from "
                        f"{s['drop']}, or already in {s['keep']})"
                    )
                keep[c] = drop[c]
                self.derived.add((s["keep"], c))

    def _resolve_derives(self, profile):
        """The derives whose tables are present, in profile order, with their columns added to the tables' metadata.
        A split adds its tables (which later derives may name) and leaves its source table out of the bundle."""
        derives = []
        for d in profile.get("derive", []):
            if d["table"] not in self.tables or d.get("lookup", d["table"]) not in self.tables:
                continue
            if "parentRow" in d and d["counts"].split(".")[0] not in self.tables:
                continue
            own = self.tables[d["table"]]["columns"]
            if "nanUnless" in d and not {d["nanUnless"][0], *d["columns"]} <= set(own):
                continue  # e.g. tracks without a time (no tofPID in the input): nothing to blank
            derives.append(d)
            if "split" in d:
                self._resolve_split(d)
                continue
            for c, meta in derived_columns(d, self.tables).items():
                if (d.get("missing") or "nanUnless" in d) and c in self.tables[d["table"]]["columns"]:
                    continue  # a stored column that the derive only changes in places (NaN filled, or set): still read
                self.tables[d["table"]]["columns"][c] = meta
                self.derived.add((d["table"], c))
        return derives

    def _resolve_split(self, d):
        """split: {new table: [conditions]}: each new table has the source's columns (as derived so far) and the rows
        that pass its conditions."""
        source = self.tables[d["table"]]
        for new, conds in d["split"].items():
            if new in self.tables:
                raise ValueError(f"split {d['table']}: the file already has a table {new}")
            for cond in conds:
                self._check_condition(d["table"], cond)
            self.tables[new] = {
                "doc": f"{source['doc']} ({' and '.join(map(_describe_condition, conds))})",
                "columns": dict(source["columns"]),
            }
            self.made.add(new)
            self.derived |= {(new, c) for c in source["columns"]}
        self.internal.add(d["table"])

    def _resolve_relations(self, profile):
        """{name: profile relation} of the relations the file can serve, in profile order, with the ends of sameRows
        tables redirected to the kept table. A compose relation takes the ends of its chain."""
        names = [r["name"] for r in profile.get("relations", [])]
        twice = sorted({n for n in names if names.count(n) > 1})
        if twice:  # e.g. two included profiles naming different relations alike: the later would replace the earlier
            raise ValueError(f"relation names used twice in the profile: {', '.join(twice)}")

        rename = {s["drop"]: s["keep"] for s in self.same}
        relations = {}
        for r in profile.get("relations", []):
            if r["kind"] == "compose":
                if all(v in relations for v in r["via"]):
                    relations[r["name"]] = {
                        **r,
                        "from": relations[r["via"][0]]["from"],
                        "to": relations[r["via"][-1]]["to"],
                    }
                continue
            r = {**r, "from": rename.get(r["from"], r["from"]), "to": rename.get(r["to"], r["to"])}
            if self._available(r):
                relations[r["name"]] = r

        for r in relations.values():  # inverseOf: r points from a part back up to its container
            inverse = relations.get(r.get("inverseOf"))
            if inverse and (inverse["from"], inverse["to"]) != (r["to"], r["from"]):
                raise ValueError(
                    f"relation {r['name']} ({r['from']} -> {r['to']}) is not the inverse of "
                    f"{inverse['name']} ({inverse['from']} -> {inverse['to']})"
                )
        return relations

    def _available(self, rel):
        """Whether the file can serve a relation: all its tables are present and none of its `unless` tables is. A
        relation that can be served must name existing columns, but an `optional` one, which is then not built (an
        index column that one export writes and another does not: ember's own Electron table has the row of its GSF
        track, a standard NanoAOD's has none)."""
        keys = ("offsets", "counts", "indices", "index", "via", "fromIndex", "toIndex", "fromKey", "toKey")
        specs = [s for s in [rel.get(k) for k in keys] + rel.get("weights", []) if s]
        tables = {rel["from"], rel["to"], rel.get("table")} | {table_column(s)[0] for s in specs}
        if not all(t is None or t in self.tables for t in tables):
            return False
        if any(t in self.tables for t in rel.get("unless", [])):
            return False
        for table, column in map(table_column, specs):
            if column not in self.tables[table]["columns"]:
                if rel.get("optional"):
                    return False
                raise ValueError(
                    f"relation {rel['name']}: table {table} has no column {column}; "
                    f"it has: {', '.join(self.tables[table]['columns'])}"
                )
        return True

    def _resolve_cuts(self, profile):
        """{table: conditions} of the row cuts of the tables present. A reachedBy condition keeps the relations that
        are present, and is dropped if none is; a table left with no condition is not cut. A cut table's description
        says its cut."""

        def usable(cond):
            if not (isinstance(cond, dict) and "reachedBy" in cond):
                return cond
            via = [cond["reachedBy"]] if isinstance(cond["reachedBy"], str) else cond["reachedBy"]
            present = [r for r in via if r in self.relations]
            return {"reachedBy": present} if present else None

        cuts = {}
        for t, conds in profile.get("cuts", {}).items():
            if t not in self.tables:
                continue
            conds = [u for u in map(usable, conds) if u is not None]
            if conds:
                cuts[t] = conds
        for t, conds in cuts.items():
            for c in conds:
                self._check_condition(t, c)
            self.tables[t]["doc"] += f" (cut: {' and '.join(map(_describe_condition, conds))})"
        return cuts

    def _check_condition(self, table, cond):
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

    def _resolve_display(self, profile):
        """The display layers of the tables written. A path layer (a polyline) needs its points relation: without it
        (a table absent) the layer is dropped, as the layers of absent tables are."""
        layers = [
            layer
            for layer in display_layers(profile, self.written(), self.relations)
            if (layer.get("points") or {}).get("relation", None) in (None, *self.relations)
        ]
        for layer in layers:
            if "filter" in layer and not self._filterable(layer["table"], layer["filter"]):
                del layer["filter"]  # e.g. puppiWeight > 0 for an input without PUPPI weights
            columns = self.tables[layer["table"]]["columns"]
            # one profile serves files with and without these columns (ember's own NanoAOD, a standard one)
            groups = [
                {**g, "columns": [c for c in g["columns"] if c in columns]} for g in layer.pop("inspectGroups", [])
            ]
            if any(g["columns"] for g in groups):
                layer["inspectGroups"] = [g for g in groups if g["columns"]]
            without = layer.pop("labelWithout", None)
            if without and without["column"] not in columns:
                layer["label"] = without["label"]
            missing = [c for c in named_columns(layer) if c and c not in columns]
            if missing:
                raise ValueError(
                    f"display {layer['table']}: no column {', '.join(missing)}; it has: {', '.join(columns)}"
                )
        return layers

    def _viewer_hints(self, profile):
        """The profile keys the converter does not act on, for the header. Like the entries of absent tables,
        `domains` that none of the layers is in are dropped, and so are the parts of `presets` that name absent
        tables."""
        hints = {k: v for k, v in profile.items() if k not in PROFILE_KEYS}
        if set(hints) & HEADER_KEYS:
            raise ValueError(f"profile keys {sorted(set(hints) & HEADER_KEYS)} are the bundle header's own")
        if "domains" in hints:
            used = {layer.get("domain") for layer in self.display}
            hints["domains"] = [d for d in hints["domains"] if d["name"] in used]
        if "presets" in hints:
            hints["presets"] = self._presets(hints["presets"])
        return hints

    def _presets(self, presets):
        """The presets, each with only the colours and filters of the tables written, a colour "rel:<relation>" only
        if that relation is, and a filter only if its table has the columns it names (one profile serves files with and
        without, e.g., the vertices' tracks or the PUPPI weights). A preset that this leaves with nothing is dropped;
        one with nothing to begin with (the bundle's defaults, e.g. "Energy") is kept."""
        written = self.written()
        colour = lambda t, c: (
            t in written and (c[4:] in self.relations if c.startswith("rel:") else c in self.tables[t]["columns"])
        )
        out = []
        for p in presets:
            kept = {
                **p,
                **({"colour": {t: c for t, c in p["colour"].items() if colour(t, c)}} if "colour" in p else {}),
                **(
                    {"filters": {t: f for t, f in p["filters"].items() if self._filterable(t, f)}}
                    if "filters" in p
                    else {}
                ),
                **({"show": [t for t in p["show"] if t in written]} if "show" in p else {}),
            }
            if kept.get("colour") or kept.get("filters") or not (p.get("colour") or p.get("filters")):
                out.append(
                    {k: v for k, v in kept.items() if v not in ({}, []) or k not in ("colour", "filters", "show")}
                )
        return out

    def _filterable(self, table, expr):
        """Whether `table` is written and has the columns that the viewer filter expression `expr` names (its names
        not followed by "(", which are functions)."""
        names = set(re.findall(r"\b[A-Za-z_]\w*\b(?!\s*\()", expr)) - CONSTANTS
        return table in self.written() and names <= set(self.tables[table]["columns"])

    # What the bundle and the reader need to know.

    def written(self):
        """The tables written to the bundle: all but the internal ones (read only to build relations or cuts)."""
        return {t: m for t, m in self.tables.items() if t not in self.internal}

    def _writes(self, name):
        """Whether a relation is written: not if one of its tables is internal, or if the profile says
        `"written": false` (a relation needed only to gather columns or to cut, e.g. jets -> the primary vertex they
        are drawn from)."""
        rel = self.relations[name]
        return rel.get("written", True) and not {rel["from"], rel["to"]} & self.internal

    def header(self, files, profile_name, cmssw=None):
        """The bundle header (docs/format.md). `cmssw`: the release that wrote the input, if the file says (see
        nano.written_by)."""
        written = self.written()
        relations = {
            n: r for n, r in self.relations.items() if self._writes(n) and r["from"] in written and r["to"] in written
        }
        return {
            "schema": "evd/1",  # the format's name since version 1, kept like the magic bytes (bundle.py)
            "source": {
                "files": [os.path.basename(f) for f in files],
                "converter": f"embertools {__version__}",
                **({"cmssw": cmssw} if cmssw else {}),
                "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            },
            "profile": profile_name,
            "tables": {
                t: {
                    "doc": m["doc"],
                    **({"scope": "run"} if t in self.run_scope else {}),
                    "columns": {c: {"type": type_code(dt), "doc": doc} for c, (dt, doc) in m["columns"].items()},
                }
                for t, m in written.items()
            },
            "relations": {
                n: {
                    "from": r["from"],
                    "to": r["to"],
                    "weights": [table_column(w)[1] for w in r.get("weights", [])],
                    **{k: r[k] for k in ("association", "best", "match", "fact") if k in r},  # viewer hints
                    **({"inverseOf": r["inverseOf"]} if r.get("inverseOf") in relations else {}),
                }
                for n, r in relations.items()
            },
            "display": self.display,
            **self.viewer_hints,
        }

    def branches(self, scope="event"):
        """The branches to read: those of the per-event tables (Events tree), or with scope="run" those of the per-run
        tables (Runs tree)."""
        tables = {
            t: m for t, m in self.tables.items() if (t in self.run_scope) == (scope == "run") and t not in self.made
        }
        out = [f"n{t}" for t, m in tables.items() if not m.get("singleton")]
        out += [f"{t}_{c}" for t, m in tables.items() for c in m["columns"] if (t, c) not in self.derived]
        return out + ["run"] + (["luminosityBlock", "event"] if scope == "event" else [])

    def selection_branches(self):
        """The branches that decide the event selection, so that a first pass can skip unselected events cheaply.
        None if there is no selection, or if it depends on derived columns or relations (then everything is read)."""
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

    # Converting: `arrays` is a chunk of a tree as uproot reads it (library="np"), `i` an entry of that chunk.

    def passes(self, arrays, i):
        """Whether entry i passes the event selection, read from the branches of selection_branches() only."""
        tables = self._read(arrays, i)
        return self._selected(tables, self._masks(tables, {}))

    def run_tables(self, arrays, i):
        """The per-run tables of entry i of the Runs tree, uncut (lookups index them by row)."""
        tables = self._read(arrays, i)
        self._derive(tables)
        return tables

    def run_record(self, run, tables):
        """(run id, tables, relations) to write once for a run: its tables, cut (by plain conditions only)."""
        return (run, 0, 0), self._cut_tables(tables, self._masks(tables, {})), {}

    def event(self, arrays, i, run_tables=None):
        """Entry i of an Events chunk as (event id, tables, relations), or None if the event is not selected.
        `run_tables`: the tables of the event's run (see run_tables()), for lookups."""
        tables = self._read(arrays, i)
        event_id = (arrays["run"][i], arrays["luminosityBlock"][i], arrays["event"][i])
        tables.update(run_tables or {})
        for s in self.same:
            _check_same_rows(s, tables, event_id)
            tables[s["keep"]][1].update({c: tables[s["drop"]][1][c] for c in s.get("copy", [])})
        self._derive(tables, skip=self.run_scope)

        relations = {}
        for name, rel in self.relations.items():  # in profile order, so a composition comes after its parts
            if rel["kind"] == "compose":
                relations[name] = compose_relations(*(relations[v] for v in rel["via"]))
            else:
                relations[name] = build_relation(rel, tables)
        for d in self.derive:
            if "gather" in d:
                gather(d, tables, relations, self.relations)

        masks = self._masks(tables, relations, skip=self.run_scope)
        if not self._selected(tables, masks):
            return None
        self._renumber_index_columns(tables, masks)
        relations = {
            name: cut_relation(rel, masks.get(self.relations[name]["from"]), masks.get(self.relations[name]["to"]))
            for name, rel in relations.items()
            if self._writes(name)
        }
        return event_id, self._cut_tables(tables, masks, skip=self.run_scope), relations

    def _read(self, arrays, i):
        """The tables of entry i, with those of their columns that `arrays` holds (a singleton table: one row)."""
        out = {}
        for t, m in self.tables.items():
            if m.get("singleton"):
                cols = {c: arrays[f"{t}_{c}"][i : i + 1] for c in m["columns"] if f"{t}_{c}" in arrays}
                if cols:
                    out[t] = (1, cols)
            elif f"n{t}" in arrays:
                out[t] = (
                    int(arrays[f"n{t}"][i]),
                    {c: arrays[f"{t}_{c}"][i] for c in m["columns"] if f"{t}_{c}" in arrays},
                )
        return out

    def _derive(self, tables, skip=()):
        """Apply the derives (all but gather, which needs the relations) of the tables present, in profile order."""
        for d in self.derive:
            if (
                "gather" not in d
                and d["table"] in tables
                and d["table"] not in skip
                and d.get("lookup", d["table"]) in tables
                and d.get("counts", d["table"]).split(".")[0] in tables
            ):
                if "split" in d:
                    _split(d, tables)
                else:
                    apply_derive(d, tables)

    def _masks(self, tables, relations, skip=()):
        """{table: mask of the rows kept} of the cut tables, in profile order: a reachedBy cut sees the cuts of the
        tables before it."""
        masks = {}
        for t, conds in self.cuts.items():
            if t not in tables or t in skip:
                continue
            n, cols = tables[t]
            keep = np.ones(n, bool)
            for cond in conds:
                if not isinstance(cond, dict):
                    keep &= _condition_mask(cond, cols)
                elif "defined" in cond:  # not NaN (e.g. a gathered column)
                    keep &= ~np.isnan(np.asarray(cols[cond["defined"]], np.float64))
                else:  # rows of `to` that a kept `from` row links to, through any of the relations
                    reached = np.zeros(n, bool)
                    for name in cond["reachedBy"]:
                        rel, kept_from = relations[name], masks.get(self.relations[name]["from"])
                        if kept_from is None:
                            reached[rel["indices"]] = True
                        else:
                            reached[rel["indices"][kept_from[owner_rows(rel["offsets"])]]] = True
                    keep &= reached
            masks[t] = keep
        return masks

    def _selected(self, tables, masks):
        """Whether every requirement {"table", "where": [conditions], "min", "max"} of the event selection holds for
        the rows that pass the cuts."""
        for s in self.select:
            n, cols = tables[s["table"]]
            rows = masks.get(s["table"], np.ones(n, bool)).copy()
            for cond in s.get("where", []):
                rows &= _condition_mask(cond, cols)
            count = int(rows.sum())
            if count < s.get("min", 0) or count > s.get("max", count):
                return False
        return True

    def _renumber_index_columns(self, tables, masks):
        """Keep the index columns that `index` relations read (e.g. a candidate's track row, or a hit's cluster)
        pointing at the same object once the table they point into is cut: rows are renumbered, removed ones become
        -1."""
        for rel in self.relations.values():
            if rel["kind"] != "index" or "via" in rel:
                continue
            table, column = table_column(rel["index"])
            target = rel["to"] if table == rel["from"] else rel["from"]  # the column may sit on either end
            if target not in masks:
                continue
            cols, keep = tables[table][1], masks[target]
            if cols[column].dtype.kind == "u":
                raise ValueError(
                    f"relation {rel['name']}: index column {rel['index']} is unsigned, so it cannot "
                    f"mark rows of the cut table {target} as removed"
                )
            idx = np.asarray(cols[column], np.int64)
            ok = (idx >= 0) & (idx < len(keep))
            ok[ok] = keep[idx[ok]]
            cols[column] = np.where(ok, np.cumsum(keep)[np.where(ok, idx, 0)] - 1, -1).astype(cols[column].dtype)

    def _cut_tables(self, tables, masks, skip=()):
        """The tables to write: rows cut by `masks`, internal tables (and `skip`) left out."""
        return {
            t: (int(masks[t].sum()), {c: a[masks[t]] for c, a in cols.items()}) if t in masks else (n, cols)
            for t, (n, cols) in tables.items()
            if t not in self.internal and t not in skip
        }


def used_tables(profile):
    """The tables a profile names anywhere: drawn, related, derived, cut, selected, kept internal, summarised."""
    used = set(profile.get("internal", []))
    used |= {layer["table"] for layer in profile.get("display", [])}
    for r in profile.get("relations", []):
        used |= {r.get("from"), r.get("to"), r.get("table"), *r.get("unless", [])}
        specs = [
            r.get(k)
            for k in ("offsets", "counts", "indices", "index", "via", "fromIndex", "toIndex", "fromKey", "toKey")
        ]
        used |= {table_column(s)[0] for s in [*specs, *r.get("weights", [])] if isinstance(s, str)}
    for d in profile.get("derive", []):
        used |= {d["table"], d.get("lookup")}
    used |= set(profile.get("cuts", {})) | {s["table"] for s in profile.get("select", [])}
    used |= {t for s in profile.get("sameRows", []) for t in (s["keep"], s["drop"])}
    used |= {s.get("table") for s in profile.get("summaries", [])}
    for preset in profile.get("presets", []):
        used |= set(preset.get("filters", {})) | set(preset.get("colour", {})) | set(preset.get("show", []))
    return used - {None}


def _split(d, tables):
    """Add the tables of a split derive: the rows of its table that pass each new table's conditions."""
    n, cols = tables[d["table"]]
    for new, conds in d["split"].items():
        keep = np.ones(n, bool)
        for cond in conds:
            keep &= _condition_mask(cond, cols)
        tables[new] = (int(keep.sum()), {c: a[keep] for c, a in cols.items()})


# Row conditions (cuts and the event selection): [expression, operator, number], with the expression a column or a
# ratio "a/b"; {"defined": column}; or {"reachedBy": relation or [relations]} (reached through any of them).


def _operands(expr):
    """The columns of a condition's expression: one, or the two of a ratio."""
    return expr.split("/", 1)


def _condition_mask(cond, cols):
    """The rows that pass an [expression, operator, number] condition, as a boolean mask."""
    expr, op, value = cond
    with np.errstate(divide="ignore", invalid="ignore"):  # x/0 gives inf or NaN, and NaN fails every comparison
        operands = [cols[c] for c in _operands(expr)]
        return OPS[op](operands[0] / operands[1] if len(operands) == 2 else operands[0], value)


def _describe_condition(cond):
    """A condition in words, for the description of a cut table."""
    if not isinstance(cond, dict):
        return " ".join(map(str, cond))
    return f"reached by {' or '.join(cond['reachedBy'])}" if "reachedBy" in cond else f"{cond['defined']} defined"


def _check_same_rows(same, tables, event_id):
    """sameRows: the dropped table must have the kept table's rows, in the same order (checked on `columns` pairs)."""
    (n_keep, keep), (n_drop, drop) = tables[same["keep"]], tables[same["drop"]]
    if n_keep != n_drop:
        differs = f"{n_keep} vs {n_drop} rows"
    else:
        differs = ", ".join(
            f"{a}/{b}" for a, b in same["columns"] if not np.allclose(keep[a], drop[b], rtol=1e-5, atol=1e-6)
        )
    if differs:
        raise ValueError(
            f"sameRows {same['keep']} / {same['drop']}: event {tuple(int(x) for x in event_id)} differs "
            f"({differs}); remove this sameRows entry from the profile to keep both tables"
        )
