"""Relations between the rows of two tables, held as CSR (compressed sparse rows), as the bundle stores them.

A relation from table A (n rows) to table B is {"offsets", "indices", "weights"}: the B rows linked to A row i are
indices[offsets[i]:offsets[i + 1]], so `offsets` has n + 1 entries, and each weight array has one value per index.
build_relation() makes one from the ways a profile can describe it (docs/profiles.md, "relations").
"""

import numpy as np

from .profile import table_column


def build_relation(rel, tables):
    """The CSR form of the profile relation `rel` (any kind but compose) in an event's `tables`."""

    def column(spec):
        table, name = table_column(spec)
        return tables[table][1][name]

    n_from, n_to = tables[rel["from"]][0], tables[rel["to"]][0]
    weights = {table_column(w)[1]: column(w) for w in rel.get("weights", [])}
    kind = rel["kind"]

    if kind == "offsets":  # explicit n + 1 offsets and a flat list (e.g. an exported AssociationMap)
        offsets, indices = column(rel["offsets"]), column(rel["indices"])
    elif kind == "counts":  # NanoAOD style: a count per `from` row and a flat list
        offsets = np.concatenate([[0], np.cumsum(column(rel["counts"]), dtype=np.int64)])
        indices = column(rel["indices"])
    elif kind == "links":  # one row per (from, to) pair; a `to` below 0 means no target
        offsets, indices, weights = _from_links(column(rel["fromIndex"]), column(rel["toIndex"]), weights, n_from)
    elif kind == "index":  # a column that holds one row of the other table (below 0: none)
        offsets, indices = _from_index(rel, column, n_from)
    elif kind == "key":  # rows of `from` and `to` with equal key columns (e.g. the same DetId in two hit tables)
        offsets, indices = _from_keys(column(rel["fromKey"]), column(rel["toKey"]))
    else:
        raise ValueError(f"relation {rel['name']}: unknown kind {kind}")

    if len(offsets) != n_from + 1 or offsets[-1] != len(indices) or (len(indices) and indices.max() >= n_to):
        raise ValueError(
            f"relation {rel['name']}: inconsistent with tables {rel['from']} ({n_from}) and {rel['to']} ({n_to})"
        )
    return {"offsets": offsets, "indices": indices, "weights": weights}


def _from_links(src, dst, weights, n_from):
    """(offsets, indices, weights) of a list of (from, to) pairs. CSR needs the pairs grouped by `from`: they are
    sorted if they are not (a stable sort, so the pairs of one row keep their order)."""
    keep = dst >= 0
    if np.any(np.diff(src) < 0):
        keep = np.flatnonzero(keep)[np.argsort(src[keep], kind="stable")]
    src, indices = src[keep], dst[keep]
    offsets = np.concatenate([[0], np.cumsum(np.bincount(src, minlength=n_from))])
    return offsets, indices, {w: a[keep] for w, a in weights.items()}


def _from_index(rel, column, n_from):
    """(offsets, indices) of an index column. With `via`, the index names a row of a lookup column that holds the
    `to` row. The column may sit on either end: on `from` (each candidate names its track), each `from` row links to
    the row it names; on `to` (each hit names its cluster), each `from` row links to the `to` rows that name it."""
    idx = column(rel["index"])
    if "via" in rel:
        via = column(rel["via"])
        ok = (idx >= 0) & (idx < len(via))
        idx = np.where(ok, via[np.where(ok, idx, 0)], -1)
    if table_column(rel["index"])[0] == rel["to"]:
        rows = np.flatnonzero(idx >= 0)
        indices = rows[np.argsort(idx[rows], kind="stable")]
        offsets = np.concatenate([[0], np.cumsum(np.bincount(idx[indices], minlength=n_from))])
    else:
        offsets, indices = np.concatenate([[0], np.cumsum(idx >= 0)]), idx[idx >= 0]
    return offsets, indices


def _from_keys(key_from, key_to):
    """(offsets, indices) linking each `from` row to the first `to` row with the same key, if there is one."""
    order = np.argsort(key_to, kind="stable")
    pos = np.searchsorted(key_to[order], key_from)
    if len(order):
        found = (pos < len(order)) & (key_to[order][np.minimum(pos, len(order) - 1)] == key_from)
    else:
        found = np.zeros(len(key_from), bool)
    return np.concatenate([[0], np.cumsum(found, dtype=np.int64)]), order[pos[found]]


def compose_relations(a, b):
    """The relation A -> C made of A -> B and B -> C: each row of A reaches every C row that its B rows reach, each
    once, in order. It has no weights.

    Cost: a Python loop over the rows of A, with one small numpy call per row."""
    a_off, b_off = np.asarray(a["offsets"], np.int64), np.asarray(b["offsets"], np.int64)
    offsets, indices = [0], []
    for f in range(len(a_off) - 1):
        mids = a["indices"][a_off[f] : a_off[f + 1]]
        if len(mids):
            reached = np.unique(np.concatenate([b["indices"][b_off[m] : b_off[m + 1]] for m in mids]))
        else:
            reached = np.zeros(0, np.int64)
        indices.append(reached)
        offsets.append(offsets[-1] + len(reached))
    return {
        "offsets": np.array(offsets),
        "indices": np.concatenate(indices) if indices else np.zeros(0, np.int64),
        "weights": {},
    }


def owner_rows(offsets):
    """For each index of a relation, the `from` row it belongs to."""
    return np.repeat(np.arange(len(offsets) - 1), np.diff(offsets))


def cut_relation(rel, keep_from, keep_to):
    """The relation restricted to the rows kept by row cuts. `keep_from` and `keep_to` are boolean masks over the two
    tables, or None for a table that was not cut. Removed `from` rows lose their entries, links to removed `to` rows
    are dropped, and the remaining indices are renumbered to the rows that are left."""
    if keep_from is None and keep_to is None:
        return rel
    offsets, indices = np.asarray(rel["offsets"], np.int64), np.asarray(rel["indices"])
    owner = owner_rows(offsets)
    keep = np.ones(len(indices), bool)
    if keep_from is not None:
        keep &= keep_from[owner]
    if keep_to is not None:
        keep &= keep_to[indices]
        indices = np.cumsum(keep_to)[indices] - 1  # a kept row's number among the kept rows
    counts = np.bincount(owner[keep], minlength=len(offsets) - 1)
    if keep_from is not None:
        counts = counts[keep_from]
    return {
        "offsets": np.concatenate([[0], np.cumsum(counts)]),
        "indices": indices[keep],
        "weights": {w: a[keep] for w, a in rel["weights"].items()},
    }
