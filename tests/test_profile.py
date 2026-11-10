"""Profile resolution against a file's tables: display kinds, sources and stages, column checks, sameRows, derived
columns, relation kinds beyond the plain ones, and the hints passed to the viewer."""
import numpy as np
import pytest
from nanoaod import chunk, converter

from evdtools.nano import _compose, _gather

F4, I4, U4 = np.dtype("f4"), np.dtype("i4"), np.dtype("u4")
XYZE = dict.fromkeys(("x", "y", "z", "e"), F4)
f4 = lambda *v: np.array(v, np.float32)
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


def one_event(conv, event):
    return conv.event(chunk(conv, event), 0)


def test_kinds_style_group_and_order():
    d = converter({"SoAHits": XYZE, "LegacyHits": XYZE, "LegacyClusters": XYZE, "Other": XYZE}, PROFILE).display
    assert [x["table"] for x in d] == ["SoAHits", "LegacyHits", "LegacyClusters", "Other"]  # kinds order, then the rest
    soa, legacy = d[0], d[1]
    assert (soa["group"], soa["repr"], soa["label"]) == ("Hits", "cells", "H")
    assert soa["cut"] == {"group": "Hit energy", "default": 0.1, "column": "e"}
    assert legacy["cut"]["default"] == 0.2  # the layer's own keys win
    assert d[3]["group"] == "Misc"  # layers without a kind are unchanged


def test_preferred_source_shown_others_hidden():
    d = {x["table"]: x for x in converter({"SoAHits": XYZE, "LegacyHits": XYZE, "LegacyClusters": XYZE}, PROFILE).display}
    assert {t: x["visible"] for t, x in d.items()} == {"SoAHits": True, "LegacyHits": False, "LegacyClusters": True}
    assert d["LegacyHits"]["alternative"] and "alternative" not in d["LegacyClusters"]  # no SoA clusters: shown
    d = converter({"LegacyHits": XYZE}, PROFILE).display
    assert [(x["table"], x["visible"]) for x in d] == [("LegacyHits", True)]  # only legacy present: shown


def test_missing_display_column_is_an_error():
    with pytest.raises(ValueError, match="display SoAHits: no column e"):
        converter({"SoAHits": dict.fromkeys("xyz", F4)}, PROFILE)


def test_missing_relation_column_is_an_error():
    profile = {"relations": [{"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k"}]}
    with pytest.raises(ValueError, match="relation r: table A has no column k"):
        converter({"A": {"j": I4}, "B": {}}, profile)
    assert "r" not in converter({"A": {"k": I4}}, profile).relations  # table B absent: dropped, no error


def test_excluded_tables_are_not_read():
    conv = converter({"Hit": {"e": F4}, "HGCTrigger": {"e": F4}}, {"exclude": ["HGC*"]}, {"HGCChannel": {"x": F4}})
    assert set(conv.tables) == {"Hit"} and "nHGCTrigger" not in conv.branches()


def test_stages_show_the_last_and_colour_by_it():
    profile = {
        "prefer": ["SoA", "legacy"], "stages": ["shower", "linked", "candidate"],
        "kinds": {"cluster": {"label": "Clusters", "visible": True}, "shower": {"label": "Showers", "visible": True},
                  "track": {"label": "Tracks", "visible": True}, "linked": {"label": "Linked", "visible": True}},
        "relations": [{"name": "showerLCs", "kind": "index", "from": "Showers", "to": "LCs", "index": "Showers.lc"},
                      {"name": "linkedShowers", "kind": "index", "from": "Linked", "to": "Showers",
                       "index": "Linked.s"},
                      {"name": "linkedLCs", "kind": "compose", "from": "Linked", "to": "LCs",
                       "via": ["linkedShowers", "showerLCs"]}],
        "display": [
            {"table": "LCs", "kind": "cluster", "label": "LC", "position": ["x", "y", "z"], "colourBy": "stage"},
            {"table": "Showers", "kind": "shower", "source": "SoA", "label": "S", "position": ["x", "y", "z"]},
            {"table": "OldShowers", "kind": "shower", "source": "legacy", "label": "S", "position": ["x", "y", "z"]},
            {"table": "Linked", "kind": "linked", "source": "legacy", "label": "L", "position": ["x", "y", "z"]},
            {"table": "Tracks", "kind": "track", "label": "T", "position": ["x", "y", "z"], "stageOf": "shower"},
        ],
    }
    types = {"LCs": XYZE, "Showers": {**XYZE, "lc": I4}, "OldShowers": XYZE, "Linked": {**XYZE, "s": I4},
             "Tracks": XYZE}
    d = {x["table"]: x for x in converter(types, profile).display}
    assert (d["Showers"]["stage"], d["Linked"]["stage"]) == (0, 1) and "stage" not in d["OldShowers"]
    assert d["Tracks"]["stage"] == 0 and not d["Tracks"]["visible"]  # stageOf: joins the shower stage
    assert "stageOf" not in d["Tracks"]  # a profile key, not passed to the viewer
    assert [d[t]["visible"] for t in ("Showers", "OldShowers", "Linked")] == [False, False, True]
    assert d["LCs"]["colourBy"] == {"relation": "linkedLCs"}  # the latest stage that reaches the clusters
    d = {x["table"]: x for x in converter({t: types[t] for t in ("LCs", "Showers")}, profile).display}
    assert d["Showers"]["visible"] and d["LCs"]["colourBy"] == {"relation": "showerLCs"}


def test_same_rows_drops_the_copy_redirects_relations_and_is_checked():
    profile = {
        "sameRows": [{"keep": "LC", "drop": "OldLC", "columns": [["e", "e"]]}],
        "relations": [{"name": "candT", "kind": "index", "from": "C", "to": "T", "index": "C.t"},
                      {"name": "tLCs", "kind": "index", "from": "T", "to": "OldLC", "index": "T.lc"},
                      {"name": "candLCs", "kind": "compose", "from": "C", "to": "LC", "via": ["candT", "tLCs"]}],
        "display": [{"table": "OldLC", "label": "L", "position": ["x", "y", "z"]}],
    }
    types = {"LC": XYZE, "OldLC": XYZE, "T": {**XYZE, "lc": I4}, "C": {"t": I4}}
    conv = converter(types, profile)
    assert conv.relations["tLCs"]["to"] == "LC" and "OldLC" not in conv.written() and conv.display == []
    lc = {"x": f4(0, 1), "y": f4(0, 0), "z": f4(0, 0), "e": f4(5, 6)}
    ev = {"LC": lc, "OldLC": lc, "T": {"x": f4(7, 8), "y": f4(0, 0), "z": f4(0, 0), "e": f4(1, 2), "lc": [1, 0]},
          "C": {"t": [1, -1, 0]}}
    _, tables, rels = one_event(conv, ev)
    assert "OldLC" not in tables
    assert rels["candLCs"]["offsets"].tolist() == [0, 1, 1, 2]
    assert rels["candLCs"]["indices"].tolist() == [0, 1]  # cand 0 -> T1 -> LC0; cand 2 -> T0 -> LC1
    with pytest.raises(ValueError, match=r"sameRows LC / OldLC: event \(1, 1, 0\) differs \(e/e\)"):
        one_event(conv, {**ev, "OldLC": {**lc, "e": f4(5, 7)}})
    # Without the kept table (e.g. no SoA in the file) the chain ends at the other one, and so does the composition.
    conv = converter({t: m for t, m in types.items() if t != "LC"}, profile)
    assert (conv.relations["candLCs"]["from"], conv.relations["candLCs"]["to"]) == ("C", "OldLC")
    assert "candLCs" in conv.header([], "test")["relations"]


def test_compose_and_gather():
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


def test_key_relation_and_gather_fill():
    """A key relation joins rows with equal keys (any order); gather copies through it, `fill` for rows without one."""
    profile = {"relations": [{"name": "soaLegacy", "kind": "key", "from": "S", "to": "L", "fromKey": "S.id", "toKey": "L.id"}],
               "derive": [{"table": "S", "gather": [{"relation": "soaLegacy", "columns": {"w": "w"}}], "fill": 0.6}]}
    conv = converter({"S": {"id": U4}, "L": {"id": U4, "w": F4}}, profile)
    _, tables, rels = one_event(conv, {"S": {"id": [30, 10, 99]}, "L": {"id": [10, 20, 30], "w": [0.4, 0.5, 0.6]}})
    assert rels["soaLegacy"]["offsets"].tolist() == [0, 1, 2, 2] and rels["soaLegacy"]["indices"].tolist() == [2, 0]
    np.testing.assert_allclose(tables["S"][1]["w"], [0.6, 0.4, 0.6])
    assert conv.tables["S"]["columns"]["w"][1] == "copied through soaLegacy (first linked row)"


def test_reached_by_a_counts_relation_and_unsorted_links():
    """counts offsets are integers even from u16 counts; links need not come grouped by `from`."""
    profile = {"relations": [
        {"name": "tLCs", "kind": "counts", "from": "T", "to": "LC", "counts": "T.n", "indices": "V.lc"},
        {"name": "lcHits", "kind": "links", "from": "LC", "to": "H", "table": "L", "fromIndex": "L.lc", "toIndex": "L.hit",
         "weights": ["L.f"]}],
        "internal": ["V", "L"], "cuts": {"LC": [{"reachedBy": "tLCs"}]}}
    conv = converter({"T": {"n": np.dtype("u2")}, "V": {"lc": I4}, "LC": {"e": F4}, "H": {"e": F4},
                      "L": {"lc": I4, "hit": I4, "f": F4}}, profile)
    _, tables, rels = one_event(conv, {"T": {"n": [1]}, "V": {"lc": [1]}, "LC": {"e": [1, 2]}, "H": {"e": [5, 6, 7]},
                                       "L": {"lc": [1, 0, 1], "hit": [2, 0, -1], "f": [.5, 1, .2]}})
    assert "V" not in tables and "L" not in tables
    assert tables["LC"][1]["e"].tolist() == [2]  # only LC 1 is in a trackster
    assert rels["lcHits"]["offsets"].tolist() == [0, 1] and rels["lcHits"]["indices"].tolist() == [2]  # -1 link dropped
    np.testing.assert_allclose(rels["lcHits"]["weights"]["f"], [.5])


def test_xy_from_eta_phi_z():
    derive = [{"table": "H", "xyFromEtaPhiZ": ["eta", "phi", "z"]}]
    conv = converter({"H": {"eta": F4, "phi": F4, "z": F4}}, {"derive": derive})
    eta = np.arcsinh(2.0)  # tan(theta) = 1/2: r = z/2
    _, tables, _ = one_event(conv, {"H": {"eta": [eta, eta], "phi": [0, np.pi / 2], "z": [400, 300]}})
    np.testing.assert_allclose(tables["H"][1]["x"], [200, 0], atol=1e-4)
    np.testing.assert_allclose(tables["H"][1]["y"], [0, 150], atol=1e-4)
    assert {("H", "x"), ("H", "y")} <= conv.derived and "H_x" not in conv.branches()


def test_neighbour_distance_derive():
    derive = [{"table": "Hit", "column": "size", "neighbourDistance": ["x", "y"], "groupBy": "layer", "k": 1, "scale": 0.5}]
    conv = converter({"Hit": {"x": F4, "y": F4, "layer": I4}}, {"derive": derive})
    _, tables, _ = one_event(conv, {"Hit": {"x": [0, 1, 0, 1, 2, 7], "y": [0] * 6, "layer": [25, 25, 26, 26, 26, 27]}})
    # layer 25: x = 0, 1 -> 1; layer 26: x = 0, 1, 2 -> 1 each; half of that; layer 27 has no other hit: 0
    assert tables["Hit"][1]["size"].tolist() == [0.5] * 5 + [0]
    assert ("Hit", "size") in conv.derived and "Hit_size" not in conv.branches()


def test_viewer_hints_are_passed_to_the_header():
    hints = {"replay": {"direction": [0, -1, 0]}, "view": {"minRadius": 25}, "summaries": [],
             "presets": [{"name": "E"}], "runTitle": "{Beam}", "runFields": ["Beam"]}
    best = {"weight": "score", "order": "min"}
    relation = {"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k", "association": True, "best": best}
    header = converter({"A": {"k": I4}, "B": {}}, {**hints, "relations": [relation]}).header([], "t")
    assert {k: header[k] for k in hints} == hints
    assert header["relations"]["r"] == {"from": "A", "to": "B", "weights": [], "association": True, "best": best}
    assert not set(hints) & set(converter({}, {}).header([], "t"))
