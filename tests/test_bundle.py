"""Round trip of the bundle format and of relation normalisation (no ROOT file needed)."""
import numpy as np
import pytest

from evdtools.__main__ import validate
from evdtools.bundle import Bundle, BundleWriter, encode_record
from evdtools.nano import Converter

HEADER = {"schema": "evd/1", "source": {"files": []}, "profile": "test",
          "tables": {"Hits": {"doc": "", "columns": {"x": {"type": "f32", "doc": ""}, "flag": {"type": "u8", "doc": ""}}},
                     "Clusters": {"doc": "", "columns": {"e": {"type": "f64", "doc": ""}}}},
          "relations": {"clusterHits": {"from": "Clusters", "to": "Hits", "weights": ["fraction"]}},
          "display": []}


def event(seed):
    rng = np.random.default_rng(seed)
    hits = {"x": rng.random(7, dtype=np.float32), "flag": rng.integers(0, 2, 7).astype(bool)}
    clusters = {"e": rng.random(3)}
    rel = {"offsets": np.array([0, 2, 2, 5]), "indices": np.array([0, 6, 1, 2, 3]),
           "weights": {"fraction": np.array([1, .5, .5, 1, 1])}}
    eid = (np.uint32(1), np.uint32(1), np.uint64(seed))  # as read from ROOT
    return eid, {"Hits": (7, hits), "Clusters": (3, clusters)}, {"clusterHits": rel}


def test_round_trip(tmp_path):
    path = str(tmp_path / "t.evdb")
    with BundleWriter(path, HEADER) as w:
        for seed in (11, 12):
            w.add(*event(seed))
    b = Bundle(path)
    assert len(b) == 2 and b.header["profile"] == "test"
    for i, seed in enumerate((11, 12)):
        eid, tables, rels = event(seed)
        got = b.event(i)
        assert got["event"] == list(eid)
        np.testing.assert_array_equal(got["tables"]["Hits"][1]["x"], tables["Hits"][1]["x"])
        np.testing.assert_array_equal(got["tables"]["Hits"][1]["flag"], tables["Hits"][1]["flag"].astype(np.uint8))
        np.testing.assert_array_equal(got["relations"]["clusterHits"]["indices"], rels["clusterHits"]["indices"])
    assert validate(path) == []


def test_columns_are_8_byte_aligned():
    import json, struct
    data = encode_record((1, 1, 1), {"T": (3, {"a": np.zeros(3, np.uint8), "b": np.zeros(3, np.float64)})}, {})
    hlen = struct.unpack("<I", data[4:8])[0]
    assert (8 + hlen) % 8 == 0
    meta = json.loads(data[8:8 + hlen])
    assert all(loc[0] % 8 == 0 for loc in meta["tables"]["T"]["columns"].values())


@pytest.mark.parametrize("rel, cols, expected", [
    ({"kind": "counts", "counts": "A.n", "indices": "L.i"}, {"A": {"n": np.array([2, 0, 1])}, "L": {"i": np.array([4, 1, 3])}},
     ([0, 2, 2, 3], [4, 1, 3])),
    ({"kind": "links", "fromIndex": "L.f", "toIndex": "L.t"}, {"A": {}, "L": {"f": np.array([0, 0, 2]), "t": np.array([1, -1, 4])}},
     ([0, 1, 1, 2], [1, 4])),
    ({"kind": "index", "index": "A.k"}, {"A": {"k": np.array([3, -1, 0])}, "L": {}}, ([0, 1, 1, 2], [3, 0])),
])
def test_relation_normalisation(rel, cols, expected):
    tables = {"A": (3, cols["A"]), "B": (5, {}), "L": (3, cols["L"])}
    out = Converter._relation(dict(rel, name="r", **{"from": "A", "to": "B"}), tables)
    np.testing.assert_array_equal(out["offsets"], expected[0])
    np.testing.assert_array_equal(out["indices"], expected[1])


def test_relation_out_of_range_is_rejected():
    tables = {"A": (1, {"k": np.array([9])}), "B": (5, {})}
    with pytest.raises(ValueError):
        Converter._relation({"name": "r", "kind": "index", "from": "A", "to": "B", "index": "A.k"}, tables)
