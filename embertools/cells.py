"""Calorimeter cell sizes from the DetId (and the cell's position), for the cells the viewer draws: the `cell`
derive (derive.py, docs/profiles.md). The rules follow CMS's DetId layouts (DataFormats/*DetId) and the
segmentation of each subdetector, and are checked against every cell of the Run 3 and D104 geometries
(tests/test_cells.py, the geometry sweep of the cluster-hits pull request's validation).

  hgcal       HGCal silicon and scintillator: halfWidth, the hexagon's apothem (high or low density, from the DetId's
              type) or half the tile's width, r dphi / 2 (288 tiles in phi, 432 fine ones)
  ecalEndcap  ECAL endcap crystals: dEta and dPhi of an eta-phi bin with the area of the crystal's 2.862 cm square face
  preshower   preshower strips: the unit vectors u (across, 1.9 mm) and v (along, 6.1 cm) of the strip
  hcal        HB, HE, HF, HO: dEta, dPhi and depth (cm, from the front face outwards: radial in HB and HO, along z in
              HE and HF) from the |ieta| and depth of the DetId
"""

import numpy as np

COLUMNS = {
    "hgcal": {"halfWidth": "half width of the cell [cm]: apothem of the silicon hexagon, or r dphi / 2 of the tile"},
    "ecalEndcap": {
        "dEta": "eta width of a bin with the area of the crystal's front face",
        "dPhi": "phi width of a bin with the area of the crystal's front face",
    },
    "preshower": {
        **{f"u{c}": f"{c} of the direction across the strip" for c in "xyz"},
        **{f"v{c}": f"{c} of the direction along the strip" for c in "xyz"},
    },
    "hcal": {
        "dEta": "eta width of the tower",
        "dPhi": "phi width of the tower",
        "depth": "depth of the cell from its front face outwards [cm]: radial in HB and HO, along z in HE and HF",
    },
}

# HGCal silicon wafer types (HGCSiliconDetId, bits 26-27): HD120, LD200, LD300, HD200, and the apothems of their cells
SILICON_APOTHEM = np.array([0.4028, 0.6042, 0.6042, 0.4028], np.float32)
TILES_IN_PHI = 288  # HGCal scintillator tiles around the ring (every tile of D104)
# Fine tiles (HGCScintillatorDetId bit 24): 432 around the ring in the v19 HGCal geometries (Run4D120, D122, D123,
# D126-D128; Geometry/HGCalCommonData/data/hgcal/v19/hgcal.xml NPhiBinBHFine), not checked against a sweep; no D104
# tile has it.
FINE_TILES_IN_PHI = 432
EE_CRYSTAL = 2.862  # ECAL endcap crystal front face [cm]
DET_HCAL = 4
HCAL_SUBDETS = {1: "HB", 2: "HE", 3: "HO", 4: "HF"}

# (subdetector, |ieta|) -> {depth: (dEta, dPhi [degrees], depth [cm])} of the Run 3 geometry, from the geometry sweep
# (median per cell kind; every cell of a kind agrees within 1e-4). Phase 2 (D104) has the same HB, HF and HO but for
# one cell, in HCAL_PHASE2. The depth is the sweep's thickness, from the front face's centre to the back face's along
# the line from the origin; _hcal projects it onto the face's normal (HB, HE, HO), as the viewer's towers grow from
# the face along its normal.
HCAL = {
    ("HB", 1): {1: (0.087, 5, 0.9), 2: (0.087, 5, 18.5), 3: (0.087, 5, 24.5), 4: (0.087, 5, 44)},
    ("HB", 2): {1: (0.087, 5, 0.9), 2: (0.087, 5, 18.6), 3: (0.087, 5, 24.7), 4: (0.087, 5, 44.4)},
    ("HB", 3): {1: (0.087, 5, 0.9), 2: (0.087, 5, 18.9), 3: (0.087, 5, 25.1), 4: (0.087, 5, 45)},
    ("HB", 4): {1: (0.087, 5, 0.9), 2: (0.087, 5, 19.3), 3: (0.087, 5, 25.6), 4: (0.087, 5, 46)},
    ("HB", 5): {1: (0.087, 5, 1), 2: (0.087, 5, 19.9), 3: (0.087, 5, 26.4), 4: (0.087, 5, 47.4)},
    ("HB", 6): {1: (0.087, 5, 1), 2: (0.087, 5, 20.6), 3: (0.087, 5, 27.4), 4: (0.087, 5, 49.1)},
    ("HB", 7): {1: (0.087, 5, 1), 2: (0.087, 5, 21.5), 3: (0.087, 5, 28.5), 4: (0.087, 5, 51.2)},
    ("HB", 8): {1: (0.087, 5, 1.1), 2: (0.087, 5, 22.5), 3: (0.087, 5, 29.9), 4: (0.087, 5, 53.7)},
    ("HB", 9): {1: (0.087, 5, 1.2), 2: (0.087, 5, 23.8), 3: (0.087, 5, 31.5), 4: (0.087, 5, 56.6)},
    ("HB", 10): {1: (0.087, 5, 1.2), 2: (0.087, 5, 25.1), 3: (0.087, 5, 33.4), 4: (0.087, 5, 59.9)},
    ("HB", 11): {1: (0.087, 5, 1.3), 2: (0.087, 5, 26.7), 3: (0.087, 5, 35.5), 4: (0.087, 5, 63.7)},
    ("HB", 12): {1: (0.087, 5, 1.4), 2: (0.087, 5, 28.5), 3: (0.087, 5, 37.8), 4: (0.087, 5, 68)},
    ("HB", 13): {1: (0.087, 5, 1.5), 2: (0.087, 5, 30.5), 3: (0.087, 5, 40.5), 4: (0.087, 5, 72.7)},
    ("HB", 14): {1: (0.087, 5, 1.6), 2: (0.087, 5, 32.8), 3: (0.087, 5, 43.5), 4: (0.087, 5, 78.1)},
    ("HB", 15): {1: (0.087, 5, 1.7), 2: (0.087, 5, 35.2), 3: (0.087, 5, 46.8), 4: (0.087, 5, 84)},
    ("HB", 16): {1: (0.087, 5, 19.3), 2: (0.087, 5, 25.6), 3: (0.087, 5, 38)},
    ("HE", 16): {4: (0.087, 5, 90.1)},
    ("HE", 17): {2: (0.087, 5, 69.1), 3: (0.087, 5, 97.9)},
    ("HE", 18): {1: (0.087, 5, 1), 2: (0.087, 5, 20.1), 3: (0.087, 5, 29.1), 4: (0.087, 5, 19.5), 5: (0.087, 5, 67.4)},
    ("HE", 19): {
        1: (0.087, 5, 10.3),
        2: (0.087, 5, 19.3),
        3: (0.087, 5, 19.3),
        4: (0.087, 5, 19.3),
        5: (0.087, 5, 28.7),
        6: (0.087, 5, 28.7),
    },
    ("HE", 20): {
        1: (0.087, 5, 10.1),
        2: (0.087, 5, 19),
        3: (0.087, 5, 19),
        4: (0.087, 5, 19),
        5: (0.087, 5, 28.3),
        6: (0.087, 5, 28.3),
    },
    ("HE", 21): {
        1: (0.09, 10, 10),
        2: (0.09, 10, 18.8),
        3: (0.09, 10, 18.8),
        4: (0.09, 10, 18.8),
        5: (0.09, 10, 28),
        6: (0.09, 10, 28),
    },
    ("HE", 22): {
        1: (0.1, 10, 9.9),
        2: (0.1, 10, 18.6),
        3: (0.1, 10, 18.6),
        4: (0.1, 10, 18.6),
        5: (0.1, 10, 27.7),
        6: (0.1, 10, 27.7),
    },
    ("HE", 23): {
        1: (0.113, 10, 9.8),
        2: (0.113, 10, 18.4),
        3: (0.113, 10, 18.4),
        4: (0.113, 10, 18.4),
        5: (0.113, 10, 27.5),
        6: (0.113, 10, 27.5),
    },
    ("HE", 24): {
        1: (0.129, 10, 9.8),
        2: (0.129, 10, 18.3),
        3: (0.129, 10, 18.3),
        4: (0.129, 10, 18.3),
        5: (0.129, 10, 27.3),
        6: (0.129, 10, 27.3),
    },
    ("HE", 25): {
        1: (0.15, 10, 9.7),
        2: (0.15, 10, 18.2),
        3: (0.15, 10, 18.2),
        4: (0.15, 10, 18.2),
        5: (0.15, 10, 27.1),
        6: (0.15, 10, 27.1),
    },
    ("HE", 26): {
        1: (0.178, 10, 9.6),
        2: (0.178, 10, 9.2),
        3: (0.178, 10, 9.2),
        4: (0.178, 10, 9.2),
        5: (0.178, 10, 18.1),
        6: (0.178, 10, 26.9),
        7: (0.178, 10, 26.9),
    },
    ("HE", 27): {
        1: (0.15, 10, 9.6),
        2: (0.15, 10, 9.2),
        3: (0.15, 10, 9.2),
        4: (0.15, 10, 9.2),
        5: (0.15, 10, 18),
        6: (0.15, 10, 26.8),
        7: (0.15, 10, 26.8),
    },
    ("HE", 28): {
        1: (0.218, 10, 9.6),
        2: (0.218, 10, 9.1),
        3: (0.218, 10, 9.1),
        4: (0.35, 10, 9.1),
        5: (0.35, 10, 17.9),
        6: (0.35, 10, 26.7),
        7: (0.35, 10, 26.7),
    },
    ("HE", 29): {1: (0.132, 10, 9.5), 2: (0.132, 10, 9.1), 3: (0.132, 10, 9.1)},
    ("HF", 29): {1: (0.1115, 10, 165.1), 2: (0.1116, 10, 143.1), 3: (0.1115, 10, 165.1), 4: (0.1116, 10, 143.1)},
    ("HF", 30): {1: (0.1747, 10, 165.1), 2: (0.1747, 10, 143.1), 3: (0.1747, 10, 165.1), 4: (0.1747, 10, 143.1)},
    ("HF", 31): {1: (0.175, 10, 165.1), 2: (0.175, 10, 143.1), 3: (0.175, 10, 165.1), 4: (0.175, 10, 143.1)},
    ("HF", 32): {1: (0.1756, 10, 165.1), 2: (0.1756, 10, 143.1), 3: (0.1756, 10, 165.1), 4: (0.1756, 10, 143.1)},
    ("HF", 33): {1: (0.1745, 10, 165.1), 2: (0.1745, 10, 143.1), 3: (0.1745, 10, 165.1), 4: (0.1745, 10, 143.1)},
    ("HF", 34): {1: (0.1759, 10, 165.1), 2: (0.1759, 10, 143.1), 3: (0.1759, 10, 165.1), 4: (0.1759, 10, 143.1)},
    ("HF", 35): {1: (0.1735, 10, 165.1), 2: (0.1735, 10, 143.1), 3: (0.1735, 10, 165.1), 4: (0.1735, 10, 143.1)},
    ("HF", 36): {1: (0.1773, 10, 165.1), 2: (0.1773, 10, 143.1), 3: (0.1773, 10, 165.1), 4: (0.1773, 10, 143.1)},
    ("HF", 37): {1: (0.1729, 10, 165.1), 2: (0.1729, 10, 143.1), 3: (0.1729, 10, 165.1), 4: (0.1729, 10, 143.1)},
    ("HF", 38): {1: (0.1753, 10, 165.1), 2: (0.1753, 10, 143.1), 3: (0.1753, 10, 165.1), 4: (0.1753, 10, 143.1)},
    ("HF", 39): {1: (0.1773, 10, 165.1), 2: (0.1773, 10, 143.1), 3: (0.1773, 10, 165.1), 4: (0.1773, 10, 143.1)},
    ("HF", 40): {1: (0.1734, 20, 165.1), 2: (0.1734, 20, 143.1), 3: (0.1734, 20, 165.1), 4: (0.1734, 20, 143.1)},
    ("HF", 41): {1: (0.3016, 20, 165.1), 2: (0.3016, 20, 143.1), 3: (0.3016, 20, 165.1), 4: (0.3016, 20, 143.1)},
    ("HO", 1): {4: (0.087, 5, 23.6)},
    ("HO", 2): {4: (0.087, 5, 23.8)},
    ("HO", 3): {4: (0.087, 5, 24.2)},
    ("HO", 4): {4: (0.0465, 5, 24.6)},
    ("HO", 5): {4: (0.0955, 5, 1.1)},
    ("HO", 6): {4: (0.087, 5, 1.1)},
    ("HO", 7): {4: (0.087, 5, 1.2)},
    ("HO", 8): {4: (0.087, 5, 1.2)},
    ("HO", 9): {4: (0.087, 5, 1.3)},
    ("HO", 10): {4: (0.0664, 5, 1.4)},
    ("HO", 11): {4: (0.084, 5, 1.5)},
    ("HO", 12): {4: (0.087, 5, 1.5)},
    ("HO", 13): {4: (0.087, 5, 1.7)},
    ("HO", 14): {4: (0.087, 5, 1.8)},
    ("HO", 15): {4: (0.087, 5, 1.9)},
}
HCAL_PHASE2 = {("HB", 16): {**HCAL[("HB", 16)], 3: (0.087, 5, 63.7)}}


def compute(rule, det_id, x, y, z, geometry="run3"):
    """{column: float32 array} of a cell rule (COLUMNS) for the cells with these raw DetIds and positions [cm].
    `geometry`: "run3" or "phase2" (HCAL depths). Cells the rule does not know get NaN."""
    det_id = np.asarray(det_id).astype(np.int64)
    x, y, z = (np.asarray(v, np.float64) for v in (x, y, z))
    r = np.hypot(x, y)
    if rule == "hgcal":
        silicon = SILICON_APOTHEM[(det_id >> 26) & 3]
        tile = r * np.pi / np.where(((det_id >> 24) & 1) == 1, FINE_TILES_IN_PHI, TILES_IN_PHI)
        out = {"halfWidth": np.where((det_id >> 28) == 10, tile, silicon)}
    elif rule == "ecalEndcap":
        # A square of side a at radius r on a plane |z| = const covers a/r in phi and a |z| / (R r) in eta.
        out = {"dPhi": EE_CRYSTAL / r, "dEta": EE_CRYSTAL * np.abs(z) / (np.hypot(r, z) * r)}
    elif rule == "preshower":
        across_x = ((det_id >> 18) & 1) == 0  # plane 1: strips along y, measuring x; plane 2: along x
        zero, one = np.zeros(len(det_id)), np.ones(len(det_id))
        out = {
            "ux": np.where(across_x, one, zero), "uy": np.where(across_x, zero, one), "uz": zero,
            "vx": np.where(across_x, zero, one), "vy": np.where(across_x, one, zero), "vz": zero,
        }  # fmt: skip
    elif rule == "hcal":
        out = _hcal(det_id, r, z, geometry)
    else:
        raise ValueError(f"unknown cell rule {rule}; known: {', '.join(COLUMNS)}")
    return {c: v.astype(np.float32) for c, v in out.items()}


def _hcal(det_id, r, z, geometry):
    """dEta, dPhi, depth of HCAL cells from the HCAL tables (NaN for a cell they lack, or another detector): each
    cell's (subdetector, |ieta|, depth) is looked up among the table's sorted keys, one numpy search for all rows.
    The table's depth, along the line from the origin through the cell at (r, z), becomes radial in HB and HO (times
    r / R, R the distance from the origin: 1 / cosh eta) and along z in HE (times |z| / R: |tanh eta|); HF's is already
    along z."""
    keys, values = _hcal_lookup(geometry)
    new = ((det_id >> 24) & 1) == 1  # the HcalDetId layout since 2017 (bit 24), else the one before
    ieta = np.where(new, (det_id >> 10) & 0x1FF, (det_id >> 7) & 0x3F)
    depth = np.where(new, (det_id >> 20) & 0xF, (det_id >> 14) & 0x1F)
    subdet = (det_id >> 25) & 7
    key = _hcal_key(subdet, ieta, depth)
    pos = np.minimum(np.searchsorted(keys, key), len(keys) - 1)
    found = ((det_id >> 28) == DET_HCAL) & (keys[pos] == key)
    out = np.where(found[:, None], values[pos], np.nan)
    R = np.hypot(r, z)
    along = np.select([np.isin(subdet, (1, 3)), subdet == 2], [r / R, np.abs(z) / R], 1.0)  # HB and HO, HE; HF 1
    return {"dEta": out[:, 0], "dPhi": np.radians(out[:, 1]), "depth": out[:, 2] * along}


def _hcal_key(subdet, ieta, depth):
    return (np.asarray(subdet, np.int64) << 16) | (np.asarray(ieta, np.int64) << 8) | np.asarray(depth, np.int64)


def _hcal_lookup(geometry):
    """(sorted keys, values) of the HCAL table of a geometry."""
    table = {**HCAL, **HCAL_PHASE2} if geometry == "phase2" else HCAL
    number = {name: s for s, name in HCAL_SUBDETS.items()}
    rows = sorted(
        (int(_hcal_key(number[name], ieta, depth)), cell)
        for (name, ieta), depths in table.items()
        for depth, cell in depths.items()
    )
    return np.array([k for k, _ in rows]), np.array([v for _, v in rows], np.float64)
