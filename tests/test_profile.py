"""Profile resolution against a file's tables: display kinds, sources and stages, column checks, sameRows, derived
columns, relation kinds beyond the plain ones, and the hints passed to the viewer."""
import json

import numpy as np
import pytest
from nanoaod import chunk, converter

from evdtools.nano import _compose, _gather, load_profile

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
    """Every top-level key the converter does not act on is a viewer setting, copied verbatim."""
    hints = {"replay": {"direction": [0, -1, 0]}, "view": {"minRadius": 25}, "summaries": [],
             "presets": [{"name": "E"}], "runTitle": "{Beam}", "runFields": ["Beam"],
             "field": {"bz": 3.8, "rMax": 295, "zMax": 300}}
    best = {"weight": "score", "order": "min"}
    relation = {"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k", "association": True, "best": best}
    header = converter({"A": {"k": I4}, "B": {}}, {**hints, "relations": [relation]}).header([], "t")
    assert {k: header[k] for k in hints} == hints
    assert header["relations"]["r"] == {"from": "A", "to": "B", "weights": [], "association": True, "best": best}
    assert not set(hints) & set(converter({}, {}).header([], "t"))
    assert "note" not in converter({}, {"note": "for readers"}).header([], "t")  # a profile key, not a hint
    with pytest.raises(ValueError, match="header's own"):
        converter({}, {"tables": {}})


def test_domains_without_layers_are_dropped():
    """`domains` is copied to the header without the domains none of the written layers is in (e.g. HGCal in a
    tracker-only bundle made from a profile that includes cms)."""
    domains = [{"name": "Tracker", "region": {"rMax": 125}, "colourMode": "layers"}, {"name": "HGCal", "region": {}}]
    kinds = {"hit": {"label": "Hits", "repr": "markers", "domain": "Tracker"}, "cell": {"label": "Cells", "repr": "cells", "domain": "HGCal"}}
    display = [{"table": "T", "kind": "hit", "position": ["x", "y", "z"]}, {"table": "H", "kind": "cell", "position": ["x", "y", "z"]}]
    profile = {"domains": domains, "kinds": kinds, "display": display}
    assert converter({"T": XYZE, "H": XYZE}, profile).header([], "t")["domains"] == domains
    assert converter({"T": XYZE}, profile).header([], "t")["domains"] == domains[:1]


def test_inverse_of_is_checked_and_passed_when_both_relations_are_written():
    """`inverseOf` (a part's pointer back up to its container) reaches the header only with the relation it names,
    which must have the opposite ends."""
    up = {"name": "up", "kind": "index", "from": "T", "to": "V", "index": "T.v", "inverseOf": "down"}
    down = {"name": "down", "kind": "index", "from": "V", "to": "T", "index": "T.v"}
    types = {"T": {"v": I4}, "V": {}}
    header = converter(types, {"relations": [up, down]}).header([], "t")
    assert header["relations"]["up"]["inverseOf"] == "down" and "inverseOf" not in header["relations"]["down"]
    assert "inverseOf" not in converter(types, {"relations": [up]}).header([], "t")["relations"]["up"]
    with pytest.raises(ValueError, match="not the inverse of"):
        converter(types | {"W": {"t": I4}}, {"relations": [up, {**down, "from": "W", "index": "W.t"}]})


def test_include_merges_profiles(tmp_path):
    """Included profiles merge in order, then the profile's own keys: dicts key by key, lists concatenate, other
    values are replaced. Includes are found next to the including profile, else among the built-in profiles."""
    write = lambda name, p: (tmp_path / f"{name}.json").write_text(json.dumps(p))
    write("a", {"name": "a", "note": "A", "internal": ["X"], "kinds": {"hit": {"repr": "cells", "cut": {"default": 1}}},
                "view": {"minRadius": 90}})
    write("b", {"name": "b", "internal": ["Y"], "kinds": {"track": {"repr": "helix"}}, "field": {"bz": 3.8}})
    write("top", {"include": ["a", "b"], "kinds": {"hit": {"domain": "HGCal", "cut": {"default": 2}}},
                  "view": {"start": "3d"}})
    p = load_profile(str(tmp_path / "top.json"))
    assert "include" not in p and "name" not in p  # an included profile's name is not inherited
    assert p["note"] == "A" and p["internal"] == ["X", "Y"] and p["field"] == {"bz": 3.8}
    assert p["kinds"] == {"hit": {"repr": "cells", "cut": {"default": 2}, "domain": "HGCal"}, "track": {"repr": "helix"}}
    assert list(p["kinds"]) == ["hit", "track"]  # the order of first appearance (kinds order the layers)
    assert p["view"] == {"minRadius": 90, "start": "3d"}
    write("builtin", {"include": ["testbeam"], "name": "mine"})
    assert load_profile(str(tmp_path / "builtin.json"))["name"] == "mine"  # a built-in profile, by name
    write("loop", {"include": ["loop2"]})
    write("loop2", {"include": ["loop"]})
    with pytest.raises(ValueError, match="includes itself"):
        load_profile(str(tmp_path / "loop.json"))


def test_same_rows_copy_takes_over_columns():
    """sameRows `copy`: the kept table gains columns of the dropped one (e.g. the HGCal entry point that another
    producer wrote for the same tracks), so derives and layers that used them keep working."""
    profile = {"sameRows": [{"keep": "T", "drop": "OldT", "columns": [["pt", "pt"]], "copy": ["hx"]}],
               "relations": [{"name": "candT", "kind": "index", "from": "C", "to": "OldT", "index": "C.t"}],
               "derive": [{"table": "C", "gather": [{"relation": "candT", "columns": {"x": "hx"}}]}]}
    conv = converter({"T": {"pt": F4}, "OldT": {"pt": F4, "hx": F4}, "C": {"t": I4}}, profile)
    assert "hx" in conv.written()["T"]["columns"] and "T_hx" not in conv.branches()
    _, tables, _ = one_event(conv, {"T": {"pt": [1, 2]}, "OldT": {"pt": [1, 2], "hx": [5, 6]}, "C": {"t": [1]}})
    assert tables["T"][1]["hx"].tolist() == [5, 6] and tables["C"][1]["x"].tolist() == [6]
    with pytest.raises(ValueError, match="cannot copy column hx"):
        converter({"T": {"pt": F4, "hx": F4}, "OldT": {"pt": F4, "hx": F4}}, profile)


def test_helix_columns_are_checked():
    layer = {"table": "T", "repr": "helix", "position": ["x", "y", "z"], "momentum": ["px", "py", "pz"],
             "charge": "q", "end": ["x", "y", "z"]}
    with pytest.raises(ValueError, match="display T: no column pz, q"):
        converter({"T": {**XYZE, "px": F4, "py": F4}}, {"display": [layer]})


def test_cms_profile_joins_hgcal_and_tracker():
    """cms = hgcal + tracker: HGCal kinds in the HGCal domain (from hgcal.json), truth particles as helices, the tracker's tracks with
    HGCalNanoAOD's GeneralTrack folded in (its HGCal entry taken over, its relations redirected); hgcal.json alone is
    unchanged."""
    p = load_profile("cms")
    assert p["name"] == "cms" and [d["name"] for d in p["domains"]] == ["Tracker", "HGCal"] and p["field"]["bz"] == 3.8
    assert p["kinds"]["rechit"]["domain"] == "HGCal" and p["kinds"]["rechit"]["repr"] == "cells"
    assert p["kinds"]["truthParticle"]["repr"] == "helix" and "domain" not in p["kinds"]["truthParticle"]
    assert load_profile("hgcal")["kinds"]["rechit"] == p["kinds"]["rechit"]
    assert [r["name"] for r in p["relations"]].count("truthProdVertex") == 1  # in-time truth from hgcal.json, once
    assert p["cuts"]["TruthParticles"] == [["bunchCrossing", "==", 0]] and len(p["cuts"]["TruthVertices"]) == 1
    types = {"Tracks": dict.fromkeys(("vx", "vy", "vz", "px", "py", "pz", "outerX", "outerY", "outerZ", "pt", "eta"), F4)
             | {"charge": np.dtype("i2"), "highPurity": np.dtype("u1"), "vertexIdx": I4},
             "GeneralTrack": dict.fromkeys(("pt", "eta", "vz", "hgcal_x", "hgcal_y", "hgcal_z"), F4),
             "TrackHits": {**XYZE, "trackIdx": I4, "subdet": np.dtype("u1")},
             "Vertices": {**XYZE, "sumPt2": F4}, "VertexTracks": {"vertexIdx": I4, "trackIdx": I4, "weight": F4},
             "TICLCandidates": {"trackIdx": I4, "time": F4, "energy": F4}}
    conv = converter(types, p)
    d = {x["table"]: x for x in conv.display}
    assert set(d) == {"Tracks", "TrackHits", "Vertices", "TICLCandidates"}  # GeneralTrack folded into Tracks
    assert (d["Tracks"]["repr"], d["Tracks"]["domain"], d["TICLCandidates"]["domain"]) == ("helix", "Tracker", "HGCal")
    assert d["Tracks"]["visible"] and not d["Tracks"]["onSelection"] and d["TrackHits"]["onSelection"]
    trk = {"vx": [0, 0], "vy": [0, 0], "vz": [1, 2], "px": [1, 0], "py": [0, 1], "pz": [0, 9], "outerX": [100, 0],
           "outerY": [0, 9], "outerZ": [1, 270], "pt": [1, 1], "eta": [0, 2.9], "charge": [1, -1], "highPurity": [1, 1],
           "vertexIdx": [0, -1]}
    gen = {"pt": [1, 1], "eta": [0, 2.9], "vz": [1, 2], "hgcal_x": [-999, 5], "hgcal_y": [-999, 6], "hgcal_z": [-999, 322]}
    _, tables, rels = one_event(conv, {
        "Tracks": trk, "GeneralTrack": gen, "Vertices": {"x": [0], "y": [0], "z": [1], "e": [0], "sumPt2": [4]},
        "VertexTracks": {"vertexIdx": [0], "trackIdx": [0], "weight": [0.9]},
        "TrackHits": {"x": [3, 6, 2], "y": [0, 0, 1], "z": [1, 1, 30], "e": [0, 0, 0], "trackIdx": [0, 0, 1], "subdet": [1, 1, 2]},
        "TICLCandidates": {"trackIdx": [1], "time": [0], "energy": [3]}})
    assert "GeneralTrack" not in tables and "VertexTracks" not in tables
    assert tables["Tracks"][1]["hgcal_z"].tolist() == [-999, 322] and tables["TICLCandidates"][1]["x"].tolist() == [5]
    assert rels["candidateTrack"]["indices"].tolist() == [1] and rels["trackHits"]["offsets"].tolist() == [0, 2, 3]
    assert rels["trackVertex"]["indices"].tolist() == [0] and rels["vertexTracks"]["indices"].tolist() == [0]


def test_tracker_profile_alone_and_tracker_only():
    """tracker.json alone has the field and the Tracker domain (cms.json has them once, through it), with trackVertex
    declared the inverse of vertexTracks; tracker_only.json (cms without the calorimeters) reads only the tracker
    tables (and truth, absent here), and its header keeps the Tracker domain alone."""
    t = load_profile("tracker")
    assert t["field"] == load_profile("cms")["field"] and t["domains"] == [load_profile("cms")["domains"][0]]
    assert t["domains"][0]["colourMode"] == "layers"
    types = {"Tracks": dict.fromkeys(("vx", "vy", "vz", "px", "py", "pz", "outerX", "outerY", "outerZ", "pt", "eta"), F4)
             | {"charge": np.dtype("i2"), "highPurity": np.dtype("u1"), "vertexIdx": I4},
             "TrackHits": {**XYZE, "trackIdx": I4, "subdet": np.dtype("u1")},
             "Vertices": {**XYZE, "sumPt2": F4}, "VertexTracks": {"vertexIdx": I4, "trackIdx": I4, "weight": F4},
             "TICLCandidates": {"trackIdx": I4, "time": F4, "energy": F4}, "HGCalHits": XYZE}
    conv = converter(types, load_profile("tracker_only"))
    assert set(conv.written()) == {"Tracks", "TrackHits", "Vertices"}
    header = conv.header([], "t")
    assert [d["name"] for d in header["domains"]] == ["Tracker"] and header["field"]["bz"] == 3.8
    assert header["relations"]["trackVertex"]["inverseOf"] == "vertexTracks"
    assert header["view"]["start"] == "front" and {d["table"]: d["repr"] for d in header["display"]}["Tracks"] == "helix"
