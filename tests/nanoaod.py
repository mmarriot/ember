"""Synthetic NanoAOD input for the converter tests. Tables are {table: {column: values}}, their types
{table: {column: dtype}}."""

import numpy as np

from embertools.converter import Converter


def converter(types, profile, run_types=None):
    """A Converter for a file with these per-event (and per-run) tables."""
    meta = lambda types: {
        t: {"doc": t, "columns": {c: (np.dtype(dt), "") for c, dt in cols.items()}} for t, cols in (types or {}).items()
    }
    return Converter(meta(types), profile, meta(run_types))


def chunk(conv, *events, run=1):
    """An uproot library="np" chunk holding `events` (or per-run tables) as the converter reads them: one n<T> per
    entry, and per <T>_<column> one array per entry, of the column's type; tables it does not know are not read.
    Event numbers are 0, 1, ..."""
    out = {
        "run": np.full(len(events), run, np.uint32),
        "luminosityBlock": np.ones(len(events), np.uint32),
        "event": np.arange(len(events), dtype=np.uint64),
    }
    for t in [t for t in events[0] if t in conv.tables]:
        out[f"n{t}"] = np.array([len(next(iter(ev[t].values()))) for ev in events])
        for c in events[0][t]:
            dtype = conv.tables[t]["columns"][c][0]
            out[f"{t}_{c}"] = np.array([np.asarray(ev[t][c], dtype) for ev in events] + [None], dtype=object)[:-1]
    return out


def write_nano(path, events, runs=None, first_event=0, event_numbers=None):
    """A NanoAOD-like ROOT file: an Events tree with `events` (and a Runs tree with `runs`, keyed by run number).
    All events are in run 1; event numbers count from `first_event`, or are `event_numbers` (e.g. out of order, as a
    multi-threaded export writes them)."""
    import awkward as ak
    import uproot

    def tree(entries, ids):
        data = {t: ak.zip({c: ak.Array([list(e[t][c]) for e in entries]) for c in entries[0][t]}) for t in entries[0]}
        return {**data, **{k: np.asarray(v) for k, v in ids.items()}}

    with uproot.recreate(path) as f:
        n = len(events)
        trees = {
            "Events": tree(
                events,
                {
                    "run": np.ones(n, np.uint32),
                    "luminosityBlock": np.ones(n, np.uint32),
                    "event": np.asarray(
                        np.arange(first_event, first_event + n) if event_numbers is None else event_numbers, np.uint64
                    ),
                },
            )
        }
        if runs:
            trees["Runs"] = tree(list(runs.values()), {"run": np.array(list(runs), np.uint32)})
        for name, data in trees.items():
            f.mktree(
                name,
                {k: v.type if hasattr(v, "layout") else v.dtype for k, v in data.items()},
                field_name=lambda outer, inner: f"{outer}_{inner}",
                counter_name=lambda counted: f"n{counted}",
            )
            f[name].extend(data)
