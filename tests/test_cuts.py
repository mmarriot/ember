"""Row cuts, event selection, and what they do to relations and index columns."""
import numpy as np
import pytest
from nanoaod import chunk, converter

from evdtools.nano import cut_relation, parse_events

F4, I4 = np.dtype("f4"), np.dtype("i4")
TYPES = {"Hit": {"e": F4, "noise": F4, "layer": I4, "dense": I4, "x": F4, "y": F4},
         "Digi": {"adc": I4},
         "Dense": {"digiIdx": I4}}  # dense index -> digi row
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


def convert(profile, *events, types=TYPES):
    conv = converter(types, profile)
    a = chunk(conv, *events)
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


def test_reached_by_a_missing_relation_is_no_cut():
    conv, _ = convert(PROFILE, EVENT, types={t: m for t, m in TYPES.items() if t != "Dense"})
    assert "hitDigi" not in conv.relations and "Digi" not in conv.cuts
    assert "cut" not in conv.header([], "t")["tables"]["Digi"]["doc"]


def test_cut_relation_with_weights_and_both_sides_cut():
    rel = {"offsets": np.array([0, 2, 3, 5]), "indices": np.array([0, 3, 1, 2, 3]), "weights": {"w": np.arange(5.0)}}
    out = cut_relation(rel, keep_from=np.array([True, False, True]), keep_to=np.array([True, True, False, True]))
    # from 0 -> to {0, 3}, from 2 -> to {2 (cut), 3}; to rows renumbered 0->0, 1->1, 3->2
    assert out["offsets"].tolist() == [0, 2, 3]
    assert out["indices"].tolist() == [0, 2, 2]
    assert out["weights"]["w"].tolist() == [0, 1, 4]
    assert cut_relation(rel, None, None) is rel


def test_event_selection_counts_rows_after_cuts():
    select = [{"table": "Hit", "where": [["layer", "==", 25]], "min": 1},
              {"table": "Hit", "where": [["layer", "==", 26], ["e", ">=", 9]], "min": 1, "max": 1}]
    quiet = dict(EVENT, Hit=dict(EVENT["Hit"], e=[1, 1, 8, 9, 0.5]))  # layer 25 has nothing above 3 sigma
    two = dict(EVENT, Hit=dict(EVENT["Hit"], e=[10, 1, 18, 9, 0.5]))  # two layer-26 hits with e >= 9: above max
    _, records = convert(dict(PROFILE, select=select), EVENT, quiet, two)
    assert [r is not None for r in records] == [True, False, False]


def test_preselection_reads_only_what_the_selection_needs():
    select = [{"table": "Hit", "where": [["layer", "==", 25]], "min": 1}]
    conv, _ = convert(dict(PROFILE, select=select), EVENT)
    branches = conv.selection_branches()
    assert branches == ["nHit", "Hit_e", "Hit_layer", "Hit_noise"]
    assert conv.passes({b: v for b, v in chunk(conv, EVENT).items() if b in branches}, 0)
    assert converter(TYPES, {}).selection_branches() is None  # no selection: one pass over everything
    defined = {**PROFILE, "select": select, "cuts": {"Hit": [{"defined": "e"}]}}
    assert converter(TYPES, defined).selection_branches() is None  # not a plain condition: read everything


def test_bad_conditions_are_rejected():
    for cut in (["e", "=~", 1], ["e", ">", "1"], ["e/missing", ">", 1], {"defined": "missing"}):
        with pytest.raises(ValueError):
            convert({"cuts": {"Hit": [cut]}}, EVENT)


def test_defined_cut_drops_nan_rows():
    gaps = dict(EVENT, Hit=dict(EVENT["Hit"], e=[1, np.nan, 2, 3, 4]))
    _, [(_, tables, _)] = convert({"cuts": {"Hit": [{"defined": "e"}]}}, gaps)
    assert tables["Hit"][1]["e"].tolist() == [1, 2, 3, 4]


def test_cuts_on_an_empty_event():
    empty = {"Hit": {c: [] for c in EVENT["Hit"]}, "Digi": {"adc": []}, "Dense": {"digiIdx": []}}
    _, [(_, tables, relations)] = convert(PROFILE, empty)
    assert tables["Hit"][0] == 0 and tables["Digi"][0] == 0
    assert relations["hitDigi"]["offsets"].tolist() == [0] and len(relations["hitDigi"]["indices"]) == 0


def test_index_column_on_from_follows_the_cut_of_its_target():
    """Each candidate names its track; tracks no candidate uses are cut: the column is renumbered (removed: -1)."""
    profile = {"relations": [{"name": "candTrack", "kind": "index", "from": "C", "to": "T", "index": "C.track"}],
               "cuts": {"T": [{"reachedBy": "candTrack"}]}}
    _, [(_, tables, rels)] = convert(profile, {"C": {"track": [3, -1, 1]}, "T": {"pt": [0, 1, 2, 3, 4]}},
                                     types={"C": {"track": I4}, "T": {"pt": F4}})
    assert tables["T"][1]["pt"].tolist() == [1, 3]  # tracks 1 and 3 are used
    assert tables["C"][1]["track"].tolist() == [1, -1, 0]  # renumbered like the relation
    assert rels["candTrack"]["indices"].tolist() == [1, 0]


def test_index_column_on_to_follows_the_cut_of_its_target():
    """Each hit names its cluster; clusters are cut: hit.cluster is renumbered (removed cluster: -1)."""
    profile = {"relations": [{"name": "clusterHits", "kind": "index", "from": "Cl", "to": "Hit",
                              "index": "Hit.cluster"}],
               "cuts": {"Cl": [["layer", ">", 0]]}}
    event = {"Cl": {"layer": [0, 3, 4]}, "Hit": {"cluster": [2, 0, -1, 1, 2]}}
    _, [(_, tables, rels)] = convert(profile, event, types={"Cl": {"layer": I4}, "Hit": {"cluster": I4}})
    assert tables["Cl"][0] == 2 and tables["Hit"][0] == 5  # hits are not cut
    assert tables["Hit"][1]["cluster"].tolist() == [1, -1, -1, 0, 1]
    assert rels["clusterHits"]["offsets"].tolist() == [0, 1, 3] and rels["clusterHits"]["indices"].tolist() == [3, 0, 4]


def test_unsigned_index_column_of_a_cut_table_is_rejected():
    profile = {"relations": [{"name": "r", "kind": "index", "from": "C", "to": "T", "index": "C.track"}],
               "cuts": {"T": [["pt", ">", 1]]}}
    types = {"C": {"track": np.dtype("u2")}, "T": {"pt": F4}}
    with pytest.raises(ValueError, match="index column C.track is unsigned"):
        convert(profile, {"C": {"track": [0]}, "T": {"pt": [2]}}, types=types)


def test_event_lists():
    assert parse_events("5, 7-9,12") == {5, 7, 8, 9, 12}


def test_reached_by_any_of_several_relations():
    """A list of relations keeps the rows reached through any of them (e.g. the production or the decay vertex of a
    kept particle); relations absent from the file are left out, and with none the condition is dropped."""
    profile = {"relations": [{"name": "prod", "kind": "index", "from": "P", "to": "V", "index": "P.prod"},
                             {"name": "dec", "kind": "index", "from": "P", "to": "V", "index": "P.dec"}],
               "cuts": {"P": [["bx", "==", 0]], "V": [{"reachedBy": ["prod", "dec", "absent"]}]}}
    types = {"P": {"bx": I4, "prod": I4, "dec": I4}, "V": {"t": F4}}
    conv, [(_, tables, _)] = convert(profile, {"P": {"bx": [0, 1, 0], "prod": [0, 1, 0], "dec": [2, 3, -1]},
                                               "V": {"t": [0, 25, 1, 26]}}, types=types)
    assert tables["V"][1]["t"].tolist() == [0, 1]  # vertices 0 (prod of P0, P2) and 2 (dec of P0)
    assert tables["P"][1]["prod"].tolist() == [0, 0] and tables["P"][1]["dec"].tolist() == [1, -1]  # renumbered
    assert "reached by prod or dec" in conv.tables["V"]["doc"]
    conv = converter({"V": {"t": F4}, "P": {"bx": I4}}, {"cuts": {"V": [{"reachedBy": ["prod"]}]}})
    assert "V" not in conv.cuts
