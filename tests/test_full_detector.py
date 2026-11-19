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
        {"name": "Primary vertex", "filters": {"PV": "index == 0"}},
        {"name": "All vertices", "filters": {"PV": ""}},
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
