"""Tracks, their hits and time, vertices, and the MTD rechits."""

from .writer import MTD_RECHITS, TRACK_HITS, VERTEX_TRACKS


def general_tracks(w):
    """General tracks: HGCalNanoAOD's table (Phase 2: its TICL candidates extend it with their HGCal entry point),
    with the columns the profiles draw, and their outermost position."""
    if not w.inv.has("generalTracks", product_type="recoTracks") or not w.need("SimpleTrackFlatTableProducer"):
        return
    text = """
# General tracks, in the table NANO:@HGCAL writes (DPGAnalysis/HGCalNanoAOD), with the columns drawn: a helix from
# the reference point with the momentum, to the outermost hit (from the track extra)
"""
    if w.hgcal_nano:
        text += "process.emberTables.add(process.generalTracksTable)\n"
    else:
        text += """from DPGAnalysis.HGCalNanoAOD.hgcalGeneralTracks_cfi import generalTracksTable
table("generalTracksTable", generalTracksTable.clone())
"""
    w.add(
        text
        + """process.generalTracksTable.variables = cms.PSet(
    pt=Var("pt", "float", precision=12, doc="pt [GeV]"),
    eta=Var("eta", "float", precision=12, doc="pseudorapidity"),
    phi=Var("phi", "float", precision=12, doc="azimuth"),
    charge=Var("charge", "int16", doc="charge"),
    vx=Var("vx", "float", precision=14, doc="x of the reference point [cm]"),
    vy=Var("vy", "float", precision=14, doc="y of the reference point [cm]"),
    vz=Var("vz", "float", precision=14, doc="z of the reference point [cm]"),
    dxy0=Var("dxy", "float", doc="transverse impact parameter to the origin (0, 0, 0) [cm]"),
    dz0=Var("dz", "float", doc="longitudinal impact parameter to the origin (0, 0, 0) [cm]"),
    dxy0Err=Var("dxyError", "float", precision=10, doc="uncertainty of dxy0, from the fit [cm]"),
    dz0Err=Var("dzError", "float", precision=10, doc="uncertainty of dz0, from the fit [cm]"),
    chi2=Var("normalizedChi2", "float", precision=8, doc="chi2 / ndof of the fit"),
    outerX=Var("outerX", "float", precision=14, doc="x of the outermost hit [cm]"),
    outerY=Var("outerY", "float", precision=14, doc="y of the outermost hit [cm]"),
    outerZ=Var("outerZ", "float", precision=14, doc="z of the outermost hit [cm]"),
    nhits=Var("numberOfValidHits", "uint8", doc="number of valid hits"),
    highPurity=Var("quality('highPurity')", bool, doc="high-purity track"),
)
"""
        + track_time(w)
    )
    w.written.add("GeneralTrack")
    w.track_tables.append(("GeneralTrack", "generalTracks"))
    gsf_tracks(w)


def track_time(w):
    """Phase 2: the tracks' time at the beam line from MTD (tofPID), when the input has it."""
    if not w.inv.has("tofPID", "t0"):
        return ""
    return """# Their time at the beam line from MTD (tofPID, Phase 2), and its uncertainty (negative: none)
process.generalTracksTable.externalVariables = cms.PSet(
    t0=ExtVar("tofPID:t0", float, precision=10, doc="time at the beam line [ns]"),
    sigmat0=ExtVar("tofPID:sigmat0", float, precision=8, doc="uncertainty of t0 [ns]; negative: no time"),
)
"""


def gsf_tracks(w):
    """The electrons' GSF tracks (electronGsfTracks): the same columns as the general tracks."""
    w.gsf = w.inv.has("electronGsfTracks", product_type="recoGsfTracks") and w.need("SimpleGsfTrackFlatTableProducer")
    if w.gsf:
        w.track_tables.append(("GsfTrack", "electronGsfTracks"))
        w.add(
            """
# The electrons' GSF tracks, drawn as the general tracks are
table("gsfTrackTable", cms.EDProducer("SimpleGsfTrackFlatTableProducer", src=cms.InputTag("electronGsfTracks"),
    name=cms.string("GsfTrack"), doc=cms.string("electronGsfTracks"), cut=cms.string(""), singleton=cms.bool(False),
    extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(
        process.generalTracksTable.variables.clone(highPurity=None))))
"""
        )


def vertices(w, pat=False):
    """Every primary vertex (row 0 is the leading one, which PF and PUPPI take as the hard scatter) and the
    inclusive secondary vertices, in collection order; with `pat`, standard NanoAOD has the leading one."""
    inv, rows = w.inv, []
    if pat:
        return
    time = (
        '\n        t=Var("t", "float", precision=10, doc="time [ns] (MTD)"),'
        '\n        tError=Var("tError", "float", precision=8, doc="uncertainty of t [ns]; 0 or less: no time"),'
    ) * w.s.phase2
    for label, name, src, doc, extra in [
        ("pvTable", "PV", "offlinePrimaryVertices", "offline primary vertices (row 0: the leading one)",
         '\n        ndof=Var("ndof", "float", precision=8, doc="number of degrees of freedom"),'
         '\n        chi2=Var("normalizedChi2", "float", precision=8, doc="chi2 / ndof"),' + time),
        ("svTable", "SV", "inclusiveSecondaryVertices", "inclusive secondary vertices",
         '\n        ndof=Var("ndof", "float", precision=8, doc="number of degrees of freedom"),'
         '\n        chi2=Var("normalizedChi2", "float", precision=8, doc="chi2 / ndof"),'
         # the sum of its tracks' momenta, each a pion, weighted >= 0.5 in the fit (reco::Vertex::p4's defaults)
         + "".join(f'\n        {c}=Var("p4(0.13957018,0.5).{f}()", "float", precision=10, doc="{d} of its tracks'
                   f' (pions) [GeV]"),' for c, f, d in (("mass", "M", "mass"), ("pt", "Pt", "pT"), ("px", "Px", "px"),
                                                      ("py", "Py", "py"), ("pz", "Pz", "pz")))),
    ]:  # fmt: skip
        if inv.has(src, product_type="recoVertexs") and w.need("SimpleVertexFlatTableProducer"):
            rows.append(f"""
table("{label}", cms.EDProducer("SimpleVertexFlatTableProducer", src=cms.InputTag("{src}"),
    name=cms.string("{name}"), doc=cms.string("{doc}"), cut=cms.string(""),
    singleton=cms.bool(False), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True),
    variables=cms.PSet(
        x=Var("x", "float", doc="x [cm]"),
        y=Var("y", "float", doc="y [cm]"),
        z=Var("z", "float", doc="z [cm]"),
        xErr=Var("xError", "float", precision=10, doc="uncertainty of x [cm]"),
        yErr=Var("yError", "float", precision=10, doc="uncertainty of y [cm]"),
        zErr=Var("zError", "float", precision=10, doc="uncertainty of z [cm]"),
        covXY=Var("covariance(0,1)", "float", precision=10, doc="covariance of x and y [cm2]"),
        covXZ=Var("covariance(0,2)", "float", precision=10, doc="covariance of x and z [cm2]"),
        covYZ=Var("covariance(1,2)", "float", precision=10, doc="covariance of y and z [cm2]"),
        ntracks=Var("tracksSize", "uint16", doc="number of tracks"),{extra}
    )))""")
    if rows:
        w.add(
            "\n# Vertices: every primary vertex, and the inclusive secondary vertices"
            + "".join(rows)
            + vertex_tracks(w)
        )


def track_hits(w):
    """The valid hits of the tracks of each table in track_tables, in track order (CMSSW branch
    nanoaod-track-hits)."""
    # an AOD keeps no hits of its tracks (TrackingRecHitsOwned), and the producer would fail on them
    kept = [(n, src) for n, src in w.track_tables if w.inv.has(src.split(":")[0], "", "TrackingRecHitsOwned")]
    if len(kept) < len(w.track_tables):
        left = [n for n, _ in w.track_tables if (n, _) not in kept]
        w.notes.append(f"the hits of {', '.join(left)}: the input does not keep them (AOD)")
    w.track_tables = kept
    if not w.track_tables or not w.branch(TRACK_HITS, "the hits of tracks"):
        return
    text = """
# The valid hits of the tracks (PhysicsTools/NanoAOD, CMSSW branch nanoaod-track-hits): a count n<Name>Hits on each
# track table, and a table <Name>Hits of DetId, global position and layer (the station in the muon system), in track
# order. The tracker hits' positions come from their clusters, as the track fit sees them.
process.load("RecoTracker.TransientTrackingRecHit.TTRHBuilders_cff")
process.load("RecoLocalTracker.SiPixelRecHits.PixelCPEESProducers_cff")
process.load("RecoLocalTracker.SiStripRecHitConverter.StripCPEfromTrackAngle_cfi")
process.load("RecoLocalTracker.SiStripRecHitConverter.SiStripRecHitMatcher_cfi")
"""
    for name, src in w.track_tables:
        text += (
            f'table("{name[0].lower()}{name[1:]}HitsTable", cms.EDProducer("TrackHitsTableProducer",\n'
            f'    src=cms.InputTag("{src}"), name=cms.string("{name}"), hitsName=cms.string("{name}Hits"),\n'
            f'    hitsDoc=cms.string("valid hits of {src}"), precision=cms.int32(14), skipNonExistingSrc=cms.bool(True)))\n'
        )
    w.add(text)


def vertex_tracks(w):
    """The (vertex, track) pairs of the primary and secondary vertices with the tracks' weights (CMSSW branch
    nanoaod-vertex-tracks), as text for vertices()."""
    pairs = [(name, src) for name, src in (("PV", "offlinePrimaryVertices"), ("SV", "inclusiveSecondaryVertices"))
             if w.inv.has(src, product_type="recoVertexs")]  # fmt: skip
    if not pairs or "GeneralTrack" not in w.written:
        return ""
    if not w.branch(VERTEX_TRACKS, "the tracks of vertices"):
        return ""
    return (
        "\n# The tracks of each vertex, with their weight in its fit (CMSSW branch nanoaod-vertex-tracks)\n"
        + "".join(
            f'table("{name.lower()}TrackTable", cms.EDProducer("VertexTrackTableProducer", src=cms.InputTag("{src}"),\n'
            f'    tracks=cms.InputTag("generalTracks"), name=cms.string("{name}Tracks"), doc=cms.string("{src} <-> '
            f'generalTracks"),\n    precision=cms.int32(10), skipNonExistingSrc=cms.bool(True)))\n'
            for name, src in pairs
        )
    )


def mtd_rechits(w):
    """Every BTL and ETL rechit (CMSSW branch nanoaod-mtd-rechits), Phase 2."""
    inv = w.inv
    parts = [(n, i) for n, i in (("BTL", "FTLBarrel"), ("ETL", "FTLEndcap")) if inv.has("mtdRecHits", i)]
    if not parts or not w.branch(MTD_RECHITS, "the MTD rechits"):
        return
    w.add(
        "\n# Every MTD rechit (BTL and ETL) with its time and position (CMSSW branch nanoaod-mtd-rechits), one table\n"
        + "".join(
            f'table("{n.lower()}RecHitTable", cms.EDProducer("MTDRecHitTableProducer",\n'
            f'    src=cms.InputTag("mtdRecHits", "{i}"), name=cms.string("RecHit{n}"), doc=cms.string("{n} rechits"),\n'
            f"    precision=cms.int32(14), skipNonExistingSrc=cms.bool(True)))\n"
            for n, i in parts
        )
    )
