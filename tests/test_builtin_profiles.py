"""The built-in profiles (embertools/profiles/) resolved against the tables of real exports: what each module of
cms.json draws, how they combine, and that the stock-release tables are read."""

import json
from pathlib import Path

import numpy as np
import pytest
from nanoaod import chunk, converter

from embertools.profile import BUILTIN, load_profile

F4, I4, U4 = np.dtype("f4"), np.dtype("i4"), np.dtype("u4")
XYZE = dict.fromkeys(("x", "y", "z", "e"), F4)
f4 = lambda *v: np.array(v, np.float32)


def one_event(conv, event):
    return conv.event(chunk(conv, event), 0)


def test_cms_profile_joins_hgcal_and_tracker():
    """cms = hgcal + tracker: HGCal kinds in the HGCal domain (from hgcal.json), truth particles as helices, the tracker's tracks with
    HGCalNanoAOD's GeneralTrack folded in (its HGCal entry taken over, its relations redirected); hgcal.json alone is
    unchanged."""
    p = load_profile("cms")
    assert (
        p["name"] == "cms"
        and [d["name"] for d in p["domains"]] == ["Physics", "Tracker", "Calo", "HGCal", "Muons"]
        and p["field"]["bz"] == 3.8
    )
    assert p["kinds"]["rechit"]["domain"] == "HGCal" and p["kinds"]["rechit"]["repr"] == "cells"
    assert p["kinds"]["truthParticle"]["repr"] == "helix" and "domain" not in p["kinds"]["truthParticle"]
    assert load_profile("hgcal")["kinds"]["rechit"] == p["kinds"]["rechit"]
    assert [r["name"] for r in p["relations"]].count("truthProdVertex") == 1  # in-time truth from hgcal.json, once
    assert p["cuts"]["TruthParticles"] == [["bunchCrossing", "==", 0]] and len(p["cuts"]["TruthVertices"]) == 1
    types = {
        "Tracks": dict.fromkeys(("vx", "vy", "vz", "px", "py", "pz", "outerX", "outerY", "outerZ", "pt", "eta"), F4)
        | {"charge": np.dtype("i2"), "highPurity": np.dtype("u1"), "vertexIdx": I4},
        "GeneralTrack": dict.fromkeys(("pt", "eta", "vz", "hgcal_x", "hgcal_y", "hgcal_z"), F4),
        "TrackHits": {**XYZE, "trackIdx": I4, "subdet": np.dtype("u1")},
        "Vertices": {**XYZE, "sumPt2": F4, "nTracks": np.dtype("u2")},
        "VertexTracks": {"vertexIdx": I4, "trackIdx": I4, "weight": F4},
        "TICLCandidates": {"trackIdx": I4, "time": F4, "energy": F4},
    }
    conv = converter(types, p)
    d = {x["table"]: x for x in conv.display}
    assert set(d) == {"Tracks", "TrackHits", "Vertices", "TICLCandidates"}  # GeneralTrack folded into Tracks
    assert (d["Tracks"]["repr"], d["Tracks"]["domain"], d["TICLCandidates"]["domain"]) == ("helix", "Tracker", "HGCal")
    assert d["Tracks"]["visible"] and not d["Tracks"]["onSelection"] and d["TrackHits"]["onSelection"]
    assert d["Tracks"]["grow"] == {"parts": "trackHits", "seed": 4}  # the replay builds tracks from their hits
    assert (conv.relations["trackHits"]["from"], conv.relations["trackHits"]["to"]) == ("Tracks", "TrackHits")
    trk = {
        "vx": [0, 0],
        "vy": [0, 0],
        "vz": [1, 2],
        "px": [1, 0],
        "py": [0, 1],
        "pz": [0, 9],
        "outerX": [100, 0],
        "outerY": [0, 9],
        "outerZ": [1, 270],
        "pt": [1, 1],
        "eta": [0, 2.9],
        "charge": [1, -1],
        "highPurity": [1, 1],
        "vertexIdx": [0, -1],
    }
    gen = {
        "pt": [1, 1],
        "eta": [0, 2.9],
        "vz": [1, 2],
        "hgcal_x": [-999, 5],
        "hgcal_y": [-999, 6],
        "hgcal_z": [-999, 322],
    }
    _, tables, rels = one_event(
        conv,
        {
            "Tracks": trk,
            "GeneralTrack": gen,
            "Vertices": {"x": [0], "y": [0], "z": [1], "e": [0], "sumPt2": [4]},
            "VertexTracks": {"vertexIdx": [0], "trackIdx": [0], "weight": [0.9]},
            "TrackHits": {
                "x": [3, 6, 2],
                "y": [0, 0, 1],
                "z": [1, 1, 30],
                "e": [0, 0, 0],
                "trackIdx": [0, 0, 1],
                "subdet": [1, 1, 2],
            },
            "TICLCandidates": {"trackIdx": [1], "time": [0], "energy": [3]},
        },
    )
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
        "truthHitsHGCal": "HGCal",
        "truthHitsSoAEE": "HGCal",
        "truthHitsSoAHSi": "HGCal",
        "truthHitsSoAHSci": "HGCal",
        "truthHitsEcal": "ECAL",
        "truthHitsHBHE": "HCAL",
        "truthHitsHO": "HO",
        "truthHitsHF": "HF",
        "truthHitsMuon": "Muon",
    }
    assert "derived" not in p["kinds"]["layerCluster"]["truthGap"]  # Ember derives no truth: a gap is a gap


def test_physics_and_pf_in_cms():
    """cms includes physics.json and pf.json: Puppi jets as cones and MET as arrows from the leading vertex (its
    position gathered through relations that are not written), PF MET hidden next to Puppi MET (other objects:
    both written), PF candidates unticked
    and filtered to what PUPPI kept, the vertices in the shared Physics domain where the event opens; kinds without an
    associator carry their truthGap."""
    p = load_profile("cms")
    assert p["view"]["domain"] == "Physics" and p["domains"][0] == {
        "name": "Physics",
        "shared": True,
        "region": {"rMax": 180, "zMax": 350},
        "view": "3d",
        "colourMode": "layers",
    }
    met = dict.fromkeys(("pt", "phi", "sumEt", "px", "py", "pz"), F4) | {"vertexIdx": I4}
    pf = dict.fromkeys(
        (
            "vx",
            "vy",
            "vz",
            "px",
            "py",
            "pz",
            "endX",
            "endY",
            "endZ",
            "pt",
            "eta",
            "phi",
            "energy",
            "ecalEnergy",
            "hcalEnergy",
            "puppiWeight",
            "time",
        ),
        F4,
    ) | {"charge": I4, "pdgId": I4, "trackIdx": I4, "ticlCandidateIdx": I4}
    types = {
        "Jets": dict.fromkeys(
            (
                "pt",
                "eta",
                "phi",
                "mass",
                "energy",
                "area",
                "chargedHadronEF",
                "neutralHadronEF",
                "photonEF",
                "electronEF",
                "muonEF",
                "hfHadronEF",
                "hfEmEF",
            ),
            F4,
        )
        | {"nConstituents": np.dtype("u2"), "vertexIdx": I4},
        "JetConstituents": {"jetIdx": I4, "candIdx": I4},
        "PuppiMET": met,
        "PFMET": met,
        "PFCandidates": pf,
        "Vertices": {**XYZE, "sumPt2": F4, "nTracks": np.dtype("u2")},
        "PFClustersECAL": dict.fromkeys(("x", "y", "z", "energy", "eta", "phi", "time"), F4)
        | {"nHits": np.dtype("u2")},
        "PFCandidateClustersECAL": {"candIdx": I4, "clusterIdx": I4},
    }
    conv = converter(types, p)
    d = {x["table"]: x for x in conv.display}
    assert (d["Jets"]["repr"], d["Jets"]["domain"], d["Jets"]["cut"]["default"], d["Jets"]["labels"]) == (
        "cones",
        "Physics",
        30,
        4,
    )
    assert d["PuppiMET"]["visible"] and not d["PFMET"]["visible"] and "PFMET" in conv.header([], "cms")["tables"]
    assert not d["PFCandidates"]["visible"] and d["PFCandidates"]["filter"] == "puppiWeight > 0"
    assert d["Vertices"]["domain"] == "Physics" and d["PFClustersECAL"]["domain"] == "Calo"
    assert d["Jets"]["truthGap"]["gap"] == 21 and d["PFCandidates"]["truthGap"]["gap"] == 20
    assert (
        "truthGap" not in d["PFClustersECAL"] and d["PFClustersECAL"]["cut"]["default"] == 1.0
    )  # its truth comes from CMSSW
    header = conv.header([], "t")
    assert "jetVertex" not in header["relations"] and header["relations"]["jetConstituents"]["to"] == "PFCandidates"
    assert [x["name"] for x in header["domains"]] == ["Physics", "Calo"]
    one = lambda **c: {k: [v] for k, v in c.items()}
    _, tables, rels = one_event(
        conv,
        {
            "Jets": {**{k: [1, 2] for k in types["Jets"]}, "vertexIdx": [0, 0]},
            "JetConstituents": {"jetIdx": [0, 1, 1], "candIdx": [0, 1, 0]},
            "PuppiMET": one(**{k: 1 for k in met} | {"vertexIdx": 0}),
            "PFMET": one(**{k: 1 for k in met} | {"vertexIdx": 0}),
            "PFCandidates": {k: [1, 1] for k in pf},
            "Vertices": {"x": [0.1], "y": [0.2], "z": [3], "e": [0], "sumPt2": [9], "nTracks": [2]},
            "PFClustersECAL": {k: [1] for k in types["PFClustersECAL"]},
            "PFCandidateClustersECAL": {"candIdx": [1], "clusterIdx": [0]},
        },
    )
    assert tables["Jets"][1]["z"].tolist() == [3, 3] and tables["PuppiMET"][1]["x"].tolist() == [np.float32(0.1)]
    assert rels["jetConstituents"]["offsets"].tolist() == [0, 1, 3] and rels["pfClustersECAL"]["indices"].tolist() == [
        0
    ]
    assert "jetVertex" not in rels and "JetConstituents" not in tables
    rel = {r["name"]: r for r in p["relations"]}
    assert rel["vertexTruth"]["match"] == {
        "measure": "pt2",
        "in": "tracker",
        "target": "interaction",
        "purity": "fraction",
        "good": 0.5,
    }
    assert rel["secondaryVertexTruth"]["match"]["target"] == "decayVertex" and "truthGap" not in p["kinds"]["vertex"]
    assert {
        k: v["truthGap"]["gap"]
        for k, v in p["kinds"].items()
        if "truthGap" in v and k in ("electron", "photon", "tau", "met")
    } == {"electron": 23, "photon": 23, "tau": 24, "met": 22}


def test_muon_layers_in_cms():
    """cms includes muon.json: muons as a Physics kind (helix to their inner track's outermost state, gathered), their
    standalone and global tracks as paths through their ordered hits, segments as centred lines, hits and the chambers
    in use as boxes in the Muons domain, GE0 filtered out by default; muon-hit truth is a fact."""
    p = load_profile("cms")
    f4 = lambda *c: dict.fromkeys(c, F4)
    u1, i2 = np.dtype("u1"), np.dtype("i2")
    types = {
        "Muons": f4("pt", "eta", "phi", "px", "py", "pz", "vx", "vy", "vz", "relIso", "time")
        | {
            k: u1
            for k in (
                "isGlobal",
                "isTracker",
                "isStandAlone",
                "isPF",
                "isLoose",
                "isMedium",
                "isTight",
                "nMatchedStations",
            )
        }
        | {"charge": i2, "nValidMuonHits": i2, "trackIdx": I4, "ecalDetId": U4, "hcalDetId": U4},
        "Tracks": f4("outerX", "outerY", "outerZ", "vx", "vy", "vz", "px", "py", "pz", "pt", "eta")
        | {"charge": i2, "highPurity": u1, "vertexIdx": I4},
        "MuonTracks": f4("x", "y", "z", "pt", "eta", "phi", "chi2", "ndof")
        | {"muonIdx": I4, "kind": u1, "nMuonHits": i2},
        "MuonTrackHits": f4("x", "y", "z") | {"trackIdx": I4, "subdet": u1, "station": i2},
        "MuonSegments": f4("x", "y", "z", "dx", "dy", "dz", "halfLength", "chi2", "time")
        | {"subdet": u1, "station": i2, "nHits": u1, "ndof": u1, "chamberIdx": I4},
        "MuonHits": f4("x", "y", "z", "time")
        | {"subdet": u1, "station": i2, "chamberIdx": I4, "bx": i2, "clusterSize": u1},
        "MuonChambers": f4(
            "x",
            "y",
            "z",
            "ux",
            "uy",
            "uz",
            "vx",
            "vy",
            "vz",
            "halfWidthBottom",
            "halfWidthTop",
            "halfLength",
            "halfThickness",
        )
        | {"subdet": u1, "station": i2, "wheelOrRing": i2, "sector": u1},
        "MuonSegmentMatches": {"muonIdx": I4, "segmentIdx": I4},
    }
    conv = converter(types, p)
    d = {x["table"]: x for x in conv.display}
    assert (d["Muons"]["domain"], d["Muons"]["repr"], d["MuonTracks"]["repr"], d["MuonTracks"]["points"]) == (
        "Physics",
        "helix",
        "polyline",
        {"relation": "muonTrackHits"},
    )
    assert (
        d["MuonChambers"]["cell"]["shape"] == "box"
        and not d["MuonChambers"].get("context")
        and d["MuonHits"]["filter"] == "subdet != 4 || station != 0"
        and d["MuonHits"]["onSelection"]
        and d["MuonChambers"]["onSelection"]
    )
    assert (
        d["MuonSegments"]["centred"]
        and d["Muons"]["truthGap"]["gap"] == 18
        and d["MuonSegments"]["truthGap"]["gap"] == 17
    )
    assert {r["name"]: r for r in p["relations"]}["truthHitsMuon"]["fact"]["unit"]["names"]["2"] == "CSC layer"
    assert d["MuonTrackHits"]["truthGap"]["gap"] == 18 and "reason" in d["MuonChambers"]["truthGap"]
    assert p["kinds"]["truthVertex"]["describe"]["columns"] == ["reason", "isSignal", "z"]
    _, tables, rels = one_event(
        conv,
        {
            "Muons": {**{k: [1] for k in types["Muons"]}, "trackIdx": [0]},
            "Tracks": {**{k: [1] for k in types["Tracks"]}, "outerX": [5], "outerY": [6], "outerZ": [7]},
            "MuonTracks": {**{k: [1, 1] for k in types["MuonTracks"]}, "muonIdx": [0, 0]},
            "MuonTrackHits": {**{k: [1, 1, 1] for k in types["MuonTrackHits"]}, "trackIdx": [0, 1, 1]},
            "MuonSegments": {**{k: [1] for k in types["MuonSegments"]}, "chamberIdx": [0]},
            "MuonHits": {**{k: [1] for k in types["MuonHits"]}, "chamberIdx": [0]},
            "MuonChambers": {k: [1] for k in types["MuonChambers"]},
            "MuonSegmentMatches": {"muonIdx": [0], "segmentIdx": [0]},
        },
    )
    assert tables["Muons"][1]["endX"].tolist() == [5] and rels["muonTrackHits"]["offsets"].tolist() == [0, 1, 3]
    assert rels["muonSegments"]["indices"].tolist() == [0] and rels["chamberHits"]["indices"].tolist() == [0]


def test_hgcal_profile_alone_keeps_its_bundles():
    """hgcal.json (main's HGCal-only bundles) gained only truth hints (`fact` on its truth -> hit relations, the layer
    clusters' derived truthGap, the candidates' truthGap for a release without their associator) and the candidates' own
    tracksters of a stock release. No domain, outline or view reaches an hgcal bundle."""
    p = load_profile("hgcal")
    assert not {"domains", "outlines", "field"} & set(p) and "domain" not in p["view"] and len(p["display"]) == 17
    assert sorted(p["kinds"]) == [
        "candidate",
        "candidateTrackster",
        "interpretation",
        "layerCluster",
        "linkedTrackster",
        "rechit",
        "track",
        "trackster",
        "truthParticle",
        "truthVertex",
    ]
    assert {r["name"] for r in p["relations"] if "fact" in r} == {
        "truthHitsHGCal",
        "truthHitsSoAEE",
        "truthHitsSoAHSi",
        "truthHitsSoAHSci",
    }
    assert sorted(k for k, v in p["kinds"].items() if "truthGap" in v) == ["candidate", "layerCluster"]
    header = converter({"HGCalHits": {**XYZE, "energy": F4, "halfWidth": F4, "time": F4}}, p).header([], "t")
    assert not {"domains", "outlines"} & set(header) and [d["table"] for d in header["display"]] == ["HGCalHits"]


@pytest.mark.parametrize("name", ["phase2", "run3", "cms", "hgcal"])
def test_profiles_list_their_kinds_from_the_top_down(name):
    """The profiles that put the parts together state the whole order of their kinds (`order`, top down: the side
    panel's order), so it is not the accident of which include names a kind first; only truth is left to `kinds`.
    Each TICL stage comes before the stages it is made from, and the stages say what they are (`doc`)."""
    p = load_profile(name)
    order = p["order"]
    assert len(order) == len(set(order)) and set(order) <= set(p["kinds"])
    assert set(p["kinds"]) - set(order) <= {"truthParticle", "truthVertex"}
    stages = [k for k in p.get("stages", []) if k in order]
    assert sorted(stages, key=order.index) == stages[::-1]
    assert all(p["kinds"][k].get("doc") for k in ("trackster", "linkedTrackster", "candidateTrackster") if k in order)
    if "jet" in order:
        assert order.index("jet") < order.index("pfCandidate") < order.index("caloHit")
        assert order.index("track") < order.index("trackHit")


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
    types = {
        "Tracks": dict.fromkeys(("vx", "vy", "vz", "px", "py", "pz", "outerX", "outerY", "outerZ", "pt", "eta"), F4)
        | {"charge": np.dtype("i2"), "highPurity": np.dtype("u1"), "vertexIdx": I4},
        "TrackHits": {**XYZE, "trackIdx": I4, "subdet": np.dtype("u1")},
        "Vertices": {**XYZE, "sumPt2": F4, "nTracks": np.dtype("u2")},
        "VertexTracks": {"vertexIdx": I4, "trackIdx": I4, "weight": F4},
        "TICLCandidates": {"trackIdx": I4, "time": F4, "energy": F4},
        "HGCalHits": XYZE,
        "MTDHits": {
            **XYZE,
            "time": F4,
            "timeError": F4,
            "energy": F4,
            "subdet": np.dtype("u1"),
            "row": np.dtype("i2"),
            "col": np.dtype("i2"),
        },
        **{
            t: XYZE
            for t in (
                "EcalHits",
                "PFCandidates",
                "Jets",
                "Muons",
                "MuonHits",
                "SecondaryVertices",
                "Electrons",
                "GsfTracks",
                "PFClustersECAL",
                "EGammaSuperClusters",
                "Taus",
                "TruthMuonHits",
                "particleFlowClusterECALToTruth",
            )
        },
    }
    conv = converter(types, load_profile("tracker_only"))
    assert set(conv.written()) == {
        "Tracks",
        "TrackHits",
        "Vertices",
        "MTDHits",
    }  # every other detector and object left out
    header = conv.header([], "t")
    assert [d["name"] for d in header["domains"]] == ["Tracker"] and header["field"]["bz"] == 3.8
    assert header["relations"]["trackVertex"]["inverseOf"] == "vertexTracks"
    assert (
        header["view"]["start"] == "front" and {d["table"]: d["repr"] for d in header["display"]}["Tracks"] == "helix"
    )


STOCK = {
    t: {c: np.dtype(d) for c, d in cols.items()}  # the tables of the earlier export on an unmodified release
    for t, cols in json.loads(Path(__file__).with_name("stock_tables.json").read_text()).items()
}


def test_cms_profile_reads_a_stock_release_export():
    """The tables of a stock CMSSW release (CMSSW_20_1_X_2026-11-12-2300, tests/stock_tables.json) under the cms
    profile: every table is drawn, feeds a relation or is left out on purpose; the CLUE3D tracksters and the candidates'
    own tracksters (table ticlCandidate) are matched to truth, and the candidates take their position and their layer
    clusters from their own trackster."""
    conv = converter(STOCK, load_profile("cms"))
    header = conv.header([], "t")
    drawn, rels = {d["table"] for d in header["display"]}, header["relations"]
    # written without a layer: only the muons' track information, which muon.json reads through a relation
    assert set(conv.written()) - drawn == {"TrackMuonInfo"}
    assert not [
        t for t in conv.written() if t.endswith(("ToTruth", "FromTruth", "vertices")) or t == "linkedTracksters"
    ]
    for reco, truth, table in (
        ("clue3dTruth", "truthClue3d", "ticlTrackstersCLUE3DHigh"),
        ("ownTracksterTruth", "truthOwnTracksters", "ticlCandidate"),
        ("linksTruth", "truthLinked", "ticlTracksterLinks"),
    ):
        assert (
            (rels[reco]["from"], rels[reco]["to"])
            == (table, "TruthParticles")
            == (rels[truth]["to"], rels[truth]["from"])
        )
        assert rels[reco]["match"]["shared"] == "sharedEnergy" and "completeness" in rels[truth]["match"]
    # ticlCandidateToTruth is the candidates' tracksters' here, so it is not read as the candidates' own
    assert not {"candidateTruth", "truthCandidates", "candidateTrackster", "candidateLCs"} & set(rels)
    assert (rels["candidateOwnTrackster"]["to"], rels["candidateOwnLCs"]["to"]) == (
        "ticlCandidate",
        "HGCalLayerClusters",
    )
    assert rels["candidateLinkedTracksters"]["to"] == "ticlTracksterLinks"
    kinds = {d["table"]: d for d in header["display"]}
    assert "truthGap" in kinds["TICLCandidates"] and kinds["ticlCandidate"]["kind"] == "candidateTrackster"
    assert "linkedTracksters" not in converter(STOCK, load_profile("tracker_only")).written()


def test_a_relation_steps_aside_for_a_table():
    """`unless`: a relation is not built when one of those tables is in the file (two exports that give one table name
    to different associations)."""
    tables = {"A": {"x": F4}, "B": {"x": F4}, "L": {"a": np.dtype("i4"), "b": np.dtype("i4")}}
    rel = {
        "name": "ab",
        "kind": "links",
        "from": "A",
        "to": "B",
        "table": "L",
        "fromIndex": "L.a",
        "toIndex": "L.b",
        "unless": ["C"],
    }
    profile = {"name": "t", "relations": [rel], "display": []}
    assert "ab" in converter(tables, profile).relations
    assert "ab" not in converter({**tables, "C": {"x": F4}}, profile).relations


def test_clue3d_tracksters_are_matched_to_truth():
    """A stock release makes CLUE3D tracksters, not CLUEstering ones: both are matched to truth the same way, in both
    directions."""
    rels = {r["name"]: r for r in load_profile("hgcal")["relations"]}
    for reco, truth, table in (
        ("clusteringTruth", "truthClusterings", "ticlTrackstersCLUEstering"),
        ("clue3dTruth", "truthClue3d", "ticlTrackstersCLUE3DHigh"),
    ):
        assert (
            rels[reco]["from"] == rels[truth]["to"] == table
            and rels[reco]["to"] == rels[truth]["from"] == "TruthParticles"
        )
        assert rels[reco]["table"] == f"{table}ToTruth" and rels[truth]["table"] == f"{table}FromTruth"
        assert rels[truth]["match"] == rels["truthClusterings"]["match"]
        assert {**rels[reco]["match"], "over": None} == {**rels["clusteringTruth"]["match"], "over": None}
    assert rels["clue3dTruth"]["match"]["over"] == ["raw_energy"]  # no SoA twin with a rawEnergy column
    assert {"ticlTrackstersCLUE3DHighToTruth", "ticlTrackstersCLUE3DHighFromTruth"} <= set(
        load_profile("hgcal")["internal"]
    )


@pytest.mark.parametrize("name", sorted(p.name[:-5] for p in BUILTIN.iterdir() if p.name.endswith(".json")))
def test_every_builtin_profile_loads(name):
    """Each has the shape load_profile checks (profile.py check_shape)."""
    assert load_profile(name)


def test_track_hits_are_named_after_the_trackers_parts_of_their_era():
    """Phase 2 has an Inner and an Outer Tracker (whose DetIds reuse the subdetector numbers of TOB and TID); Run 3 has
    the TIB, TID, TOB and TEC."""
    phase2, run3 = (load_profile(p)["kinds"]["trackHit"] for p in ("phase2", "run3"))
    assert dict(phase2["colourBy"]["names"]) == {
        "1": "Inner Tracker barrel", "2": "Inner Tracker endcap", "5": "Outer Tracker barrel",
        "4": "Outer Tracker endcap (TEDD)",
    }  # fmt: skip
    assert phase2["colourBy"]["category"] == "subdet" and phase2["describe"]["names"]["subdet"]["5"] == "OT barrel"
    assert dict(run3["colourBy"]["names"])["5"] == "TOB" and run3["describe"]["names"]["subdet"]["3"] == "TIB"
