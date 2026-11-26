"""Cell sizes from the DetId (cells.py) against the geometry: every cell of the Run 3 and D104 geometries, as CMSSW's
CaloGeometry and HGCal geometry give them (the geometry sweep of the cluster-hits pull request's validation).

geometry_sweep_sample.json holds a sample of the sweep (every HCAL |ieta| and depth, the two preshower planes, every
HGCal wafer type); with the sweep files themselves (EMBER_GEOMETRY_SWEEP: their folder), every cell is checked."""

import json
import os

import numpy as np
import pytest

from embertools import cells

HERE = os.path.dirname(os.path.abspath(__file__))
SWEEP = os.environ.get("EMBER_GEOMETRY_SWEEP", "")  # the folder of sweep_run3.root and sweep_phase2.root


def sample():
    with open(os.path.join(HERE, "geometry_sweep_sample.json")) as f:
        return {
            g: {n: {c: np.array(v) for c, v in cols.items()} for n, cols in d.items()} for g, d in json.load(f).items()
        }


def full():
    uproot = pytest.importorskip("uproot")
    out = {}
    for geometry in ("run3", "phase2"):
        path = os.path.join(SWEEP, f"sweep_{geometry}.root")
        if not SWEEP or not os.path.exists(path):
            pytest.skip("no geometry sweep (set EMBER_GEOMETRY_SWEEP to the folder of sweep_run3.root)")
        arrays = uproot.open(path)["Events"].arrays(library="np")
        out[geometry] = {}
        for key, values in arrays.items():
            if "_" in key:
                name, column = key.split("_", 1)
                out[geometry].setdefault(name, {})[column] = values[0]
    return out


def check(sweep):
    """Every rule against the sweep's cells: HCAL exact (to the 0.1 cm the table keeps; the depth is the sweep's
    thickness, front to back face centre along the line from the origin, projected onto the face's normal), HGCal to
    1e-3 relative, the ECAL endcap bins against the box around the crystal face (the sweep's dEta and dPhi, which the
    bin of the same area fits in: between 1 and sqrt(2) times smaller, a little more in eta), the preshower strips
    along the axis of the face's longer side."""
    for geometry, subdetectors in sweep.items():
        for name, c in subdetectors.items():
            position = (c["detId"], c["x"], c["y"], c["z"])
            if name in ("HB", "HE", "HF", "HO"):
                out = cells.compute("hcal", *position, geometry)
                assert np.allclose(out["dEta"], c["dEta"], atol=1e-4), name
                assert np.allclose(out["dPhi"], c["dPhi"], atol=1e-5), name
                r, R = np.hypot(c["x"], c["y"]), np.hypot(np.hypot(c["x"], c["y"]), c["z"])
                along = {"HB": r / R, "HO": r / R, "HE": np.abs(c["z"]) / R}.get(name, 1)
                assert np.allclose(out["depth"], c["thickness"] * along, atol=0.06), name
            elif name in ("CEE", "CEHSi", "CEHSc"):
                out = cells.compute("hgcal", *position)
                assert np.allclose(out["halfWidth"], c["halfWidth"], rtol=1e-3), name
            elif name == "EE":
                out = cells.compute("ecalEndcap", *position)
                for col in ("dEta", "dPhi"):
                    ratio = c[col] / out[col]
                    assert np.all((ratio > 0.99) & (ratio < 1.42 * (1.1 if col == "dEta" else 1))), (name, col)
            elif name == "ES":
                out = cells.compute("preshower", *position)
                r, phi = np.hypot(c["x"], c["y"]), np.arctan2(c["y"], c["x"])
                # the phi width of a 0.19 x 6.1 cm strip along v, seen from the beam
                width = (np.abs(out["vx"] * np.cos(phi) + out["vy"] * np.sin(phi)) * 0.19
                         + np.abs(out["vx"] * np.sin(phi) - out["vy"] * np.cos(phi)) * 6.1) / r  # fmt: skip
                assert np.allclose(width, c["dPhi"], rtol=0.01), name
            elif name == "EB":  # the constants of the profiles' towers
                assert np.allclose(c["dPhi"], 0.01745, rtol=0.05) and np.allclose(c["dEta"], 0.0174, rtol=0.13)


def test_the_cell_rules_agree_with_a_sample_of_the_geometry():
    check(sample())


def test_the_cell_rules_agree_with_every_cell_of_the_geometry():
    check(full())


def test_hcal_depths_in_a_tower_do_not_overlap():
    """Each depth ends before the next one's front face (radially in HB, along z in HE): the gap between them is the
    absorber, as in the geometry (5.7 to 8.1 cm in HB). Drawn along the line from the origin, they overlapped by up
    to 16 cm at |ieta| 15."""
    for geometry, subdetectors in sample().items():
        for name, front in (("HB", lambda c: np.hypot(c["x"], c["y"])), ("HE", lambda c: np.abs(c["z"]))):
            if name not in subdetectors:
                continue
            c = subdetectors[name]
            out = cells.compute("hcal", c["detId"], c["x"], c["y"], c["z"], geometry)
            det = c["detId"].astype(np.int64)
            tower = ((det >> 10) & 0x1FF) * np.sign(c["z"]) * 1000 + (det & 0x3FF)  # ieta (signed), iphi
            depth = (det >> 20) & 0xF
            start, end = front(c), front(c) + out["depth"]
            for t in np.unique(tower):
                i = np.flatnonzero(tower == t)
                i = i[np.argsort(depth[i])]
                gaps = start[i[1:]] - end[i[:-1]]
                assert np.all(gaps > -0.1), (geometry, name, t, gaps)


def test_an_hb_depth_is_equally_deep_at_every_ieta():
    """HB's depths are cylinder shells (geometry: 0.90, 18.46, 24.49, 43.98 cm radially), so a depth is as deep at
    |ieta| 15 as at 1, where the line from the origin crosses it at 1.9 times that length. |ieta| 16 is cut by HE."""
    for geometry, subdetectors in sample().items():
        c = subdetectors["HB"]
        det = c["detId"].astype(np.int64)
        depth = cells.compute("hcal", c["detId"], c["x"], c["y"], c["z"], geometry)["depth"]
        for d, radial in zip((1, 2, 3, 4), (0.90, 18.46, 24.49, 43.98)):
            rows = (((det >> 20) & 0xF) == d) & (((det >> 10) & 0x1FF) <= 15)
            assert rows.sum() == 15 and np.allclose(depth[rows], radial, atol=0.12), (geometry, d, depth[rows])


def test_cells_of_other_detectors_and_unknown_rules():
    hb = 0x42000000 | (1 << 24) | (2 << 20) | (5 << 10) | 7  # HB ieta 5, depth 2, iphi 7 (the 2017 layout)
    eb = 0x32000000
    out = cells.compute("hcal", [hb, eb], [180.0, 129.0], [0.0, 0.0], [20.0, 0.0])
    assert np.allclose(out["dEta"][:1], 0.087) and np.isnan(out["dEta"][1])  # not an HCAL cell
    assert np.allclose(cells.compute("hcal", [hb], [190.0], [0], [0], "phase2")["depth"], 19.9)
    with pytest.raises(ValueError, match="unknown cell rule"):
        cells.compute("muon", [1], [0], [0], [0])


def test_fine_scintillator_tiles_are_432_around_the_ring():
    coarse = (10 << 28) | (1 << 26)  # HGCal scintillator, granularity bit 24 unset
    out = cells.compute("hgcal", [coarse, coarse | (1 << 24)], [200.0, 200.0], [0.0, 0.0], [400.0, 400.0])
    assert np.allclose(out["halfWidth"], [200 * np.pi / 288, 200 * np.pi / 432])
