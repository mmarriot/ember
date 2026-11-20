"""Profile resolution against a file's tables: display kinds, sources and stages, column checks, sameRows, derived
columns, relation kinds beyond the plain ones, the hints passed to the viewer, and the shape a profile must have.
The built-in profiles have their own tests (test_builtin_profiles.py)."""

import json
import re

import numpy as np
import pytest
from nanoaod import chunk, converter

from embertools import Problem
from embertools.derive import gather
from embertools.profile import load_profile
from embertools.relations import compose_relations

F4, I4, U4 = np.dtype("f4"), np.dtype("i4"), np.dtype("u4")
XYZE = dict.fromkeys(("x", "y", "z", "e"), F4)
f4 = lambda *v: np.array(v, np.float32)
PROFILE = {
    "prefer": ["SoA", "legacy"],
    "kinds": {
        "hit": {"label": "Hits", "repr": "cells", "visible": True, "cut": {"group": "Hit energy", "default": 0.1}},
        "cluster": {"label": "Clusters", "repr": "markers", "visible": True},
    },
    "display": [
        {"table": "LegacyClusters", "kind": "cluster", "source": "legacy", "label": "C", "position": ["x", "y", "z"]},
        {
            "table": "SoAHits",
            "kind": "hit",
            "source": "SoA",
            "label": "H",
            "position": ["x", "y", "z"],
            "cut": {"column": "e"},
        },
        {
            "table": "LegacyHits",
            "kind": "hit",
            "source": "legacy",
            "label": "H",
            "position": ["x", "y", "z"],
            "cut": {"column": "e", "default": 0.2},
        },
        {
            "table": "Other",
            "group": "Misc",
            "label": "O",
            "repr": "markers",
            "position": ["x", "y", "z"],
            "visible": True,
        },
    ],
}


def one_event(conv, event):
    return conv.event(chunk(conv, event), 0)


def test_kinds_style_group_and_order():
    d = converter({"SoAHits": XYZE, "LegacyClusters": XYZE, "Other": XYZE}, PROFILE).display
    assert [x["table"] for x in d] == ["SoAHits", "LegacyClusters", "Other"]  # kinds order, then the rest
    soa = d[0]
    assert (soa["group"], soa["repr"], soa["label"]) == ("Hits", "cells", "H")
    assert soa["cut"] == {"group": "Hit energy", "default": 0.1, "column": "e"}
    assert d[2]["group"] == "Misc"  # layers without a kind are unchanged
    legacy = converter({"LegacyHits": XYZE}, PROFILE).display[0]
    assert legacy["cut"]["default"] == 0.2  # the layer's own keys win
    top_down = converter({"SoAHits": XYZE, "LegacyClusters": XYZE, "Other": XYZE}, {**PROFILE, "order": ["cluster"]})
    assert [x["table"] for x in top_down.display] == ["LegacyClusters", "SoAHits", "Other"]  # `order` first
    assert "order" not in top_down.header([], "t")  # a converter key, not a viewer setting


def test_one_source_per_kind():
    """Of a kind present from several sources, only the best (profile `prefer`) is written; its relations and derives
    may still read the others, which are not written, nor are the relations to them."""
    profile = {
        **PROFILE,
        "relations": [
            {
                "name": "soaLegacy",
                "kind": "key",
                "from": "SoAHits",
                "to": "LegacyHits",
                "fromKey": "SoAHits.id",
                "toKey": "LegacyHits.id",
            },
            {
                "name": "clusterHits",
                "kind": "index",
                "from": "LegacyHits",
                "to": "LegacyClusters",
                "index": "LegacyHits.c",
            },
        ],
        "derive": [{"table": "SoAHits", "gather": [{"relation": "soaLegacy", "columns": {"w": "w"}}]}],
    }
    types = {"SoAHits": {**XYZE, "id": U4}, "LegacyHits": {**XYZE, "id": U4, "w": F4, "c": I4}, "LegacyClusters": XYZE}
    conv = converter(types, profile)
    d = {x["table"]: x for x in conv.display}
    assert {t: x["visible"] for t, x in d.items()} == {"SoAHits": True, "LegacyClusters": True}  # no SoA clusters
    header = conv.header([], "t")
    assert set(header["tables"]) == {"SoAHits", "LegacyClusters"} and header["relations"] == {}
    hits = {c: [1.0] for c in "xyze"}
    _, tables, rels = one_event(
        conv,
        {
            "SoAHits": {**hits, "id": [7]},
            "LegacyHits": {**hits, "id": [7], "w": [0.4], "c": [0]},
            "LegacyClusters": hits,
        },
    )
    assert set(tables) == {"SoAHits", "LegacyClusters"} and rels == {}
    np.testing.assert_allclose(tables["SoAHits"][1]["w"], [0.4])  # gathered from the legacy hits
    d = converter({"LegacyHits": {**XYZE, "c": I4}}, PROFILE).display
    assert [(x["table"], x["visible"]) for x in d] == [("LegacyHits", True)]  # only legacy present: written, shown


def test_which_layers_compete_for_their_kind():
    """Only layers with a `source` compete, within their kind; equal sources and a profile without `prefer` keep
    every one; a table that another of its layers shows is kept; a sameRows copy is not present."""
    tables = {"SoAHits": XYZE, "LegacyHits": XYZE, "MoreHits": XYZE}
    more = {"table": "MoreHits", "kind": "hit", "label": "M", "position": ["x", "y", "z"]}  # other objects: no source
    written = lambda profile, types=tables: set(converter(types, profile).header([], "t")["tables"])
    assert written({**PROFILE, "display": [*PROFILE["display"], more]}) == {"SoAHits", "MoreHits"}
    assert written({k: v for k, v in PROFILE.items() if k != "prefer"}) == {"SoAHits", "LegacyHits", "MoreHits"}
    assert written({**PROFILE, "prefer": ["SoA"]}) == {"SoAHits", "MoreHits"}  # legacy unlisted: ranks last
    tie = {**PROFILE["display"][2], "source": "SoA"}  # the legacy hits' layer, as a second SoA source
    assert written({**PROFILE, "display": [PROFILE["display"][1], tie]}) == {"SoAHits", "LegacyHits", "MoreHits"}
    loses_and_wins = {**PROFILE["display"][1], "table": "LegacyHits", "kind": "cluster", "label": "C"}
    assert "LegacyHits" in written({**PROFILE, "display": [*PROFILE["display"], loses_and_wins]})
    same = [{"keep": "LegacyHits", "drop": "SoAHits", "columns": [["x", "x"]]}]  # the SoA copy is dropped first
    assert written({**PROFILE, "sameRows": same}, {"SoAHits": XYZE, "LegacyHits": XYZE}) == {"LegacyHits"}


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
        "prefer": ["SoA", "legacy"],
        "stages": ["shower", "linked", "candidate"],
        "kinds": {
            "cluster": {"label": "Clusters", "visible": True},
            "shower": {"label": "Showers", "visible": True},
            "track": {"label": "Tracks", "visible": True},
            "linked": {"label": "Linked", "visible": True},
        },
        "relations": [
            {"name": "showerLCs", "kind": "index", "from": "Showers", "to": "LCs", "index": "Showers.lc"},
            {"name": "linkedShowers", "kind": "index", "from": "Linked", "to": "Showers", "index": "Linked.s"},
            {
                "name": "linkedLCs",
                "kind": "compose",
                "from": "Linked",
                "to": "LCs",
                "via": ["linkedShowers", "showerLCs"],
            },
        ],
        "display": [
            {"table": "LCs", "kind": "cluster", "label": "LC", "position": ["x", "y", "z"], "colourBy": "stage"},
            {"table": "Showers", "kind": "shower", "source": "SoA", "label": "S", "position": ["x", "y", "z"]},
            {"table": "OldShowers", "kind": "shower", "source": "legacy", "label": "S", "position": ["x", "y", "z"]},
            {"table": "Linked", "kind": "linked", "source": "legacy", "label": "L", "position": ["x", "y", "z"]},
            {"table": "Tracks", "kind": "track", "label": "T", "position": ["x", "y", "z"], "stageOf": "shower"},
        ],
    }
    types = {
        "LCs": XYZE,
        "Showers": {**XYZE, "lc": I4},
        "OldShowers": XYZE,
        "Linked": {**XYZE, "s": I4},
        "Tracks": XYZE,
    }
    d = {x["table"]: x for x in converter(types, profile).display}
    assert (d["Showers"]["stage"], d["Linked"]["stage"]) == (0, 1) and "OldShowers" not in d  # one source per kind
    assert d["Tracks"]["stage"] == 0 and not d["Tracks"]["visible"]  # stageOf: joins the shower stage
    assert "stageOf" not in d["Tracks"]  # a profile key, not passed to the viewer
    assert [d[t]["visible"] for t in ("Showers", "Linked")] == [False, True]
    assert d["LCs"]["colourBy"] == {"relation": "linkedLCs"}  # the latest stage that reaches the clusters
    d = {x["table"]: x for x in converter({t: types[t] for t in ("LCs", "Showers")}, profile).display}
    assert d["Showers"]["visible"] and d["LCs"]["colourBy"] == {"relation": "showerLCs"}


def test_same_rows_drops_the_copy_redirects_relations_and_is_checked():
    profile = {
        "sameRows": [{"keep": "LC", "drop": "OldLC", "columns": [["e", "e"]]}],
        "relations": [
            {"name": "candT", "kind": "index", "from": "C", "to": "T", "index": "C.t"},
            {"name": "tLCs", "kind": "index", "from": "T", "to": "OldLC", "index": "T.lc"},
            {"name": "candLCs", "kind": "compose", "from": "C", "to": "LC", "via": ["candT", "tLCs"]},
        ],
        "display": [{"table": "OldLC", "label": "L", "position": ["x", "y", "z"]}],
    }
    types = {"LC": XYZE, "OldLC": XYZE, "T": {**XYZE, "lc": I4}, "C": {"t": I4}}
    conv = converter(types, profile)
    assert conv.relations["tLCs"]["to"] == "LC" and "OldLC" not in conv.written() and conv.display == []
    lc = {"x": f4(0, 1), "y": f4(0, 0), "z": f4(0, 0), "e": f4(5, 6)}
    ev = {
        "LC": lc,
        "OldLC": lc,
        "T": {"x": f4(7, 8), "y": f4(0, 0), "z": f4(0, 0), "e": f4(1, 2), "lc": [1, 0]},
        "C": {"t": [1, -1, 0]},
    }
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
    c = compose_relations(a, b)
    assert c["offsets"].tolist() == [0, 1, 1, 3] and c["indices"].tolist() == [6, 5, 6]
    track = {"offsets": np.array([0, 0, 1, 1, 1]), "indices": np.array([0])}  # only candidate 1 has a track
    a4 = {"offsets": np.append(a["offsets"], 3), "indices": a["indices"]}  # candidate 3: no shower, no track
    tables = {
        "Cand": (4, {}),
        "Shower": (2, {"bx": np.array([10.0, 20.0]), "ev": np.array([4.0, 9.0])}),
        "Track": (1, {"hx": np.array([7.0])}),
    }
    d = {
        "table": "Cand",
        "gather": [{"relation": "a", "columns": {"x": "bx", "ext": "ev"}}, {"relation": "t", "columns": {"x": "hx"}}],
    }
    gather(d, tables, {"a": a4, "t": track}, {"a": {"to": "Shower"}, "t": {"to": "Track"}})
    x, ext = tables["Cand"][1]["x"], tables["Cand"][1]["ext"]
    assert x[:3].tolist() == [20.0, 7.0, 10.0]  # the first shower; else the track
    assert ext[:3].tolist() == [9.0, 0.0, 4.0]  # placed by the track: the columns it does not give are 0
    assert np.isnan(x[3]) and np.isnan(ext[3])  # reached by nothing


def test_key_relation_and_gather_fill():
    """A key relation joins rows with equal keys (any order); gather copies through it, `fill` for rows without one."""
    profile = {
        "relations": [{"name": "soaLegacy", "kind": "key", "from": "S", "to": "L", "fromKey": "S.id", "toKey": "L.id"}],
        "derive": [{"table": "S", "gather": [{"relation": "soaLegacy", "columns": {"w": "w"}}], "fill": 0.6}],
    }
    conv = converter({"S": {"id": U4}, "L": {"id": U4, "w": F4}}, profile)
    _, tables, rels = one_event(conv, {"S": {"id": [30, 10, 99]}, "L": {"id": [10, 20, 30], "w": [0.4, 0.5, 0.6]}})
    assert rels["soaLegacy"]["offsets"].tolist() == [0, 1, 2, 2] and rels["soaLegacy"]["indices"].tolist() == [2, 0]
    np.testing.assert_allclose(tables["S"][1]["w"], [0.6, 0.4, 0.6])
    assert conv.tables["S"]["columns"]["w"][1] == "copied through soaLegacy (first linked row)"


def test_reached_by_a_counts_relation_and_unsorted_links():
    """counts offsets are integers even from u16 counts; links need not come grouped by `from`."""
    profile = {
        "relations": [
            {"name": "tLCs", "kind": "counts", "from": "T", "to": "LC", "counts": "T.n", "indices": "V.lc"},
            {
                "name": "lcHits",
                "kind": "links",
                "from": "LC",
                "to": "H",
                "table": "L",
                "fromIndex": "L.lc",
                "toIndex": "L.hit",
                "weights": ["L.f"],
            },
        ],
        "internal": ["V", "L"],
        "cuts": {"LC": [{"reachedBy": "tLCs"}]},
    }
    conv = converter(
        {
            "T": {"n": np.dtype("u2")},
            "V": {"lc": I4},
            "LC": {"e": F4},
            "H": {"e": F4},
            "L": {"lc": I4, "hit": I4, "f": F4},
        },
        profile,
    )
    _, tables, rels = one_event(
        conv,
        {
            "T": {"n": [1]},
            "V": {"lc": [1]},
            "LC": {"e": [1, 2]},
            "H": {"e": [5, 6, 7]},
            "L": {"lc": [1, 0, 1], "hit": [2, 0, -1], "f": [0.5, 1, 0.2]},
        },
    )
    assert "V" not in tables and "L" not in tables
    assert tables["LC"][1]["e"].tolist() == [2]  # only LC 1 is in a trackster
    assert rels["lcHits"]["offsets"].tolist() == [0, 1] and rels["lcHits"]["indices"].tolist() == [2]  # -1 link dropped
    np.testing.assert_allclose(rels["lcHits"]["weights"]["f"], [0.5])


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


def test_parent_row_lets_children_in_their_parents_order_be_split():
    """parentRow: the hits of tracks (a count per track, the hits in track order) each name their track, so the
    muon-system hits of global muon tracks can be split off and still be related to their track."""
    profile = {
        "derive": [
            {"table": "Hit", "parentRow": "trackIdx", "counts": "Track.nHit"},
            {"table": "Hit", "split": {"MuonHit": [["det", "==", 2]]}},
        ],
        "relations": [{"name": "trackMuonHits", "kind": "index", "from": "Track", "to": "MuonHit",
                       "index": "MuonHit.trackIdx"}],
    }  # fmt: skip
    conv = converter({"Track": {"pt": F4, "nHit": I4}, "Hit": {**XYZE, "det": I4}}, profile)
    hits = {"x": [0, 1, 2, 3, 4], "y": [0] * 5, "z": [0] * 5, "e": [0] * 5, "det": [1, 2, 1, 2, 2]}
    _, tables, relations = one_event(conv, {"Track": {"pt": [5, 9], "nHit": [2, 3]}, "Hit": hits})
    assert tables["MuonHit"][1]["trackIdx"].tolist() == [0, 1, 1] and tables["MuonHit"][1]["x"].tolist() == [1, 3, 4]
    rel = relations["trackMuonHits"]
    assert rel["offsets"].tolist() == [0, 1, 3] and rel["indices"].tolist() == [0, 1, 2]
    with pytest.raises(ValueError, match="5 children counted"):
        one_event(conv, {"Track": {"pt": [5, 9], "nHit": [2, 3]}, "Hit": {c: v[:4] for c, v in hits.items()}})


def test_nan_unless_and_time_at_origin_derives():
    """nanUnless: no time where a track has none (sigmat0 < 0 writes t0 = 0); timeAtOrigin: a hit's time minus the
    flight from the origin, on the tracks' t0 scale."""
    profile = {"derive": [
        {"table": "Track", "nanUnless": ["sigmat0", ">", 0], "columns": ["t0"]},
        {"table": "Hit", "timeAtOrigin": "t0", "time": "time", "position": ["x", "y", "z"]},
    ]}  # fmt: skip
    conv = converter({"Track": {"t0": F4, "sigmat0": F4}, "Hit": {**XYZE, "time": F4}}, profile)
    assert "Track_t0" in conv.branches()  # still read: the derive only blanks it
    event = {"Track": {"t0": [0.2, 0.0], "sigmat0": [0.03, -1]},
             "Hit": {"x": [0, 30], "y": [0, 40], "z": [299.792458, 0], "e": [0, 0], "time": [10.5, 2.0]}}  # fmt: skip
    _, tables, _ = one_event(conv, event)
    t0 = tables["Track"][1]["t0"]
    assert t0[0] == np.float32(0.2) and np.isnan(t0[1])
    assert np.allclose(tables["Hit"][1]["t0"], [0.5, 2.0 - 50 / 29.9792458])


def test_neighbour_distance_derive():
    derive = [
        {"table": "Hit", "column": "size", "neighbourDistance": ["x", "y"], "groupBy": "layer", "k": 1, "scale": 0.5}
    ]
    conv = converter({"Hit": {"x": F4, "y": F4, "layer": I4}}, {"derive": derive})
    _, tables, _ = one_event(conv, {"Hit": {"x": [0, 1, 0, 1, 2, 7], "y": [0] * 6, "layer": [25, 25, 26, 26, 26, 27]}})
    # layer 25: x = 0, 1 -> 1; layer 26: x = 0, 1, 2 -> 1 each; half of that; layer 27 has no other hit: 0
    assert tables["Hit"][1]["size"].tolist() == [0.5] * 5 + [0]
    assert ("Hit", "size") in conv.derived and "Hit_size" not in conv.branches()


def test_viewer_hints_are_passed_to_the_header():
    """Every top-level key the converter does not act on is a viewer setting, copied verbatim."""
    hints = {
        "replay": {"direction": [0, -1, 0]},
        "view": {"minRadius": 25},
        "summaries": [],
        "presets": [{"name": "E"}],
        "runTitle": "{Beam}",
        "runFields": ["Beam"],
        "field": {"bz": 3.8, "rMax": 295, "zMax": 300},
    }
    best = {"weight": "score", "order": "min"}
    match = {"measure": "hits", "target": "trackerHits", "shared": "sharedEnergy", "over": "nHits", "good": 0.75}
    relation = {
        "name": "r",
        "kind": "index",
        "from": "A",
        "to": "B",
        "index": "A.k",
        "association": True,
        "best": best,
        "match": match,
    }
    header = converter({"A": {"k": I4}, "B": {}}, {**hints, "relations": [relation]}).header([], "t")
    assert {k: header[k] for k in hints} == hints
    assert header["relations"]["r"] == {
        "from": "A",
        "to": "B",
        "weights": [],
        "association": True,
        "best": best,
        "match": match,
    }
    assert not set(hints) & set(converter({}, {}).header([], "t"))
    assert "note" not in converter({}, {"note": "for readers"}).header([], "t")  # a profile key, not a hint
    with pytest.raises(ValueError, match="header's own"):
        converter({}, {"tables": {}})


def test_domains_without_layers_are_dropped():
    """`domains` is copied to the header without the domains none of the written layers is in (e.g. HGCal in a
    tracker-only bundle made from a profile that includes cms)."""
    domains = [{"name": "Tracker", "region": {"rMax": 125}, "colourMode": "layers"}, {"name": "HGCal", "region": {}}]
    kinds = {
        "hit": {"label": "Hits", "repr": "markers", "domain": "Tracker"},
        "cell": {"label": "Cells", "repr": "cells", "domain": "HGCal"},
    }
    display = [
        {"table": "T", "kind": "hit", "position": ["x", "y", "z"]},
        {"table": "H", "kind": "cell", "position": ["x", "y", "z"]},
    ]
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
    write(
        "a",
        {
            "name": "a",
            "note": "A",
            "internal": ["X"],
            "kinds": {"hit": {"repr": "cells", "cut": {"default": 1}}},
            "view": {"minRadius": 90},
        },
    )
    write("b", {"name": "b", "internal": ["Y"], "kinds": {"track": {"repr": "helix"}}, "field": {"bz": 3.8}})
    write(
        "top",
        {"include": ["a", "b"], "kinds": {"hit": {"domain": "HGCal", "cut": {"default": 2}}}, "view": {"start": "3d"}},
    )
    p = load_profile(str(tmp_path / "top.json"))
    assert "include" not in p and "name" not in p  # an included profile's name is not inherited
    assert p["note"] == "A" and p["internal"] == ["X", "Y"] and p["field"] == {"bz": 3.8}
    assert p["kinds"] == {
        "hit": {"repr": "cells", "cut": {"default": 2}, "domain": "HGCal"},
        "track": {"repr": "helix"},
    }
    assert list(p["kinds"]) == ["hit", "track"]  # the order of first appearance (kinds order the layers)
    write("ordered", {"include": ["a"], "order": ["hit"]})
    write("reordered", {"include": ["ordered", "b"], "order": ["track", "hit"]})
    assert load_profile(str(tmp_path / "reordered.json"))["order"] == ["track", "hit"]  # its own, not joined
    assert load_profile(str(tmp_path / "top.json")).get("order") is None
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
    profile = {
        "sameRows": [{"keep": "T", "drop": "OldT", "columns": [["pt", "pt"]], "copy": ["hx"]}],
        "relations": [{"name": "candT", "kind": "index", "from": "C", "to": "OldT", "index": "C.t"}],
        "derive": [{"table": "C", "gather": [{"relation": "candT", "columns": {"x": "hx"}}]}],
    }
    conv = converter({"T": {"pt": F4}, "OldT": {"pt": F4, "hx": F4}, "C": {"t": I4}}, profile)
    assert "hx" in conv.written()["T"]["columns"] and "T_hx" not in conv.branches()
    _, tables, _ = one_event(conv, {"T": {"pt": [1, 2]}, "OldT": {"pt": [1, 2], "hx": [5, 6]}, "C": {"t": [1]}})
    assert tables["T"][1]["hx"].tolist() == [5, 6] and tables["C"][1]["x"].tolist() == [6]
    with pytest.raises(ValueError, match="cannot copy column hx"):
        converter({"T": {"pt": F4, "hx": F4}, "OldT": {"pt": F4, "hx": F4}}, profile)


def test_helix_columns_are_checked():
    layer = {
        "table": "T",
        "repr": "helix",
        "position": ["x", "y", "z"],
        "momentum": ["px", "py", "pz"],
        "charge": "q",
        "end": ["x", "y", "z"],
    }
    with pytest.raises(ValueError, match="display T: no column pz, q"):
        converter({"T": {**XYZE, "px": F4, "py": F4}}, {"display": [layer]})


def test_new_layer_hints_name_existing_columns():
    """Columns named by the hints of the all-detectors format additions (cones, segments by direction, towers,
    object lists, inspector rows) are checked like the others; constants and `{"to": ...}` lengths are not columns."""
    ok = {
        "table": "J",
        "repr": "cones",
        "position": ["x", "y", "z"],
        "direction": ["eta", "phi"],
        "radius": 0.4,
        "length": {"to": {"r": 129, "z": 320}},
        "list": {"columns": ["pt", "eta"], "sort": "pt"},
        "inspect": ["pt"],
        "fractions": {"chf": "charged hadrons"},
    }
    jets = {"J": {**XYZE, "eta": F4, "phi": F4, "pt": F4, "chf": F4}}
    assert converter(jets, {"display": [ok]}).display[0]["radius"] == 0.4
    with pytest.raises(ValueError, match="display J: no column mass, nhf"):
        converter(jets, {"display": [{**ok, "fractions": {"nhf": "n"}, "inspect": ["mass"]}]})
    tower = {
        "table": "H",
        "repr": "cells",
        "position": ["x", "y", "z"],
        "cell": {"shape": "tower", "face": "disc", "dEta": "dEta", "dPhi": 0.087, "depth": {"column": "e", "scale": 4}},
    }
    with pytest.raises(ValueError, match="display H: no column dEta"):
        converter({"H": XYZE}, {"display": [tower]})
    assert converter({"H": {**XYZE, "dEta": F4}}, {"display": [tower]}).display[0]["cell"]["shape"] == "tower"


def test_relation_not_written_still_gathers():
    """`"written": false`: a relation used only to gather columns (jets take the position of the vertex they are
    drawn from) is built but not written to the header or the records."""
    rel = {"name": "jetVertex", "kind": "index", "from": "J", "to": "V", "index": "J.v", "written": False}
    profile = {
        "relations": [rel],
        "derive": [{"table": "J", "gather": [{"relation": "jetVertex", "columns": {"x": "x"}}]}],
    }
    conv = converter({"J": {"v": I4}, "V": {"x": F4}}, profile)
    assert "jetVertex" not in conv.header([], "t")["relations"]
    _, tables, rels = one_event(conv, {"J": {"v": [0, 0]}, "V": {"x": [3]}})
    assert tables["J"][1]["x"].tolist() == [3, 3] and "jetVertex" not in rels


def test_gather_missing_fills_only_nan_values():
    """`"missing": true`: a stored column keeps its finite values (and is still read from the file); only its NaN rows
    take the gathered value, here a candidate's track's outermost state where it has no ECAL entrance point."""
    profile = {
        "relations": [{"name": "candTrack", "kind": "index", "from": "C", "to": "T", "index": "C.t"}],
        "derive": [
            {"table": "C", "missing": True, "gather": [{"relation": "candTrack", "columns": {"endX": "outerX"}}]}
        ],
    }
    conv = converter({"C": {"t": I4, "endX": F4}, "T": {"outerX": F4}}, profile)
    assert "C_endX" in conv.branches()
    _, tables, _ = one_event(conv, {"C": {"t": [0, 1, -1], "endX": [5, np.nan, np.nan]}, "T": {"outerX": [7, 8]}})
    out = tables["C"][1]["endX"]
    assert out[:2].tolist() == [5, 8] and np.isnan(out[2])  # kept, filled, no track: still NaN


def test_inspect_groups_keep_the_columns_the_table_has_and_a_label_follows_a_column():
    """inspectGroups: only the columns of the table written, and no empty group; labelWithout: the label of a table
    that lacks the column (ember's own uncorrected jets, which have no rawFactor)."""
    layer = {"table": "Jet", "label": "AK4", "position": ["x", "y", "z"],
             "labelWithout": {"column": "rawFactor", "label": "AK4 (raw)"},
             "inspectGroups": [{"name": "b-tag", "columns": ["btagA", "btagB"]}, {"name": "ID", "columns": ["id"]}]}  # fmt: skip
    conv = converter({"Jet": {**dict.fromkeys("xyz", F4), "btagB": F4}}, {"display": [layer]})
    (out,) = conv.display
    assert out["label"] == "AK4 (raw)" and out["inspectGroups"] == [{"name": "b-tag", "columns": ["btagB"]}]
    assert "labelWithout" not in out
    conv = converter({"Jet": {**dict.fromkeys("xyz", F4), "rawFactor": F4}}, {"display": [layer]})
    (out,) = conv.display
    assert out["label"] == "AK4" and "inspectGroups" not in out


def test_relation_names_must_be_unique():
    """Two relations with one name (e.g. from two included profiles) are an error, not a silent replacement."""
    rel = {"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k"}
    with pytest.raises(ValueError, match="relation names used twice in the profile: r"):
        converter({"A": {"k": I4}, "B": {}}, {"relations": [rel, {**rel, "to": "C"}]})


def test_path_layer_without_its_points_relation_is_dropped():
    """A polyline layer whose points relation is not built (its link table absent) is left out, not written broken."""
    layer = {"table": "T", "repr": "polyline", "position": ["x", "y", "z"], "points": {"relation": "tPoints"}}
    rel = {"name": "tPoints", "kind": "index", "from": "T", "to": "P", "index": "P.t"}
    assert [
        x["table"]
        for x in converter({"T": XYZE, "P": {**XYZE, "t": I4}}, {"display": [layer], "relations": [rel]}).display
    ] == ["T"]
    assert converter({"T": XYZE}, {"display": [layer], "relations": [rel]}).display == []


def test_fact_hint_is_passed_to_the_header():
    """`fact` marks a truth -> hit relation as simulated energy per particle and cell (a fact, not a match)."""
    rel = {
        "name": "truthHits",
        "kind": "index",
        "from": "P",
        "to": "H",
        "index": "H.p",
        "association": True,
        "fact": {"in": "ECAL"},
    }
    header = converter({"P": {}, "H": {"p": I4}}, {"relations": [rel]}).header([], "t")
    assert header["relations"]["truthHits"]["fact"] == {"in": "ECAL"}


@pytest.mark.parametrize(
    ("profile", "message"),
    [
        ({"relations": [{"name": "r", "from": "A", "to": "B"}]}, "relations[0] (r) has no 'kind'"),
        ({"relations": [{"name": "r", "kind": "compose"}]}, "relations[0] (r) has no 'via'"),
        ({"display": [{"table": "A", "label": "A"}]}, "display[0] has no 'position'"),
        ({"cuts": {"Hit": ["e", ">", 0]}}, "cuts of Hit must be a list of conditions"),
        ({"derive": {"table": "A"}}, "derive must be a list"),
        ({"order": "jet"}, "order must be a list of kinds"),
    ],
)
def test_a_profile_of_the_wrong_shape_says_what_is_missing_where(tmp_path, profile, message):
    path = tmp_path / "p.json"
    path.write_text(json.dumps(profile))
    with pytest.raises(Problem, match=re.escape(message)):
        load_profile(str(path))


def test_a_layer_may_take_its_position_and_label_from_its_kind(tmp_path):
    path = tmp_path / "p.json"
    kinds = {"hit": {"label": "Hits", "position": ["x", "y", "z"]}}
    path.write_text(json.dumps({"kinds": kinds, "display": [{"table": "A", "kind": "hit"}]}))
    assert load_profile(str(path))["display"][0]["kind"] == "hit"
