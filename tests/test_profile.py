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


def test_row_index_derive():
    """rowIndex: each row's number in the event, so a filter can pick the first row (the leading primary vertex)."""
    conv = converter({"V": XYZE}, {"derive": [{"table": "V", "rowIndex": "index"}]})
    assert conv.written()["V"]["columns"]["index"][0] == np.dtype("i4") and "V_index" not in conv.branches()
    _, tables, _ = one_event(conv, {"V": {"x": [1, 2, 3], "y": [0, 0, 0], "z": [0, 0, 0], "e": [0, 0, 0]}})
    assert tables["V"][1]["index"].tolist() == [0, 1, 2]


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
    match = {"measure": "hits", "target": "trackerHits", "shared": "sharedEnergy", "over": "nHits", "good": 0.75}
    relation = {"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k", "association": True, "best": best, "match": match}
    header = converter({"A": {"k": I4}, "B": {}}, {**hints, "relations": [relation]}).header([], "t")
    assert {k: header[k] for k in hints} == hints
    assert header["relations"]["r"] == {"from": "A", "to": "B", "weights": [], "association": True, "best": best, "match": match}
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


def test_new_layer_hints_name_existing_columns():
    """Columns named by the hints of the all-detectors format additions (cones, segments by direction, towers,
    object lists, inspector rows) are checked like the others; constants and `{"to": ...}` lengths are not columns."""
    ok = {"table": "J", "repr": "cones", "position": ["x", "y", "z"], "direction": ["eta", "phi"], "radius": 0.4,
          "length": {"to": {"r": 129, "z": 320}}, "list": {"columns": ["pt", "eta"], "sort": "pt"}, "inspect": ["pt"],
          "fractions": {"chf": "charged hadrons"}}
    jets = {"J": {**XYZE, "eta": F4, "phi": F4, "pt": F4, "chf": F4}}
    assert converter(jets, {"display": [ok]}).display[0]["radius"] == 0.4
    with pytest.raises(ValueError, match="display J: no column mass, nhf"):
        converter(jets, {"display": [{**ok, "fractions": {"nhf": "n"}, "inspect": ["mass"]}]})
    tower = {"table": "H", "repr": "cells", "position": ["x", "y", "z"],
             "cell": {"shape": "tower", "face": "disc", "dEta": "dEta", "dPhi": 0.087, "depth": {"column": "e", "scale": 4}}}
    with pytest.raises(ValueError, match="display H: no column dEta"):
        converter({"H": XYZE}, {"display": [tower]})
    assert converter({"H": {**XYZE, "dEta": F4}}, {"display": [tower]}).display[0]["cell"]["shape"] == "tower"


def test_relation_not_written_still_gathers():
    """`"written": false`: a relation used only to gather columns (jets take the position of the vertex they are
    drawn from) is built but not written to the header or the records."""
    rel = {"name": "jetVertex", "kind": "index", "from": "J", "to": "V", "index": "J.v", "written": False}
    profile = {"relations": [rel], "derive": [{"table": "J", "gather": [{"relation": "jetVertex", "columns": {"x": "x"}}]}]}
    conv = converter({"J": {"v": I4}, "V": {"x": F4}}, profile)
    assert "jetVertex" not in conv.header([], "t")["relations"]
    _, tables, rels = one_event(conv, {"J": {"v": [0, 0]}, "V": {"x": [3]}})
    assert tables["J"][1]["x"].tolist() == [3, 3] and "jetVertex" not in rels


def test_gather_missing_fills_only_nan_values():
    """`"missing": true`: a stored column keeps its finite values (and is still read from the file); only its NaN rows
    take the gathered value, here a candidate's track's outermost state where it has no ECAL entrance point."""
    profile = {"relations": [{"name": "candTrack", "kind": "index", "from": "C", "to": "T", "index": "C.t"}],
               "derive": [{"table": "C", "missing": True, "gather": [{"relation": "candTrack", "columns": {"endX": "outerX"}}]}]}
    conv = converter({"C": {"t": I4, "endX": F4}, "T": {"outerX": F4}}, profile)
    assert "C_endX" in conv.branches()
    _, tables, _ = one_event(conv, {"C": {"t": [0, 1, -1], "endX": [5, np.nan, np.nan]}, "T": {"outerX": [7, 8]}})
    out = tables["C"][1]["endX"]
    assert out[:2].tolist() == [5, 8] and np.isnan(out[2])  # kept, filled, no track: still NaN


def test_relation_names_must_be_unique():
    """Two relations with one name (e.g. from two included profiles) are an error, not a silent replacement."""
    rel = {"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k"}
    with pytest.raises(ValueError, match="relation names used twice in the profile: r"):
        converter({"A": {"k": I4}, "B": {}}, {"relations": [rel, {**rel, "to": "C"}]})


def test_path_layer_without_its_points_relation_is_dropped():
    """A polyline layer whose points relation is not built (its link table absent) is left out, not written broken."""
    layer = {"table": "T", "repr": "polyline", "position": ["x", "y", "z"], "points": {"relation": "tPoints"}}
    rel = {"name": "tPoints", "kind": "index", "from": "T", "to": "P", "index": "P.t"}
    assert [x["table"] for x in converter({"T": XYZE, "P": {**XYZE, "t": I4}}, {"display": [layer], "relations": [rel]}).display] == ["T"]
    assert converter({"T": XYZE}, {"display": [layer], "relations": [rel]}).display == []


def test_fact_hint_is_passed_to_the_header():
    """`fact` marks a truth -> hit relation as simulated energy per particle and cell (a fact, not a match)."""
    rel = {"name": "truthHits", "kind": "index", "from": "P", "to": "H", "index": "H.p", "association": True,
           "fact": {"in": "ECAL"}}
    header = converter({"P": {}, "H": {"p": I4}}, {"relations": [rel]}).header([], "t")
    assert header["relations"]["truthHits"]["fact"] == {"in": "ECAL"}


def test_cms_profile_joins_hgcal_and_tracker():
    """cms = hgcal + tracker: HGCal kinds in the HGCal domain (from hgcal.json), truth particles as helices, the tracker's tracks with
    HGCalNanoAOD's GeneralTrack folded in (its HGCal entry taken over, its relations redirected); hgcal.json alone is
    unchanged."""
    p = load_profile("cms")
    assert p["name"] == "cms" and [d["name"] for d in p["domains"]] == ["Physics", "Tracker", "Calo", "HGCal", "Muons"] and p["field"]["bz"] == 3.8
    assert p["kinds"]["rechit"]["domain"] == "HGCal" and p["kinds"]["rechit"]["repr"] == "cells"
    assert p["kinds"]["truthParticle"]["repr"] == "helix" and "domain" not in p["kinds"]["truthParticle"]
    assert load_profile("hgcal")["kinds"]["rechit"] == p["kinds"]["rechit"]
    assert [r["name"] for r in p["relations"]].count("truthProdVertex") == 1  # in-time truth from hgcal.json, once
    assert p["cuts"]["TruthParticles"] == [["bunchCrossing", "==", 0]] and len(p["cuts"]["TruthVertices"]) == 1
    types = {"Tracks": dict.fromkeys(("vx", "vy", "vz", "px", "py", "pz", "outerX", "outerY", "outerZ", "pt", "eta"), F4)
             | {"charge": np.dtype("i2"), "highPurity": np.dtype("u1"), "vertexIdx": I4},
             "GeneralTrack": dict.fromkeys(("pt", "eta", "vz", "hgcal_x", "hgcal_y", "hgcal_z"), F4),
             "TrackHits": {**XYZE, "trackIdx": I4, "subdet": np.dtype("u1")},
             "Vertices": {**XYZE, "sumPt2": F4, "nTracks": np.dtype("u2")}, "VertexTracks": {"vertexIdx": I4, "trackIdx": I4, "weight": F4},
             "TICLCandidates": {"trackIdx": I4, "time": F4, "energy": F4}}
    conv = converter(types, p)
    d = {x["table"]: x for x in conv.display}
    assert set(d) == {"Tracks", "TrackHits", "Vertices", "TICLCandidates"}  # GeneralTrack folded into Tracks
    assert (d["Tracks"]["repr"], d["Tracks"]["domain"], d["TICLCandidates"]["domain"]) == ("helix", "Tracker", "HGCal")
    assert d["Tracks"]["visible"] and not d["Tracks"]["onSelection"] and d["TrackHits"]["onSelection"]
    assert d["Tracks"]["grow"] == {"parts": "trackHits", "seed": 4}  # the replay builds tracks from their hits
    assert (conv.relations["trackHits"]["from"], conv.relations["trackHits"]["to"]) == ("Tracks", "TrackHits")
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


def test_calo_layers_in_cms():
    """cms includes calo.json: the barrel and forward calorimeter hits as towers in the Calo domain, one cut group
    per subdetector, HO and HF hidden, HF not drawn in the front view; HGCal truth -> hit relations are facts."""
    p = load_profile("cms")
    # the tower tables as the exporter writes them: an eta-phi extent and a depth, no half-width (that is HGCal's)
    hit = {**XYZE, **dict.fromkeys(("energy", "time", "dEta", "dPhi", "thickness"), F4), "layer": np.dtype("i2")}
    conv = converter({t: hit for t in ("EcalHits", "HBHEHits", "HOHits", "HFHits")}, p)
    d = {x["table"]: x for x in conv.display}
    assert all(x["size"] is None for x in d.values())
    assert {x["domain"] for x in d.values()} == {"Calo"} and all(x["cell"]["shape"] == "tower" for x in d.values())
    assert [t for t, x in d.items() if x["visible"]] == ["EcalHits", "HBHEHits"]
    assert len({x["cut"]["group"] for x in d.values()}) == 4 and "front" not in d["HFHits"]["views"]
    assert [x["name"] for x in conv.header([], "t")["domains"]] == ["Calo"]
    assert {r["name"]: r["fact"]["in"] for r in p["relations"] if "fact" in r} == {
        "truthHitsHGCal": "HGCal", "truthHitsSoAEE": "HGCal", "truthHitsSoAHSi": "HGCal", "truthHitsSoAHSci": "HGCal",
        "truthHitsEcal": "ECAL", "truthHitsHBHE": "HCAL", "truthHitsHO": "HO", "truthHitsHF": "HF", "truthHitsMuon": "Muon"}
    assert p["kinds"]["layerCluster"]["truthGap"]["derived"] == "content"


def test_physics_and_pf_in_cms():
    """cms includes physics.json and pf.json: Puppi jets as cones and MET as arrows from the leading vertex (its
    position gathered through relations that are not written), PF MET a hidden alternative, PF candidates unticked
    and filtered to what PUPPI kept, the vertices in the shared Physics domain where the event opens; kinds without an
    associator carry their truthGap."""
    p = load_profile("cms")
    assert p["view"]["domain"] == "Physics" and p["domains"][0] == {"name": "Physics", "shared": True, "region": {"rMax": 180, "zMax": 350}, "view": "3d", "colourMode": "layers"}
    met = dict.fromkeys(("pt", "phi", "sumEt", "px", "py", "pz"), F4) | {"vertexIdx": I4}
    pf = dict.fromkeys(("vx", "vy", "vz", "px", "py", "pz", "endX", "endY", "endZ", "pt", "eta", "phi", "energy", "ecalEnergy",
                        "hcalEnergy", "puppiWeight", "time"), F4) | {"charge": I4, "pdgId": I4, "trackIdx": I4, "ticlCandidateIdx": I4}
    types = {"Jets": dict.fromkeys(("pt", "eta", "phi", "mass", "energy", "area", "chargedHadronEF", "neutralHadronEF", "photonEF",
                                    "electronEF", "muonEF", "hfHadronEF", "hfEmEF"), F4) | {"nConstituents": np.dtype("u2"), "vertexIdx": I4},
             "JetConstituents": {"jetIdx": I4, "candIdx": I4}, "PuppiMET": met, "PFMET": met, "PFCandidates": pf,
             "Vertices": {**XYZE, "sumPt2": F4, "nTracks": np.dtype("u2")},
             "PFClustersECAL": dict.fromkeys(("x", "y", "z", "energy", "eta", "phi", "time"), F4) | {"nHits": np.dtype("u2")},
             "PFCandidateClustersECAL": {"candIdx": I4, "clusterIdx": I4}}
    conv = converter(types, p)
    d = {x["table"]: x for x in conv.display}
    assert (d["Jets"]["repr"], d["Jets"]["domain"], d["Jets"]["cut"]["default"], d["Jets"]["labels"]) == ("cones", "Physics", 30, 4)
    assert d["PuppiMET"]["visible"] and not d["PFMET"]["visible"] and d["PFMET"]["alternative"]
    assert load_profile("cms")["prefer"].index("Puppi") < load_profile("cms")["prefer"].index("CHS")  # Puppi jets shown, CHS hidden
    assert not d["PFCandidates"]["visible"] and d["PFCandidates"]["filter"] == "puppiWeight > 0"
    assert d["Vertices"]["domain"] == "Physics" and d["PFClustersECAL"]["domain"] == "Calo"
    assert d["Jets"]["truthGap"]["gap"] == 21 and d["PFCandidates"]["truthGap"]["gap"] == 20
    assert "truthGap" not in d["PFClustersECAL"] and d["PFClustersECAL"]["cut"]["default"] == 1.0  # its truth comes from CMSSW
    header = conv.header([], "t")
    assert "jetVertex" not in header["relations"] and header["relations"]["jetConstituents"]["to"] == "PFCandidates"
    assert [x["name"] for x in header["domains"]] == ["Physics", "Calo"]
    one = lambda **c: {k: [v] for k, v in c.items()}
    _, tables, rels = one_event(conv, {
        "Jets": {**{k: [1, 2] for k in types["Jets"]}, "vertexIdx": [0, 0]}, "JetConstituents": {"jetIdx": [0, 1, 1], "candIdx": [0, 1, 0]},
        "PuppiMET": one(**{k: 1 for k in met} | {"vertexIdx": 0}), "PFMET": one(**{k: 1 for k in met} | {"vertexIdx": 0}),
        "PFCandidates": {k: [1, 1] for k in pf}, "Vertices": {"x": [0.1], "y": [0.2], "z": [3], "e": [0], "sumPt2": [9], "nTracks": [2]},
        "PFClustersECAL": {k: [1] for k in types["PFClustersECAL"]}, "PFCandidateClustersECAL": {"candIdx": [1], "clusterIdx": [0]}})
    assert tables["Jets"][1]["z"].tolist() == [3, 3] and tables["PuppiMET"][1]["x"].tolist() == [np.float32(0.1)]
    assert rels["jetConstituents"]["offsets"].tolist() == [0, 1, 3] and rels["pfClustersECAL"]["indices"].tolist() == [0]
    assert "jetVertex" not in rels and "JetConstituents" not in tables
    rel = {r["name"]: r for r in p["relations"]}
    assert rel["vertexTruth"]["match"] == {"measure": "pt2", "in": "tracker", "target": "interaction", "purity": "fraction", "good": 0.5}
    assert rel["secondaryVertexTruth"]["match"]["target"] == "decayVertex" and "truthGap" not in p["kinds"]["vertex"]
    assert {k: v["truthGap"]["gap"] for k, v in p["kinds"].items() if "truthGap" in v and k in ("electron", "photon", "tau", "met")} == \
        {"electron": 23, "photon": 23, "tau": 24, "met": 22}


def test_muon_layers_in_cms():
    """cms includes muon.json: muons as a Physics kind (helix to their inner track's outermost state, gathered), their
    standalone and global tracks as paths through their ordered hits, segments as centred lines, hits and the chambers
    in use as boxes in the Muons domain, GE0 filtered out by default; muon-hit truth is a fact."""
    p = load_profile("cms")
    f4 = lambda *c: dict.fromkeys(c, F4)
    u1, i2 = np.dtype("u1"), np.dtype("i2")
    types = {"Muons": f4("pt", "eta", "phi", "px", "py", "pz", "vx", "vy", "vz", "relIso", "time")
                      | {k: u1 for k in ("isGlobal", "isTracker", "isStandAlone", "isPF", "isLoose", "isMedium", "isTight", "nMatchedStations")}
                      | {"charge": i2, "nValidMuonHits": i2, "trackIdx": I4, "ecalDetId": U4, "hcalDetId": U4},
             "Tracks": f4("outerX", "outerY", "outerZ", "vx", "vy", "vz", "px", "py", "pz", "pt", "eta") | {"charge": i2, "highPurity": u1, "vertexIdx": I4},
             "MuonTracks": f4("x", "y", "z", "pt", "eta", "phi", "chi2", "ndof") | {"muonIdx": I4, "kind": u1, "nMuonHits": i2},
             "MuonTrackHits": f4("x", "y", "z") | {"trackIdx": I4, "subdet": u1, "station": i2},
             "MuonSegments": f4("x", "y", "z", "dx", "dy", "dz", "halfLength", "chi2", "time") | {"subdet": u1, "station": i2, "nHits": u1, "ndof": u1, "chamberIdx": I4},
             "MuonHits": f4("x", "y", "z", "time") | {"subdet": u1, "station": i2, "chamberIdx": I4, "bx": i2, "clusterSize": u1},
             "MuonChambers": f4("x", "y", "z", "ux", "uy", "uz", "vx", "vy", "vz", "halfWidthBottom", "halfWidthTop", "halfLength", "halfThickness")
                             | {"subdet": u1, "station": i2, "wheelOrRing": i2, "sector": u1},
             "MuonSegmentMatches": {"muonIdx": I4, "segmentIdx": I4}}
    conv = converter(types, p)
    d = {x["table"]: x for x in conv.display}
    assert (d["Muons"]["domain"], d["Muons"]["repr"], d["MuonTracks"]["repr"], d["MuonTracks"]["points"]) == ("Physics", "helix", "polyline", {"relation": "muonTrackHits"})
    assert d["MuonChambers"]["cell"]["shape"] == "box" and not d["MuonChambers"].get("context") and d["MuonHits"]["filter"] == "subdet != 4 || station != 0" and d["MuonHits"]["onSelection"] and d["MuonChambers"]["onSelection"]
    assert d["MuonSegments"]["centred"] and d["Muons"]["truthGap"]["gap"] == 18 and d["MuonSegments"]["truthGap"]["gap"] == 17
    assert {r["name"]: r for r in p["relations"]}["truthHitsMuon"]["fact"]["unit"]["names"]["2"] == "CSC layer"
    assert d["MuonTrackHits"]["truthGap"]["gap"] == 18 and "reason" in d["MuonChambers"]["truthGap"]
    assert p["kinds"]["truthVertex"]["describe"]["columns"] == ["reason", "isSignal", "z"]
    _, tables, rels = one_event(conv, {
        "Muons": {**{k: [1] for k in types["Muons"]}, "trackIdx": [0]}, "Tracks": {**{k: [1] for k in types["Tracks"]}, "outerX": [5], "outerY": [6], "outerZ": [7]},
        "MuonTracks": {**{k: [1, 1] for k in types["MuonTracks"]}, "muonIdx": [0, 0]},
        "MuonTrackHits": {**{k: [1, 1, 1] for k in types["MuonTrackHits"]}, "trackIdx": [0, 1, 1]},
        "MuonSegments": {**{k: [1] for k in types["MuonSegments"]}, "chamberIdx": [0]},
        "MuonHits": {**{k: [1] for k in types["MuonHits"]}, "chamberIdx": [0]}, "MuonChambers": {k: [1] for k in types["MuonChambers"]},
        "MuonSegmentMatches": {"muonIdx": [0], "segmentIdx": [0]}})
    assert tables["Muons"][1]["endX"].tolist() == [5] and rels["muonTrackHits"]["offsets"].tolist() == [0, 1, 3]
    assert rels["muonSegments"]["indices"].tolist() == [0] and rels["chamberHits"]["indices"].tolist() == [0]


def test_hgcal_profile_alone_keeps_its_bundles():
    """hgcal.json (main's HGCal-only bundles) gained only truth hints: `fact` on its truth -> hit relations and the
    layer clusters' derived truthGap. No domain, outline, view or new kind reaches an hgcal bundle."""
    p = load_profile("hgcal")
    assert not {"domains", "outlines", "field"} & set(p) and "domain" not in p["view"] and len(p["display"]) == 16
    assert sorted(p["kinds"]) == ["candidate", "interpretation", "layerCluster", "linkedTrackster", "rechit", "track",
                                  "trackster", "truthParticle", "truthVertex"]
    assert {r["name"] for r in p["relations"] if "fact" in r} == {"truthHitsHGCal", "truthHitsSoAEE", "truthHitsSoAHSi", "truthHitsSoAHSci"}
    assert [k for k, v in p["kinds"].items() if "truthGap" in v] == ["layerCluster"]
    header = converter({"HGCalHits": {**XYZE, "energy": F4, "halfWidth": F4, "time": F4}}, p).header([], "t")
    assert not {"domains", "outlines"} & set(header) and [d["table"] for d in header["display"]] == ["HGCalHits"]


def test_every_cms_module_is_included_once():
    """cms = physics, hgcal, tracker, calo, pf, muon: each module's kinds are there once, domains in the contract order."""
    p = load_profile("cms")
    for module in ("physics", "hgcal", "tracker", "calo", "pf", "muon"):
        assert set(load_profile(module).get("kinds", {})) <= set(p["kinds"]), module
    names = [r["name"] for r in p["relations"]]
    assert len(names) == len(set(names))  # no relation twice
    assert [d["name"] for d in p["domains"]] == ["Physics", "Tracker", "Calo", "HGCal", "Muons"]
    assert p["view"]["domain"] == "Physics" and len({o["name"] for o in p["outlines"]}) == len(p["outlines"])


def test_tracker_profile_alone_and_tracker_only():
    """tracker.json alone has the field and the Tracker domain (cms.json has them once, through it), with trackVertex
    declared the inverse of vertexTracks; tracker_only.json (cms without the calorimeters) reads only the tracker
    tables (and truth, absent here), and its header keeps the Tracker domain alone."""
    t = load_profile("tracker")
    assert {"name": "Track time", "colour": {"Tracks": "t0", "Vertices": "t", "MTDHits": "time"}} in t["presets"]
    assert t["kinds"]["mtdHit"]["visible"] is False and t["kinds"]["mtdHit"]["truthGap"]["gap"] == 19
    assert t["field"] == load_profile("cms")["field"] and t["domains"] == [load_profile("cms")["domains"][1]]
    assert t["domains"][0]["colourMode"] == "layers"
    types = {"Tracks": dict.fromkeys(("vx", "vy", "vz", "px", "py", "pz", "outerX", "outerY", "outerZ", "pt", "eta"), F4)
             | {"charge": np.dtype("i2"), "highPurity": np.dtype("u1"), "vertexIdx": I4},
             "TrackHits": {**XYZE, "trackIdx": I4, "subdet": np.dtype("u1")},
             "Vertices": {**XYZE, "sumPt2": F4, "nTracks": np.dtype("u2")}, "VertexTracks": {"vertexIdx": I4, "trackIdx": I4, "weight": F4},
             "TICLCandidates": {"trackIdx": I4, "time": F4, "energy": F4}, "HGCalHits": XYZE,
             "MTDHits": {**XYZE, "time": F4, "timeError": F4, "energy": F4, "subdet": np.dtype("u1"), "row": np.dtype("i2"), "col": np.dtype("i2")},
             **{t: XYZE for t in ("EcalHits", "PFCandidates", "Jets", "Muons", "MuonHits", "SecondaryVertices", "Electrons", "GsfTracks",
                                  "PFClustersECAL", "EGammaSuperClusters", "Taus", "TruthMuonHits", "particleFlowClusterECALToTruth")}}
    conv = converter(types, load_profile("tracker_only"))
    assert set(conv.written()) == {"Tracks", "TrackHits", "Vertices", "MTDHits"}  # every other detector and object left out
    header = conv.header([], "t")
    assert [d["name"] for d in header["domains"]] == ["Tracker"] and header["field"]["bz"] == 3.8
    assert header["relations"]["trackVertex"]["inverseOf"] == "vertexTracks"
    assert header["view"]["start"] == "front" and {d["table"]: d["repr"] for d in header["display"]}["Tracks"] == "helix"


def test_clue3d_tracksters_are_matched_to_truth():
    """A stock release makes CLUE3D tracksters, not CLUEstering ones: both are matched to truth the same way, in both
    directions."""
    rels = {r["name"]: r for r in load_profile("hgcal")["relations"]}
    for reco, truth, table in (("clusteringTruth", "truthClusterings", "ticlTrackstersCLUEstering"),
                               ("clue3dTruth", "truthClue3d", "ticlTrackstersCLUE3DHigh")):
        assert rels[reco]["from"] == rels[truth]["to"] == table and rels[reco]["to"] == rels[truth]["from"] == "TruthParticles"
        assert rels[reco]["table"] == f"{table}ToTruth" and rels[truth]["table"] == f"{table}FromTruth"
        assert rels[reco]["match"] == rels["clusteringTruth"]["match"] and rels[truth]["match"] == rels["truthClusterings"]["match"]
    assert {"ticlTrackstersCLUE3DHighToTruth", "ticlTrackstersCLUE3DHighFromTruth"} <= set(load_profile("hgcal")["internal"])
