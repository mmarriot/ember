"""The whole detector in ember's own NanoAOD: the tables that embertools/cmsrun.py writes (tests/own_tables.json,
from the stock Phase-2 ttbar step3) under the phase2 profile: the PF candidates, the colour root, with the rows of
what they were made from; physics objects linked to their tracks, superclusters and PF candidates; every vertex; the
muon system; the presets that need them."""

import json
from pathlib import Path

import numpy as np
from nanoaod import converter

from embertools.profile import load_profile

OWN = json.loads(Path(__file__).with_name("own_tables.json").read_text())


def tables(name):
    return {t: {c: np.dtype(d) for c, d in cols.items()} for t, cols in OWN[name].items()}


def test_the_release_tables_are_drawn_and_linked_under_the_phase2_profile():
    conv = converter(tables("release"), load_profile("phase2"))
    header = conv.header([], "t")
    drawn, rels = {d["table"] for d in header["display"]}, header["relations"]
    # every table is drawn but the HGCal tables that feed relations
    assert set(conv.written()) - drawn == set()
    for name, ends in {
        "pfTrack": ("PFCandidates", "GeneralTrack"), "pfGsfTrack": ("PFCandidates", "GsfTrack"),
        "pfMuon": ("PFCandidates", "Muon"), "pfElectron": ("PFCandidates", "Electron"),
        "pfPhoton": ("PFCandidates", "Photon"), "electronGsfTrack": ("Electron", "GsfTrack"),
        "electronSuperClusterEB": ("Electron", "SuperClusterEB"), "photonSuperClusterEB": ("Photon", "SuperClusterEB"),
        "electronHGCSuperCluster": ("ElectronHGC", "SuperClusterHGCal"), "muonTrack": ("Muon", "GeneralTrack"),
        "tauLeadCand": ("Tau", "PFCandidates"),
    }.items():  # fmt: skip
        assert (rels[name]["from"], rels[name]["to"]) == ends
    assert "electronSuperClusterEE" not in rels  # no ECAL endcap in Phase 2
    layers = {d["table"]: d for d in header["display"]}
    assert layers["PFCandidates"]["kind"] == "pfCandidate" and header["view"]["colourRoot"] == "pfCandidate"
    assert layers["PFCandidates"]["filter"] == "puppiWeight > 0" and layers["JetCHS"]["visible"] is False
    assert layers["PV"]["filter"] == "index == 0" and layers["GEMRecHit"]["filter"] == "station != 0"
    assert {layers[t]["domain"] for t in ("DTSegment", "CSCSegment", "GEMSegment", "GEMRecHit", "RPCRecHit")} == {
        "Muons"
    }
    assert [d["name"] for d in header["domains"]] == ["Physics", "Tracker", "Calo", "HGCal", "Muons"]
    # the presets, with only what the bundle has: no vertex <-> track links yet, no MTD hits
    assert header["presets"] == [
        {"name": "Primary vertex", "filters": {"PV": "index == 0", "GeneralTrack": "highPurity == 1 && vertex < 1"}},
        {"name": "All vertices", "filters": {"PV": "", "GeneralTrack": "highPurity == 1"}},
        {"name": "What PUPPI removed", "filters": {"PFCandidates": "puppiWeight == 0"}},
        {"name": "Track time", "colour": {"GeneralTrack": "t0", "PV": "t"}},
    ]


def test_with_pat_physics_objects_the_links_to_them_are_left_out():
    # --pat: PAT's physics objects (no index columns into the RECO collections) next to ember's other tables
    own = tables("release")
    for t, cols in own.items():
        if t in ("Electron", "ElectronHGC", "Photon", "PhotonHGC", "Muon", "Tau") or t == "PFCandidates":
            for c in [c for c in cols if c.endswith("Idx") and c not in ("trackIdx", "gsfTrackIdx")]:
                del cols[c]
            if t != "PFCandidates":
                cols.pop("trackIdx", None), cols.pop("gsfTrackIdx", None)
    rels = converter(own, load_profile("phase2")).header([], "t")["relations"]
    assert {"pfTrack", "pfGsfTrack"} <= set(rels)
    assert not {"pfMuon", "pfElectron", "electronGsfTrack", "electronSuperClusterEB", "muonTrack", "tauLeadCand"} & set(
        rels
    )


# The tables of the CMSSW branches (docs/cmssw.md), added to the release's: synthetic until the combined area exists
I4, U2, U4, F4, I2 = (np.dtype(d) for d in ("i4", "u2", "u4", "f4", "i2"))
HITS = {"detId": U4, "energy": F4, "time": F4, "x": F4, "y": F4, "z": F4}
BRANCHES = {
    **{f"{k}RecHits": HITS for k in ("EB", "HBHE", "HF", "HO", "BTL", "ETL")},
    **{f"{t}Hits": {"detId": U4, "x": F4, "y": F4, "z": F4, "layer": np.dtype("u1")}
       for t in ("GeneralTrack", "GsfTrack", "StandaloneMuonTrack", "GlobalMuonTrack")},
    **{t: {"pt": F4, "eta": F4, "phi": F4, "charge": I2, "vx": F4, "vy": F4, "vz": F4, "chi2": F4, f"n{t}Hits": U2}
       for t in ("StandaloneMuonTrack", "GlobalMuonTrack")},
    **{f"{v}Tracks": {"vertexIdx": I4, "trackIdx": I4, "weight": F4} for v in ("PV", "SV")},
    **{f"PFCandidateClusters{d}": {"pfCandIdx": I4, "clusterIdx": I4} for d in ("ECAL", "HCAL", "HF", "HO")},
    "JetPFCands": {"jetIdx": I4, "pfCandIdx": I4}, "JetCHSPFCands": {"jetIdx": I4, "pfCandIdx": I4},
    "TauPFCands": {"tauIdx": I4, "pfCandIdx": I4},
    "DTRecHit": {"x": F4, "y": F4, "z": F4, "wheel": I2, "station": I2, "sector": I2, "superlayer": I2, "layer": I2,
                 "detId": U4},
    "CSCRecHit": {"x": F4, "y": F4, "z": F4, "time": F4, "endcap": I2, "station": I2, "ring": I2, "chamber": I2,
                  "layer": I2, "detId": U4},
    "MuonChamber": {"detId": U4, **{c: F4 for c in ("x", "y", "z", "ux", "uy", "uz", "vx", "vy", "vz",
                    "halfWidthBottom", "halfWidthTop", "halfLength", "halfThickness")}},
    **{f"Muon{k}Segments": {"muonIdx": I4, "segmentIdx": I4, "mask": U4} for k in ("DT", "CSC", "GEM")},
}  # fmt: skip
COLUMNS = {  # columns the branches add to the release's tables
    "GeneralTrack": {"nGeneralTrackHits": U2}, "GsfTrack": {"nGsfTrackHits": U2},
    "PFCandidates": {"ticlCandidateIdx": I4}, "Muon": {"standaloneTrackIdx": I4, "globalTrackIdx": I4},
    "JetCHS": {"btagDeepCSV": F4, "btagJP": F4},
}  # fmt: skip


def test_the_tables_of_every_cmssw_branch_are_drawn_and_linked():
    own = tables("release")
    for t in ("pfrechits", "TruthPFRecHits"):  # every rechit replaces the PF rechits
        own.pop(t, None)
    for t, cols in COLUMNS.items():
        own[t].update(cols)
    conv = converter({**own, **BRANCHES}, load_profile("phase2"))
    header = conv.header([], "t")
    drawn, rels = {d["table"] for d in header["display"]}, header["relations"]
    assert set(conv.written()) - drawn == set()
    assert {"EBRecHits", "HBRecHits", "HORecHits", "HFRecHits", "BTLRecHits", "GeneralTrackHits", "DTRecHit",
            "CSCRecHit", "MuonChamber", "StandaloneMuonTrack", "GlobalMuonTrackHits"} <= drawn  # fmt: skip
    for name in ("trackHits", "gsfTrackHits", "vertexTracks", "trackVertex", "svTracks", "pfTicl", "pfClustersECAL",
                 "pfClustersHF", "jetConstituents", "jetCHSConstituents", "tauConstituents", "muonStandaloneTrack",
                 "standaloneTrackHits", "muonDTSegments", "dtSegmentChamber"):  # fmt: skip
        assert name in rels, name
    # the PF candidates hold the TICL candidates: they are the colour root, the whole detector takes their colours
    assert (rels["pfTicl"]["from"], rels["pfTicl"]["to"]) == ("PFCandidates", "TICLCandidates")
    presets = {p["name"]: p for p in header["presets"]}
    assert presets["All vertices"]["colour"] == {"GeneralTrack": "rel:trackVertex"}
    assert presets["Track time"]["colour"] == {
        "GeneralTrack": "t0",
        "PV": "t",
        "BTLRecHits": "time",
        "ETLRecHits": "time",
    }
