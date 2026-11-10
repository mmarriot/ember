"""Profile row cuts, event selection, lookup relations and derived cell sizes (synthetic NanoAOD-like arrays)."""
import numpy as np
import pytest

from evdtools.nano import Converter, cut_relation

F4, I4 = np.dtype("f4"), np.dtype("i4")
META = {"Hit": {"doc": "hits", "columns": {"e": (F4, ""), "noise": (F4, ""), "layer": (I4, ""), "dense": (I4, ""),
                                           "x": (F4, ""), "y": (F4, "")}},
        "Digi": {"doc": "digis", "columns": {"adc": (I4, "")}},
        "Dense": {"doc": "dense index -> digi", "columns": {"digiIdx": (I4, "")}}}


def arrays(*events):
    """uproot library="np" layout: n<Table> per entry, <Table>_<col> as one array per entry."""
    out = {"run": np.ones(len(events), np.uint32), "luminosityBlock": np.ones(len(events), np.uint32),
           "event": np.arange(len(events), dtype=np.uint64)}
    for t in META:
        out[f"n{t}"] = np.array([len(next(iter(ev[t].values()))) for ev in events])
        for c in next(iter(events))[t]:
            out[f"{t}_{c}"] = np.array([np.asarray(ev[t][c], META[t]["columns"][c][0]) for ev in events] + [None], dtype=object)[:-1]
    return out


EVENT = {  # 5 hits, 4 digis; dense index d has digi digiIdx[d] (-1: none)
    "Hit": {"e": [10, 1, 8, 9, 0.5], "noise": [1, 1, 2, 0, 1], "layer": [25, 25, 26, 26, 26], "dense": [0, 1, 2, 3, 4],
            "x": [0, 1, 0, 1, 2], "y": [0, 0, 0, 0, 0]},
    "Digi": {"adc": [100, 101, 103, 104]},
    "Dense": {"digiIdx": [0, 1, -1, 2, 3]},
}
PROFILE = {
    "internal": ["Dense"],
    "relations": [{"name": "hitDigi", "kind": "index", "from": "Hit", "to": "Digi", "index": "Hit.dense",
                   "via": "Dense.digiIdx"}],
    "cuts": {"Hit": [["e/noise", ">", 3]], "Digi": [{"reachedBy": "hitDigi"}]},
}


def convert(profile, *events):
    conv, a = Converter({t: {"doc": m["doc"], "columns": dict(m["columns"])} for t, m in META.items()}, profile), arrays(*events)
    return conv, [conv.event(a, i) for i in range(len(events))]


def test_cuts_remap_relations_and_drop_internal_tables():
    conv, [(_, tables, relations)] = convert(PROFILE, EVENT)
    # e/noise: 10, 1, 4, inf (noise 0), 0.5 -> hits 0, 2, 3 survive
    n, hits = tables["Hit"]
    assert n == 3 and hits["e"].tolist() == [10, 8, 9]
    # hit 0 -> digi 0, hit 2 -> dense 2 has no digi, hit 3 -> digi 2; digis 1 (hit 1 cut) and 3 (hit 4 cut) go
    n, digis = tables["Digi"]
    assert n == 2 and digis["adc"].tolist() == [100, 103]
    rel = relations["hitDigi"]
    assert rel["offsets"].tolist() == [0, 1, 1, 2] and rel["indices"].tolist() == [0, 1]
    assert "Dense" not in tables and "Dense" not in conv.header([], "t")["tables"]
    assert "(cut: e/noise > 3)" in conv.header([], "t")["tables"]["Hit"]["doc"]


def test_cut_relation_with_weights_and_both_sides_cut():
    rel = {"offsets": np.array([0, 2, 3, 5]), "indices": np.array([0, 3, 1, 2, 3]), "weights": {"w": np.arange(5.0)}}
    out = cut_relation(rel, keep_from=np.array([True, False, True]), keep_to=np.array([True, True, False, True]))
    # from 0 -> to {0, 3}, from 2 -> to {2 (cut), 3}; to rows renumbered 0->0, 1->1, 3->2
    assert out["offsets"].tolist() == [0, 2, 3]
    assert out["indices"].tolist() == [0, 2, 2]
    assert out["weights"]["w"].tolist() == [0, 1, 4]
    uncut = cut_relation(rel, None, None)
    assert uncut["offsets"].tolist() == rel["offsets"].tolist() and uncut["indices"].tolist() == rel["indices"].tolist()


def test_event_selection_counts_rows_after_cuts():
    select = [{"table": "Hit", "where": [["layer", "==", 25]], "min": 1},
              {"table": "Hit", "where": [["layer", "==", 26], ["e", ">=", 9]], "min": 1, "max": 1}]
    conv, [record] = convert(dict(PROFILE, select=select), EVENT)
    assert record is not None
    quiet = dict(EVENT, Hit=dict(EVENT["Hit"], e=[1, 1, 8, 9, 0.5]))  # layer 25 has nothing above 3 sigma
    _, [record] = convert(dict(PROFILE, select=select), quiet)
    assert record is None
    two = dict(EVENT, Hit=dict(EVENT["Hit"], e=[10, 1, 18, 9, 0.5]))  # two layer-26 hits with e >= 9: above max
    _, [record] = convert(dict(PROFILE, select=select), two)
    assert record is None


def test_preselection_reads_only_what_the_selection_needs():
    select = [{"table": "Hit", "where": [["layer", "==", 25]], "min": 1}]
    conv, _ = convert(dict(PROFILE, select=select), EVENT)
    branches = conv.selection_branches()
    assert branches == ["nHit", "Hit_e", "Hit_layer", "Hit_noise"]
    assert conv.passes({b: v for b, v in arrays(EVENT).items() if b in branches}, 0)
    assert Converter(META, {}).selection_branches() is None  # no selection: one pass over everything


def test_bad_conditions_are_rejected():
    for cond in (["e", "=~", 1], ["e", ">", "1"], ["e/missing", ">", 1]):
        with pytest.raises(ValueError):
            convert({"cuts": {"Hit": [cond]}}, EVENT)


def test_neighbour_distance_derive():
    derive = [{"table": "Hit", "column": "size", "neighbourDistance": ["x", "y"], "groupBy": "layer", "k": 1, "scale": 0.5}]
    conv, [(_, tables, _)] = convert({"derive": derive}, EVENT)
    # layer 25: x = 0, 1 -> 1; layer 26: x = 0, 1, 2 -> 1 each; half of that
    assert tables["Hit"][1]["size"].tolist() == [0.5] * 5
    assert ("Hit", "size") in conv.derived and "Hit_size" not in conv.branches()


def test_cuts_on_an_empty_event():
    empty = {"Hit": {c: [] for c in EVENT["Hit"]}, "Digi": {"adc": []}, "Dense": {"digiIdx": []}}
    _, [(_, tables, relations)] = convert(PROFILE, empty)
    assert tables["Hit"][0] == 0 and tables["Digi"][0] == 0
    assert relations["hitDigi"]["offsets"].tolist() == [0] and len(relations["hitDigi"]["indices"]) == 0


def test_replay_hint_is_passed_to_the_header():
    conv, _ = convert({**PROFILE, "replay": {"direction": [0, -1, 0]}}, EVENT)
    assert conv.header([], "t")["replay"] == {"direction": [0, -1, 0]}
    assert "replay" not in convert(PROFILE, EVENT)[0].header([], "t")


def test_event_lists():
    from evdtools.nano import parse_events
    assert parse_events("5, 7-9,12") == {5, 7, 8, 9, 12}
