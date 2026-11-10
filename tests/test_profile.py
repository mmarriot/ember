"""Profile kinds (shared style, grouping, preferred source) and checks of the columns a profile names."""
import numpy as np
import pytest

from evdtools.nano import Converter

F4, I4 = np.dtype("f4"), np.dtype("i4")
XYZE = {c: (F4, "") for c in ("x", "y", "z", "e")}
PROFILE = {
    "prefer": ["SoA", "legacy"],
    "kinds": {"hit": {"label": "Hits", "repr": "cells", "visible": True, "cut": {"group": "Hit energy", "default": 0.1}},
              "cluster": {"label": "Clusters", "repr": "markers", "visible": True}},
    "display": [
        {"table": "LegacyClusters", "kind": "cluster", "source": "legacy", "label": "C", "position": ["x", "y", "z"]},
        {"table": "SoAHits", "kind": "hit", "source": "SoA", "label": "H", "position": ["x", "y", "z"], "cut": {"column": "e"}},
        {"table": "LegacyHits", "kind": "hit", "source": "legacy", "label": "H", "position": ["x", "y", "z"],
         "cut": {"column": "e", "default": 0.2}},
        {"table": "Other", "group": "Misc", "label": "O", "repr": "markers", "position": ["x", "y", "z"], "visible": True},
    ],
}


def converter(tables, profile=PROFILE):
    return Converter({t: {"doc": "", "columns": dict(cols)} for t, cols in tables.items()}, profile)


def test_kinds_style_group_and_order():
    d = converter({"SoAHits": XYZE, "LegacyHits": XYZE, "LegacyClusters": XYZE, "Other": XYZE}).display
    assert [x["table"] for x in d] == ["SoAHits", "LegacyHits", "LegacyClusters", "Other"]  # kinds order, then the rest
    soa, legacy = d[0], d[1]
    assert (soa["group"], soa["repr"], soa["label"]) == ("Hits", "cells", "H")
    assert soa["cut"] == {"group": "Hit energy", "default": 0.1, "column": "e"}
    assert legacy["cut"]["default"] == 0.2  # the layer's own keys win
    assert d[3]["group"] == "Misc"  # layers without a kind are unchanged


def test_preferred_source_shown_others_hidden():
    d = {x["table"]: x["visible"] for x in converter({"SoAHits": XYZE, "LegacyHits": XYZE, "LegacyClusters": XYZE}).display}
    assert d == {"SoAHits": True, "LegacyHits": False, "LegacyClusters": True}  # no SoA clusters: legacy stays shown


def test_only_legacy_present_is_shown():
    d = converter({"LegacyHits": XYZE}).display
    assert [(x["table"], x["visible"]) for x in d] == [("LegacyHits", True)]


def test_missing_display_column_is_an_error():
    with pytest.raises(ValueError, match="display SoAHits: no column e"):
        converter({"SoAHits": {c: (F4, "") for c in "xyz"}})


def test_missing_relation_column_is_an_error():
    profile = {"relations": [{"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k"}]}
    with pytest.raises(ValueError, match="relation r: table A has no column k"):
        converter({"A": {"j": (I4, "")}, "B": {}}, profile)
    assert "r" not in converter({"A": {"k": (I4, "")}}, profile).relations  # table B absent: dropped, no error


STAGED = {
    "stages": ["trackster", "linked"],
    "kinds": {"cluster": {"label": "Clusters", "visible": True}, "trackster": {"label": "Tracksters", "visible": True},
              "linked": {"label": "Linked", "visible": True}},
    "relations": [{"name": "tLCs", "kind": "index", "from": "T", "to": "LC", "index": "T.lc"},
                  {"name": "linkT", "kind": "index", "from": "L", "to": "T", "index": "L.t"},
                  {"name": "linkLCs", "kind": "compose", "from": "L", "to": "LC", "via": ["linkT", "tLCs"]}],
    "display": [{"table": "LC", "kind": "cluster", "label": "LC", "position": ["x", "y", "z"], "colourBy": "stage"},
                {"table": "T", "kind": "trackster", "label": "T", "position": ["x", "y", "z"]},
                {"table": "L", "kind": "linked", "label": "L", "position": ["x", "y", "z"]}],
}
IDX = {**XYZE, "lc": (I4, ""), "t": (I4, "")}


def test_stages_hide_all_but_the_last_and_colour_by_the_latest():
    d = {x["table"]: x for x in converter({"LC": XYZE, "T": IDX, "L": IDX}, STAGED).display}
    assert (d["T"]["stage"], d["T"]["visible"], d["L"]["stage"], d["L"]["visible"]) == (0, False, 1, True)
    assert d["LC"]["colourBy"] == {"relation": "linkLCs"}
    d = {x["table"]: x for x in converter({"LC": XYZE, "T": IDX}, STAGED).display}  # no linked tracksters in the file
    assert (d["T"]["stage"], d["T"]["visible"], d["LC"]["colourBy"]) == (0, True, {"relation": "tLCs"})


def one_event(tables):
    """uproot library="np" layout of a single entry."""
    out = {"run": np.ones(1, np.uint32), "luminosityBlock": np.ones(1, np.uint32), "event": np.zeros(1, np.uint64)}
    for t, cols in tables.items():
        out[f"n{t}"] = np.array([len(next(iter(cols.values())))])
        for c, v in cols.items():
            out[f"{t}_{c}"] = np.array([np.asarray(v)] + [None], dtype=object)[:-1]
    return out


def test_compose_gather_and_same_rows():
    profile = {
        "sameRows": [{"keep": "LC", "drop": "OldLC", "columns": [["e", "e"]]}],
        "relations": [{"name": "candT", "kind": "index", "from": "C", "to": "T", "index": "C.t"},
                      {"name": "tLCs", "kind": "index", "from": "T", "to": "OldLC", "index": "T.lc"},
                      {"name": "candLCs", "kind": "compose", "from": "C", "to": "LC", "via": ["candT", "tLCs"]}],
        "derive": [{"table": "C", "gather": [{"relation": "candT", "columns": {"x": "x", "w": "e"}}]}],
    }
    f4 = lambda *v: np.array(v, np.float32)
    meta = {"LC": XYZE, "OldLC": XYZE, "T": {**XYZE, "lc": (I4, "")}, "C": {"t": (I4, "")}}
    conv = converter(meta, profile)
    assert conv.relations["tLCs"]["to"] == "LC" and "OldLC" in conv.internal
    lc = {"x": f4(0, 1), "y": f4(0, 0), "z": f4(0, 0), "e": f4(5, 6)}
    ev = {"LC": lc, "OldLC": lc, "T": {"x": f4(7, 8), "y": f4(0, 0), "z": f4(0, 0), "e": f4(1, 2), "lc": np.array([1, 0])},
          "C": {"t": np.array([1, -1, 0])}}
    _, tables, rels = conv.event(one_event(ev), 0)
    assert "OldLC" not in tables
    np.testing.assert_array_equal(rels["candLCs"]["indices"], [0, 1])  # cand 0 -> T1 -> LC0; cand 2 -> T0 -> LC1
    np.testing.assert_array_equal(rels["candLCs"]["offsets"], [0, 1, 1, 2])
    x, w = tables["C"][1]["x"], tables["C"][1]["w"]
    np.testing.assert_array_equal(x[[0, 2]], [8, 7]) and np.testing.assert_array_equal(w[[0, 2]], [2, 1])
    assert np.isnan(x[1])  # reached by no source
    ev["OldLC"] = {**lc, "e": f4(5, 7)}
    with pytest.raises(ValueError, match="sameRows LC / OldLC: event .* differs \\(e/e\\)"):
        conv.event(one_event(ev), 0)

    # Without the kept table (e.g. no SoA in the file) the chain ends at the other one, and so does the composition.
    conv = converter({t: m for t, m in meta.items() if t != "LC"}, profile)
    assert (conv.relations["candLCs"]["from"], conv.relations["candLCs"]["to"]) == ("C", "OldLC")
    assert "candLCs" in conv.header([], "test")["relations"]


def test_stages_show_the_last_and_colour_by_it():
    profile = {
        "prefer": ["SoA", "legacy"], "stages": ["shower", "linked", "candidate"],
        "kinds": {"cluster": {"label": "Clusters", "visible": True}, "shower": {"label": "Showers", "visible": True},
                  "track": {"label": "Tracks", "visible": True},
                  "linked": {"label": "Linked", "visible": True}},
        "relations": [{"name": "showerLCs", "kind": "index", "from": "Showers", "to": "LCs", "index": "Showers.lc"},
                      {"name": "linkedLCs", "kind": "index", "from": "Linked", "to": "LCs", "index": "Linked.lc"}],
        "display": [
            {"table": "LCs", "kind": "cluster", "label": "LC", "position": ["x", "y", "z"], "colourBy": "stage"},
            {"table": "Showers", "kind": "shower", "source": "SoA", "label": "S", "position": ["x", "y", "z"]},
            {"table": "OldShowers", "kind": "shower", "source": "legacy", "label": "S", "position": ["x", "y", "z"]},
            {"table": "Linked", "kind": "linked", "source": "legacy", "label": "L", "position": ["x", "y", "z"]},
            {"table": "Tracks", "kind": "track", "label": "T", "position": ["x", "y", "z"], "stageOf": "shower"},
        ],
    }
    cols = {**XYZE, "lc": (I4, "")}
    d = {x["table"]: x for x in converter({"LCs": XYZE, "Showers": cols, "OldShowers": XYZE, "Linked": cols, "Tracks": XYZE},
                                          profile).display}
    assert (d["Showers"]["stage"], d["Linked"]["stage"]) == (0, 1) and "stage" not in d["OldShowers"]
    assert d["Tracks"]["stage"] == 0 and not d["Tracks"]["visible"]  # stageOf: joins the shower stage
    assert [d[t]["visible"] for t in ("Showers", "OldShowers", "Linked")] == [False, False, True]
    assert d["LCs"]["colourBy"] == {"relation": "linkedLCs"}  # the latest stage that reaches the clusters
    d = {x["table"]: x for x in converter({"LCs": XYZE, "Showers": cols}, profile).display}
    assert d["Showers"]["visible"] and d["LCs"]["colourBy"] == {"relation": "showerLCs"}


def test_same_rows_drops_the_copy_and_redirects_its_relations():
    profile = {"sameRows": [{"keep": "SoA", "drop": "Legacy", "columns": [["e", "energy"]]}],
               "relations": [{"name": "r", "kind": "index", "from": "Showers", "to": "Legacy", "index": "Showers.k"}],
               "display": [{"table": "Legacy", "label": "L", "position": ["x", "y", "z"]}]}
    conv = converter({"SoA": {"e": (F4, "")}, "Legacy": {**XYZE, "energy": (F4, "")}, "Showers": {"k": (I4, "")}}, profile)
    assert conv.relations["r"]["to"] == "SoA" and "Legacy" not in conv.written() and conv.display == []
    tables = {"SoA": (2, {"e": np.array([1.0, 2.0])}), "Legacy": (2, {"energy": np.array([1.0, 2.0])})}
    conv._check_same(conv.same[0], tables, (1, 1, 7))
    tables["Legacy"][1]["energy"][1] = 3.0
    with pytest.raises(ValueError, match=r"sameRows SoA / Legacy: event \(1, 1, 7\) differs \(e/energy\)"):
        conv._check_same(conv.same[0], tables, (1, 1, 7))


def test_compose_and_gather():
    from evdtools.nano import _compose, _gather
    a = {"offsets": np.array([0, 1, 1, 3]), "indices": np.array([1, 0, 1])}  # candidate -> shower
    b = {"offsets": np.array([0, 2, 3]), "indices": np.array([5, 6, 6])}  # shower -> cluster
    c = _compose(a, b)
    assert c["offsets"].tolist() == [0, 1, 1, 3] and c["indices"].tolist() == [6, 5, 6]
    track = {"offsets": np.array([0, 0, 1, 1, 1]), "indices": np.array([0])}  # only candidate 1 has a track
    a4 = {"offsets": np.append(a["offsets"], 3), "indices": a["indices"]}  # candidate 3: no shower, no track
    tables = {"Cand": (4, {}), "Shower": (2, {"bx": np.array([10.0, 20.0]), "ev": np.array([4.0, 9.0])}),
              "Track": (1, {"hx": np.array([7.0])})}
    d = {"table": "Cand", "gather": [{"relation": "a", "columns": {"x": "bx", "ext": "ev"}},
                                     {"relation": "t", "columns": {"x": "hx"}}]}
    _gather(d, tables, {"a": a4, "t": track}, {"a": {"to": "Shower"}, "t": {"to": "Track"}})
    x, ext = tables["Cand"][1]["x"], tables["Cand"][1]["ext"]
    assert x[:3].tolist() == [20.0, 7.0, 10.0]  # the first shower; else the track
    assert ext[:3].tolist() == [9.0, 0.0, 4.0]  # placed by the track: the columns it does not give are 0
    assert np.isnan(x[3]) and np.isnan(ext[3])  # reached by nothing


def test_index_column_follows_the_cut_of_its_target():
    """A kept row's index column names the same object after its target table is cut (removed: -1)."""
    profile = {"relations": [{"name": "candTrack", "kind": "index", "from": "C", "to": "T", "index": "C.track"}],
               "cuts": {"T": [{"reachedBy": "candTrack"}]}}
    conv = converter({"C": {"track": (I4, "")}, "T": {"pt": (F4, "")}}, profile)
    ev = {"C": {"track": np.array([3, -1, 1], np.int32)}, "T": {"pt": np.array([0, 1, 2, 3, 4], np.float32)}}
    _, tables, rels = conv.event(one_event(ev), 0)
    np.testing.assert_array_equal(tables["T"][1]["pt"], [1, 3])  # tracks 1 and 3 are used
    np.testing.assert_array_equal(tables["C"][1]["track"], [1, -1, 0])  # renumbered like the relation
    np.testing.assert_array_equal(rels["candTrack"]["indices"], [1, 0])


def test_reached_by_a_counts_relation_and_unsorted_links():
    """counts offsets are integers even from u16 counts; links need not come grouped by `from`."""
    profile = {"relations": [
        {"name": "tLCs", "kind": "counts", "from": "T", "to": "LC", "counts": "T.n", "indices": "V.lc"},
        {"name": "lcHits", "kind": "links", "from": "LC", "to": "H", "table": "L", "fromIndex": "L.lc", "toIndex": "L.hit",
         "weights": ["L.f"]}],
        "internal": ["V", "L"], "cuts": {"LC": [{"reachedBy": "tLCs"}]}}
    U2 = np.dtype("u2")
    conv = converter({"T": {"n": (U2, "")}, "V": {"lc": (I4, "")}, "LC": {"e": (F4, "")}, "H": {"e": (F4, "")},
                      "L": {"lc": (I4, ""), "hit": (I4, ""), "f": (F4, "")}}, profile)
    ev = {"T": {"n": np.array([1], U2)}, "V": {"lc": np.array([1], np.int32)}, "LC": {"e": np.array([1, 2], np.float32)},
          "H": {"e": np.array([5, 6, 7], np.float32)},
          "L": {"lc": np.array([1, 0, 1], np.int32), "hit": np.array([2, 0, -1], np.int32), "f": np.array([.5, 1, .2], np.float32)}}
    _, tables, rels = conv.event(one_event(ev), 0)
    assert "V" not in tables and "L" not in tables
    np.testing.assert_array_equal(tables["LC"][1]["e"], [2])  # only LC 1 is in a trackster
    np.testing.assert_array_equal(rels["lcHits"]["offsets"], [0, 1])  # LC 1 -> hit 2 (its -1 link dropped)
    np.testing.assert_array_equal(rels["lcHits"]["indices"], [2])
    np.testing.assert_array_equal(rels["lcHits"]["weights"]["f"], [.5])


def test_key_relation_and_gather_fill():
    """A key relation joins rows with equal keys (any order); gather copies through it, `fill` for rows without one."""
    profile = {"relations": [{"name": "soaLegacy", "kind": "key", "from": "S", "to": "L", "fromKey": "S.id", "toKey": "L.id"}],
               "derive": [{"table": "S", "gather": [{"relation": "soaLegacy", "columns": {"w": "w"}}], "fill": 0.6}]}
    U4 = np.dtype("u4")
    conv = converter({"S": {"id": (U4, "")}, "L": {"id": (U4, ""), "w": (F4, "")}}, profile)
    ev = {"S": {"id": np.array([30, 10, 99], U4)}, "L": {"id": np.array([10, 20, 30], U4), "w": np.array([0.4, 0.5, 0.6], np.float32)}}
    _, tables, rels = conv.event(one_event(ev), 0)
    np.testing.assert_array_equal(rels["soaLegacy"]["offsets"], [0, 1, 2, 2])
    np.testing.assert_array_equal(rels["soaLegacy"]["indices"], [2, 0])
    np.testing.assert_allclose(tables["S"][1]["w"], [0.6, 0.4, 0.6])
