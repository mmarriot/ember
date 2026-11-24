"""Configuration sections for the muon system (DPGAnalysis/MuonTools): segments, rechits and chambers, and the
standalone and global muon tracks."""

from .writer import BRANCHES, MUON_RECHITS, MUON_TRACK_LINKS, TRACK_HITS, first_lower

# The columns of MuonTools' segment and rechit tables ({}: the table's own columns)
_SEGMENT = """
    variables=cms.PSet(
        chi2=Var("chi2", "float", precision=8, doc="chi2"),
        ndof=Var("degreesOfFreedom", "int16", doc="number of degrees of freedom"),{}
    ),
    globalPosVariables=cms.PSet(
        x=GlobGeomVar("x()", precision=14, doc="x [cm]"),
        y=GlobGeomVar("y()", precision=14, doc="y [cm]"),
        z=GlobGeomVar("z()", precision=14, doc="z [cm]"),
    ),
    globalDirVariables=cms.PSet(
        dx=GlobGeomVar("x()", precision=10, doc="direction, x"),
        dy=GlobGeomVar("y()", precision=10, doc="direction, y"),
        dz=GlobGeomVar("z()", precision=10, doc="direction, z"),
    ),"""
_HIT = """
    variables=cms.PSet({}
    ),
    globalPosVariables=cms.PSet(
        x=GlobGeomVar("x()", precision=14, doc="x [cm]"),
        y=GlobGeomVar("y()", precision=14, doc="y [cm]"),
        z=GlobGeomVar("z()", precision=14, doc="z [cm]"),
    ),"""
_STRIPS = (
    '\n        bx=Var("BunchX()", "int16", doc="bunch crossing"),'
    '\n        clusterSize=Var("clusterSize()", "int16", doc="number of strips"),'
)


def _detid(*fields):
    """The DetId columns: these fields of it, then the raw DetId."""
    columns = "".join(f'\n        {f}=DetIdVar("{f}()", "int16", doc="{f}"),' for f in fields)
    return f'\n    detIdVariables=cms.PSet({columns}\n        detId=DetIdVar("rawId()", "uint", doc="DetId"),\n    ),'


def muon_tracks(w):
    """(table, collection, reco::Muon's reference, index column) of the standalone and global muon tracks that are
    written: only with their hits (CMSSW branch nanoaod-track-hits), through which they are drawn."""
    if not BRANCHES[TRACK_HITS] <= w.release or "SimpleTrackFlatTableProducer" not in w.release:
        return []
    # A muon's outerTrack() points into standAloneMuons:UpdatedAtVtx, or into standAloneMuons where the update at
    # the vertex failed, and the two collections stop lining up after such a track: its key does not give a row.
    # So the standalone tracks get no expression (None, below): muon_track_links() writes their index.
    tracks = [("StandaloneMuonTrack", "standAloneMuons:UpdatedAtVtx", None, None),
              ("GlobalMuonTrack", "globalMuons", "globalTrack()", "globalTrackIdx")]  # fmt: skip
    return [t for t in tracks if w.inv.has(*t[1].split(":"), product_type="recoTracks")]


def muon_track_links(w):
    """The muons' rows of their standalone track (CMSSW branch nanoaod-muon-track-links), extending the muon table:
    the producer checks which collection the reference is in, which an expression cannot."""
    standalone = [t for t in muon_tracks(w) if t[0] == "StandaloneMuonTrack"]
    if not standalone or not w.inv.has("standAloneMuons", "", "recoTracks"):
        return
    if not w.branch(MUON_TRACK_LINKS, "the muons' standalone tracks"):
        return
    # every collection an outer track can be in must be given (else the producer throws): standAloneMuons too,
    # whose table is not written (outerTrackNotAtVtxIdx, unused)
    w.add("""
# The muons' standalone tracks (CMSSW branch nanoaod-muon-track-links): the row in the StandaloneMuonTrack table
# (standAloneMuons:UpdatedAtVtx), -1 if none or in standAloneMuons (the update at the vertex failed)
table("muonTrackLinkTable", cms.EDProducer("MuonTrackLinkTableProducer", src=cms.InputTag("muons"), name=cms.string("Muon"),
    tracks=cms.VPSet(
        cms.PSet(name=cms.string("standaloneTrackIdx"), type=cms.string("outer"), src=cms.InputTag("standAloneMuons", "UpdatedAtVtx"),
                 doc=cms.string("row in StandaloneMuonTrack (standAloneMuons:UpdatedAtVtx), -1 if none or not there")),
        cms.PSet(name=cms.string("outerTrackNotAtVtxIdx"), type=cms.string("outer"), src=cms.InputTag("standAloneMuons"),
                 doc=cms.string("index in standAloneMuons (not updated at the vertex), -1 if none or not there")))))""")


def muon_system(w, pat=False):
    """DPGAnalysis/MuonTools' tables of the segments (DT, CSC, GEM) and of the GEM and RPC rechits, with their global
    position (and direction), in collection order (by DetId); with the CMSSW branch muontools-rechits-chambers, the DT
    and CSC rechits, the chambers in use and the muons' segments; and the standalone and global muon tracks."""
    inv, parts = w.inv, []
    tables = [
        ("dt4DSegments", "DTSegmentFlatTableProducer", "dtSegment", "DTSegment", "DT 4D segments",
         _SEGMENT.format('\n        time=Var("?hasPhi()?phiSegment().t0():-99", "float", precision=8, doc="t0 [ns]; '
                        '-99: none"),') + _detid("wheel", "station", "sector")),
        ("cscSegments", "CSCSegmentFlatTableProducer", "cscSegment", "CSCSegment", "CSC segments",
         _SEGMENT.format('\n        nHits=Var("nRecHits", "int16", doc="number of hits"),\n        time=Var("time", '
                        '"float", precision=8, doc="time [ns]"),') + _detid("endcap", "station", "ring", "chamber")),
        ("gemSegments", "GEMSegmentFlatTableProducer", "gemSegment", "GEMSegment", "GEM segments",
         _SEGMENT.format('\n        nHits=Var("nRecHits", "int16", doc="number of hits"),')
         + _detid("region", "station", "ring", "chamber")),
        ("gemRecHits", "GEMRecHitFlatTableProducer", "gemRecHit", "GEMRecHit", "GEM rechits",
         _HIT.format(_STRIPS) + _detid("region", "station", "ring", "chamber", "layer", "roll")),
        ("rpcRecHits", "RPCRecHitFlatTableProducer", "rpcRecHit", "RPCRecHit", "RPC rechits",
         _HIT.format(_STRIPS + '\n        time=Var("time", "float", precision=8, doc="time [ns]"),')
         + _detid("region", "ring", "station", "sector", "layer", "roll")),
    ]  # fmt: skip
    # The branch's tables: the DT and CSC rechits (RECO), and the chambers and the muons' segments, which need only
    # the segments (an AOD keeps them).
    sources = {"dtSegmentSrc": "dt4DSegments", "cscSegmentSrc": "cscSegments", "gemSegmentSrc": "gemSegments",
               "dtRecHitSrc": "dt1DRecHits", "cscRecHitSrc": "csc2DRecHits", "rpcRecHitSrc": "rpcRecHits",
               "gemRecHitSrc": "gemRecHits"}  # fmt: skip
    held = {k: src for k, src in sources.items() if inv.has(src)}
    more = bool(held) and w.branch(MUON_RECHITS, "the DT and CSC rechits, the muon chambers and the muons' segments")
    if more:
        # the chamber's DetId, which joins the MuonChamber table
        chamber = '\n        chamberDetId=DetIdVar("chamberId().rawId()", "uint", doc="DetId of the chamber"),\n    ),'
        tables += [
            ("dt1DRecHits", "DTRecHitFlatTableProducer", "dtRecHit", "DTRecHit", "DT rechits (wire pairs)",
             _HIT.format("")
             + _detid("wheel", "station", "sector", "superlayer", "layer").replace("\n    ),", chamber)),
            ("csc2DRecHits", "CSCRecHitFlatTableProducer", "cscRecHit", "CSCRecHit", "CSC 2D rechits",
             _HIT.format('\n        time=Var("tpeak", "float", precision=8, doc="peak time [ns]"),')
             + _detid("endcap", "station", "ring", "chamber", "layer").replace("\n    ),", chamber)),
        ]  # fmt: skip
    for src, plugin, cfi, name, doc, columns in tables:
        if inv.has(src) and w.need(plugin):
            parts.append(
                f"from DPGAnalysis.MuonTools.{cfi}FlatTableProducer_cfi import {cfi}FlatTableProducer\n"
                f'table("{cfi}Table", {cfi}FlatTableProducer.clone(src="{src}", name="{name}", doc="{doc}",'
                f"{columns}\n))\n"
            )
    if more:
        # a collection the input lacks is "none" (the MuonTools convention), not a missing product every event
        given = "".join(f'\n    {k}=cms.InputTag("{held.get(k, "none")}"),' for k in sources)
        parts.append(
            "# The chambers that hold a rechit or a segment (centre, axes, half sizes), and the muons' segments\n"
            'table("muChamberTable", cms.EDProducer("MuChamberTableProducer", name=cms.string("MuonChamber"),'
            f"{given}\n    precision=cms.int32(14)))\n"
        )
        for kind, src in (("DT", "dt4DSegments"), ("CSC", "cscSegments"), ("GEM", "gemSegments")):
            if not pat and inv.has("muons", product_type="recoMuons") and inv.has(src):
                parts.append(
                    f'table("mu{kind}SegmentMatchTable", cms.EDProducer("Mu{kind}SegmentMatchTableProducer",\n'
                    f'    src=cms.InputTag("muons"), segmentSrc=cms.InputTag("{src}"), name=cms.string("Muon{kind}Segments"),\n'
                    f'    doc=cms.string("muon <-> {kind} segment matches"), skipNonExistingSrc=cms.bool(True)))\n'
                )
    muon_tracks_written = muon_tracks(w)
    tracks = "".join(
        f'table("{first_lower(n)}Table", cms.EDProducer("SimpleTrackFlatTableProducer", src=cms.InputTag("{src}"),\n'
        f'    name=cms.string("{n}"), doc=cms.string("{src}"), cut=cms.string(""), singleton=cms.bool(False),\n'
        f"    extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(\n"
        f'        pt=Var("pt", "float", precision=10, doc="pt [GeV]"),\n'
        f'        eta=Var("eta", "float", precision=12, doc="pseudorapidity"),\n'
        f'        phi=Var("phi", "float", precision=12, doc="azimuth"),\n'
        f'        charge=Var("charge", "int16", doc="charge"),\n'
        f'        vx=Var("vx", "float", precision=14, doc="x of the reference point [cm]"),\n'
        f'        vy=Var("vy", "float", precision=14, doc="y of the reference point [cm]"),\n'
        f'        vz=Var("vz", "float", precision=14, doc="z of the reference point [cm]"),\n'
        f'        chi2=Var("normalizedChi2", "float", precision=8, doc="chi2 / ndof"))))\n'
        for n, src, _, _ in muon_tracks_written
    )
    w.track_tables += [(n, src) for n, src, _, _ in muon_tracks_written]
    if tracks:
        parts.append("# The standalone and global muon tracks, drawn through their hits (track_hits below)\n" + tracks)
    if parts:
        w.add(
            """
# The muon system (DPGAnalysis/MuonTools): segments, as a position and a direction, and the rechits, with their
# global positions; DetId and its fields
from DPGAnalysis.MuonTools.common_cff import DetIdVar, GlobGeomVar
"""
            + "".join(parts)
        )
