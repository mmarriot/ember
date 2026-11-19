"""The converter on NanoAOD made of the release's own tables (ember's cmsRun configuration, standard NanoAOD): DetId
bits, tables split by subdetector, cell sizes, cluster -> hit relations by DetId, singleton tables, tables left out
when no profile uses them, objects placed at the leading vertex, and the automatic choice of the profile."""

import io

import numpy as np
import pytest
from nanoaod import chunk, converter

from embertools import Problem
from embertools.bundle import Bundle
from embertools.nano import convert, discover

ak = pytest.importorskip("awkward")
uproot = pytest.importorskip("uproot")

F4, U4, U2 = np.dtype("f4"), np.dtype("u4"), np.dtype("u2")
EB = 0x32000000 | 1  # ECAL barrel (det 3, subdet 1)
HB = 0x42000000 | (1 << 24) | (1 << 20) | (3 << 10) | 7  # HB ieta 3, depth 1
HF = 0x48000000 | (1 << 24) | (1 << 20) | (30 << 10) | 3  # HF ieta 30, depth 1
SPLIT = [
    {"table": "pfrechits", "bits": {"det": ["rechit_ID", 28, 4], "subdet": ["rechit_ID", 25, 3]}},
    {"table": "pfrechits", "split": {"EBHits": [["det", "==", 3], ["subdet", "==", 1]],
                                     "HBHits": [["det", "==", 4], ["subdet", "==", 1]]}},
    {"table": "HBHits", "cell": "hcal", "detId": "rechit_ID", "position": ["rechit_x", "rechit_y", "rechit_z"]},
]  # fmt: skip
HITS = {"rechit_ID": U4, "rechit_energy": F4, "rechit_x": F4, "rechit_y": F4, "rechit_z": F4}


def hits(*ids):
    n = len(ids)
    return {"rechit_ID": np.array(ids, np.uint32), "rechit_energy": np.arange(1, n + 1, dtype=np.float32),
            "rechit_x": np.full(n, 180, np.float32), "rechit_y": np.zeros(n, np.float32), "rechit_z": np.zeros(n, np.float32)}  # fmt: skip


def test_a_hit_table_is_split_by_the_bits_of_its_detid_and_its_cells_sized():
    profile = {
        "derive": SPLIT,
        "omit": ["pfrechits.rechit_energy"],
        "display": [{"table": t, "label": t, "position": ["rechit_x"] * 3} for t in ("EBHits", "HBHits")],
    }
    conv = converter({"pfrechits": HITS}, profile)
    assert set(conv.written()) == {"EBHits", "HBHits"}  # the source table is read, not written
    assert "rechit_x" not in conv.branches() and "pfrechits_rechit_x" in conv.branches()
    assert "pfrechits_rechit_energy" not in conv.branches()  # omitted: not read, and not written
    assert "nEBHits" not in conv.branches()  # made here, not read
    event = hits(EB, HB, HF, HB)
    del event["rechit_energy"]
    _, tables, _ = conv.event(chunk(conv, {"pfrechits": event}), 0)
    assert tables["EBHits"][0] == 1 and tables["HBHits"][0] == 2 and "rechit_energy" not in tables["HBHits"][1]
    assert np.allclose(tables["HBHits"][1]["dEta"], 0.087) and np.allclose(tables["HBHits"][1]["depth"], 0.9)
    assert list(tables["HBHits"][1]["subdet"]) == [1, 1]
    header = conv.header(["f.root"], "p")
    assert set(header["tables"]["HBHits"]["columns"]) >= {"rechit_ID", "det", "subdet", "dEta", "dPhi", "depth"}
    assert "det == 4 and subdet == 1" in header["tables"]["HBHits"]["doc"]


def test_the_hits_of_a_cluster_are_found_by_detid_in_each_hit_table():
    profile = {
        "derive": SPLIT,
        "internal": ["PFClusterHits"],
        "relations": [
            {"name": f"clusterHits{t}", "kind": "counts", "from": "PFCluster", "to": f"{t}Hits", "counts": "PFCluster.nPFClusterHits",
             "indices": "PFClusterHits.detId", "toKey": f"{t}Hits.rechit_ID", "weights": ["PFClusterHits.fraction"]}
            for t in ("EB", "HB")
        ],
        "display": [{"table": "PFCluster", "label": "C", "position": ["x", "x", "x"]}],
    }  # fmt: skip
    conv = converter(
        {
            "pfrechits": HITS,
            "PFCluster": {"x": F4, "nPFClusterHits": U2},
            "PFClusterHits": {"detId": U4, "fraction": F4},
        },
        profile,
    )
    event = {
        "pfrechits": hits(HB, EB, HB + 1),
        # cluster 0: the EB hit, an HB hit, a hit not written (HF) and the HB hit again (a supercluster lists a hit
        # once per basic cluster that has it); cluster 1: the other HB hit
        "PFCluster": {"x": [0.0, 1.0], "nPFClusterHits": [4, 1]},
        "PFClusterHits": {"detId": [EB, HB, HF, HB, HB + 1], "fraction": [1.0, 0.25, 1.0, 0.5, 1.0]},
    }
    _, _, rel = conv.event(chunk(conv, event), 0)
    eb, hb = rel["clusterHitsEB"], rel["clusterHitsHB"]
    assert list(eb["offsets"]) == [0, 1, 1] and list(eb["indices"]) == [0] and list(eb["weights"]["fraction"]) == [1.0]
    assert list(hb["offsets"]) == [0, 1, 2] and list(hb["indices"]) == [0, 1]  # rows of HBHits
    assert list(hb["weights"]["fraction"]) == [0.75, 1.0]  # the repeated hit once, its fractions summed


def write(path, collections, singletons):
    """A NanoAOD file of one event per entry: collection tables {table: {column: [per event]}} and singleton
    tables {table: {column: [per event]}} (branches <T>_<column>, no counter)."""
    data = {t: ak.zip({c: ak.Array(v) for c, v in cols.items()}) for t, cols in collections.items()}
    n = len(next(iter(next(iter(collections.values())).values())))
    data |= {f"{t}_{c}": np.asarray(v, np.float32) for t, cols in singletons.items() for c, v in cols.items()}
    data |= {
        "run": np.ones(n, np.uint32),
        "luminosityBlock": np.ones(n, np.uint32),
        "event": np.arange(n, dtype=np.uint64),
    }
    # mktree: a TTree, as CMSSW writes; recent uproot (5.7.7 in CI) writes f[name] = {...} as an RNTuple
    with uproot.recreate(str(path)) as f:
        f.mktree(
            "Events",
            {k: v.type if hasattr(v, "layout") else v.dtype for k, v in data.items()},
            field_name=lambda outer, inner: f"{outer}_{inner}",
            counter_name=lambda counted: f"n{counted}",
        )
        f["Events"].extend(data)
    return str(path)


def standard_nanoaod(path):
    """A small standard NanoAOD: jets, the leading vertex and MET as singletons, and tables nothing draws."""
    return write(
        path,
        {
            "Jet": {
                "pt": [[50.0, 30.0]],
                "eta": [[0.5, -1.0]],
                "phi": [[0.1, 2.0]],
                "mass": [[5.0, 4.0]],
                "nConstituents": [[10, 8]],
                "chHEF": [[0.5, 0.4]],
                "neHEF": [[0.1, 0.2]],
                "chEmEF": [[0.1, 0.1]],
                "neEmEF": [[0.2, 0.2]],
                "muEF": [[0.0, 0.0]],
            },
            "FatJet": {"pt": [[300.0]]},
        },
        {
            "PV": {"x": [0.01], "y": [0.02], "z": [3.0], "ndof": [100.0], "chi2": [1.0]},
            "PuppiMET": {"pt": [40.0], "phi": [1.0], "sumEt": [500.0]},
            "HLT": {"IsoMu24": [1.0]},
        },
    )


def test_singleton_tables_are_found_and_read_as_one_row(tmp_path):
    path = standard_nanoaod(tmp_path / "nano.root")
    tables = discover(uproot.open(path)["Events"])
    assert tables["PV"]["singleton"] and set(tables["PV"]["columns"]) == {"x", "y", "z", "ndof", "chi2"}
    assert "singleton" not in tables["Jet"] and tables["HLT"]["singleton"]


def test_a_standard_nanoaod_is_drawn_by_the_nano_profile_with_only_what_it_uses(tmp_path):
    path, out, log = standard_nanoaod(tmp_path / "nano.root"), str(tmp_path / "nano.ember"), io.StringIO()
    assert convert([path], out, "auto", log=log) == 1
    assert "profile nano (chosen" in log.getvalue()
    b = Bundle(out)
    assert set(b.header["tables"]) == {"Jet", "PV", "PuppiMET"}  # not FatJet or HLT (keepUnused: false)
    tables = b.event(0)["tables"]
    assert tables["PV"][0] == 1 and np.allclose(tables["Jet"][1]["z"], 3.0)  # jets start at the leading vertex
    met = tables["PuppiMET"][1]
    assert np.allclose(met["px"], 40 * np.cos(1.0)) and np.allclose(met["pz"], 0)


def test_the_profile_is_chosen_by_what_it_draws_or_the_file_refused(tmp_path):
    # an ember NanoAOD of a Run 3 file: PF rechits (split by the run3 profile), which no other profile draws
    path = write(
        tmp_path / "run3.root",
        {"pfrechits": {"rechit_ID": [[EB, HB]], "rechit_energy": [[1.0, 2.0]], "rechit_time": [[0.0, 0.0]],
                       "rechit_x": [[129.0, 180.0]], "rechit_y": [[0.0, 0.0]], "rechit_z": [[0.0, 10.0]],
                       "rechit_eta": [[0.0, 0.05]], "rechit_phi": [[0.0, 0.0]], "rechit_depth": [[1, 1]]}},
        {},
    )  # fmt: skip
    log = io.StringIO()
    convert([path], str(tmp_path / "r3.ember"), "auto", log=log)
    assert "profile run3 (chosen" in log.getvalue()
    assert {"EBHits", "HBHits"} <= set(Bundle(str(tmp_path / "r3.ember")).header["tables"])
    other = write(tmp_path / "other.root", {"Thing": {"a": [[1.0]]}}, {})
    with pytest.raises(Problem, match="none of the profiles phase2, run3, nano, hgcal, cms draws its tables"):
        convert([other], str(tmp_path / "x.ember"), "auto", log=io.StringIO())


def test_truth_hits_are_found_by_detid_in_the_split_tables_and_momenta_derived():
    profile = {
        "derive": [
            *SPLIT,
            {"table": "TruthPFRecHits", "lookup": "pfrechits", "index": "hitIdx", "columns": {"detId": "rechit_ID"}},
            {"table": "Truth", "momentum": ["pt", "eta", "phi"]},
        ],
        "internal": ["TruthPFRecHits"],
        "relations": [
            {"name": f"truthHits{t}", "kind": "links", "from": "Truth", "to": f"{t}Hits", "table": "TruthPFRecHits",
             "fromIndex": "TruthPFRecHits.particleIdx", "toIndex": "TruthPFRecHits.detId", "toKey": f"{t}Hits.rechit_ID",
             "weights": ["TruthPFRecHits.simEnergy"]}
            for t in ("EB", "HB")
        ],
        "display": [{"table": "Truth", "label": "T", "position": ["px", "py", "pz"]}],
    }  # fmt: skip
    I4 = np.dtype("i4")
    conv = converter(
        {"pfrechits": HITS, "Truth": {"pt": F4, "eta": F4, "phi": F4},
         "TruthPFRecHits": {"particleIdx": I4, "hitIdx": I4, "simEnergy": F4}},
        profile,
    )  # fmt: skip
    event = {
        "pfrechits": hits(HB, EB, HF),
        "Truth": {"pt": [10.0, 0.0], "eta": [0.0, -(22756 + 5.0)], "phi": [0.0, 0.0]},  # the 2nd: pt 0, pz -5 (ROOT)
        "TruthPFRecHits": {"particleIdx": [1, 0, 1], "hitIdx": [0, 1, 2], "simEnergy": [0.5, 0.25, 1.0]},
    }
    _, tables, rel = conv.event(chunk(conv, event), 0)
    eb, hb = rel["truthHitsEB"], rel["truthHitsHB"]
    assert list(eb["offsets"]) == [0, 1, 1] and list(eb["weights"]["simEnergy"]) == [0.25]  # the EB hit, row 0
    assert list(hb["offsets"]) == [0, 0, 1] and list(hb["indices"]) == [0]  # the HB hit; the HF one is in neither
    assert np.allclose(tables["Truth"][1]["pz"], [0.0, -5.0]) and np.allclose(tables["Truth"][1]["px"], [10.0, 0.0])
