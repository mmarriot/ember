"""PF candidates and physics objects (jets, MET, taus, electrons, photons, muons, beam spot) from the RECO
collections."""

from . import muons
from .writer import CONSTITUENTS, JET_TAGS, PF_LINKS

# The identification variables of electrons and photons: (column, reco::GsfElectron or reco::Photon accessor, type,
# doc), named as standard NanoAOD names them where it has them. The ECAL shower shapes (sieie, r9) are computed on ECAL
# hits only: the HGCal objects get HGCal's own shower shapes instead (EGAMMA_HGCAL).
_ISOLATION = "PF isolation, cone 0.3: {}, sum of {} [GeV]"
_ELECTRON_ID = [
    ("fbrem", "fbrem", "float", "brem fraction: 1 - p at the outermost state / p at the vertex (GSF fit)"),
    ("deltaEtaInSeed", "deltaEtaSeedClusterTrackAtVtx", "float", "delta eta, seed cluster - track from the vertex"),
    ("deltaPhiIn", "deltaPhiSuperClusterTrackAtVtx", "float", "delta phi, supercluster - track from the vertex [rad]"),
    ("eSCOverP", "eSuperClusterOverP", "float", "supercluster energy / track momentum at the vertex"),
    ("eInvMinusPInv", "(1-eSuperClusterOverP())/ecalEnergy()", "float", "1/E - 1/p [1/GeV]"),
    ("lostHits", "gsfTrack.hitPattern.numberOfLostHits('MISSING_INNER_HITS')", "uint8", "missing inner hits"),
    # PAT's conversion veto needs the conversions and is not in RECO; this is the electron MVAs' input
    ("convVtxFitProb", "convVtxFitProb", "float", "fit probability of a conversion with the closest track; -1: none"),
    ("isEcalDriven", "ecalDrivenSeed", bool, "seeded from the calorimeter (ECAL-driven)"),
    ("isTrackerDriven", "trackerDrivenSeed", bool, "seeded from a track (tracker-driven)"),
]
_ELECTRON_ISOLATION = [
    ("pfIsoChg", "pfIsolationVariables().sumChargedHadronPt", "float", _ISOLATION.format("charged hadrons", "pT")),
    ("pfIsoNeu", "pfIsolationVariables().sumNeutralHadronEt", "float", _ISOLATION.format("neutral hadrons", "ET")),
    ("pfIsoPho", "pfIsolationVariables().sumPhotonEt", "float", _ISOLATION.format("photons", "ET")),
]
_PHOTON_ID = [("pixelSeed", "hasPixelSeed", bool, "has a pixel seed")]
_PHOTON_ISOLATION = [
    ("pfIsoChg", "chargedHadronIso", "float", _ISOLATION.format("charged hadrons", "pT")),
    ("pfIsoNeu", "neutralHadronIso", "float", _ISOLATION.format("neutral hadrons", "ET")),
    ("pfIsoPho", "photonIso", "float", _ISOLATION.format("photons", "ET")),
]
_ECAL_SHAPES = [
    ("sieie", "full5x5_sigmaIetaIeta", "float", "sigma ieta ieta of the supercluster, full 5x5"),
    ("hoe", "hadronicOverEm", "float", "H/E: hadronic over electromagnetic energy"),
    ("r9", "full5x5_r9", "float", "R9 of the supercluster, full 5x5: E(3x3) / E(supercluster)"),
]
# The HGCal objects have no isolation: their producers (not the GED ones) leave the sums at 0.
EGAMMA_ID = {"Electron": _ECAL_SHAPES + _ELECTRON_ID + _ELECTRON_ISOLATION, "ElectronHGC": _ELECTRON_ID,
             "Photon": _ECAL_SHAPES + _PHOTON_ID + _PHOTON_ISOLATION, "PhotonHGC": _PHOTON_ID}  # fmt: skip


def _egamma_id(name):
    """The ID columns of the table `name` (EGAMMA_ID) as text: lazyEval, as the table producer is of reco::Candidate."""
    out = ""
    for column, expression, kind, doc in EGAMMA_ID.get(name, []):
        kind = "bool" if kind is bool else f'"{kind}", precision=10' if kind == "float" else f'"{kind}"'
        out += f'\n        {column}=Var("{expression}", {kind}, lazyEval=True,\n            doc="{doc}"),'
    return out


# HGCal's shower shapes of its electrons and photons: the value maps PAT makes of them (RecoEgamma/EgammaTools,
# HGCalEgammaIDHelper), made here from the RECO collections. -1: not computed (no hits within 3 cm of the axis).
EGAMMA_HGCAL = {"sigmaUU": "spread across the shower's axis, along its larger width [cm]",
                "sigmaVV": "spread across the shower's axis, along its smaller width [cm]",
                "sigmaEE": "spread in eta", "sigmaPP": "spread in phi",
                "nLayers": "number of layers with energy", "firstLayer": "first layer with energy",
                "depthCompatibility": "shower depth compared with an electromagnetic shower's, in sigmas"}  # fmt: skip


def pf_candidates(w, pat=False):
    """The PF candidates (particleFlow), with their PUPPI weight and the rows of their track, GSF track and (but
    with `pat`, whose physics objects are PAT's) muon, electron and photon."""
    inv = w.inv
    if not inv.has("particleFlow", product_type="recoPFCandidates") or not w.need("SimplePFCandidateFlatTableProducer"):
        return
    w.pf = True
    # with the CMSSW branch's producer, the rows of the tracks, GSF tracks and muons are its own, checked against
    # the collection each reference points into; else the references' keys (they point into these collections)
    linked = pf_links(w, pat)
    links = [] if linked else [("trackIdx", "trackRef()", "GeneralTrack (generalTracks)")]
    links += [("gsfTrackIdx", "gsfTrackRef()", "GsfTrack (electronGsfTracks)")] * (w.gsf and not linked)
    for column, r, table, src, type_ in [
        *[("muonIdx", "muonRef()", "Muon", "muons", "recoMuons")] * (not linked),
        ("electronIdx", "gsfElectronRef()", "Electron", "gedGsfElectrons", "recoGsfElectrons"),
        ("photonIdx", "photonRef()", "Photon", "gedPhotons", "recoPhotons"),
    ]:
        if not pat and inv.has(src, product_type=type_):
            links.append((column, r, f"{table} ({src})"))
    links = "".join(f'\n        {c}=ref("{r}", "row in {t}; -1: none"),' for c, r, t in links)
    puppi = ""
    if inv.has("puppi", product_type="floatedmValueMap"):
        puppi = '\n    externalVariables=cms.PSet(puppiWeight=ExtVar("puppi", float, precision=8, doc="PUPPI weight")),'
    end = "?positionAtECALEntrance().R() > 0?positionAtECALEntrance().{}():0/0"
    w.add(
        f"""
# PF candidates (particleFlow; in Phase 2 it ends with the HGCal ones, pfTICL): a helix from the vertex to the ECAL
# entrance (NaN where there is none), and the rows of the objects they were made from
table("pfCandidateTable", cms.EDProducer("SimplePFCandidateFlatTableProducer", src=cms.InputTag("particleFlow"),
    name=cms.string("PFCandidates"), doc=cms.string("particleFlow"), cut=cms.string(""), singleton=cms.bool(False),
    extension=cms.bool(False), skipNonExistingSrc=cms.bool(True),{puppi}
    variables=cms.PSet(
        pt=Var("pt", "float", precision=10, doc="pt [GeV]"),
        eta=Var("eta", "float", precision=12, doc="pseudorapidity"),
        phi=Var("phi", "float", precision=12, doc="azimuth"),
        energy=Var("energy", "float", precision=10, doc="energy [GeV]"),
        pdgId=Var("pdgId", "int16", doc="particle type"),
        charge=Var("charge", "int16", doc="charge"),
        vx=Var("vx", "float", precision=14, doc="x of the vertex [cm]"),
        vy=Var("vy", "float", precision=14, doc="y of the vertex [cm]"),
        vz=Var("vz", "float", precision=14, doc="z of the vertex [cm]"),
        endX=Var("{end.format("x")}", "float", precision=14, doc="x at the ECAL entrance [cm]"),
        endY=Var("{end.format("y")}", "float", precision=14, doc="y at the ECAL entrance [cm]"),
        endZ=Var("{end.format("z")}", "float", precision=14, doc="z at the ECAL entrance [cm]"),
        ecalEnergy=Var("ecalEnergy", "float", precision=10, doc="ECAL energy [GeV]"),
        hcalEnergy=Var("hcalEnergy", "float", precision=10, doc="HCAL energy [GeV]"),
        time=Var("?isTimeValid()?time():-99", "float", precision=10, doc="time [ns]; -99: none"),{links}
    )))"""
        + linked
    )


def physics_objects(w, pat=False):
    """Physics objects from the RECO collections, named and laid out as in standard NanoAOD (a subset of its
    columns), so that the same profile draws a standard NanoAOD; with `pat`, standard NanoAOD has them, and only
    the beam spot's position (which its BeamSpot table lacks) is written here. No table takes a cut: index
    columns (e.g. of the PF candidates) address their rows in collection order; the viewer's pT cuts hide the soft
    ones (at 200 pileup, about 175 CHS jets, 118 taus and 43 muons per event).
    The rows of the objects an object was made from are index columns, from references (ref)."""
    inv, s, rows = w.inv, w.s, []
    names = {"ak4PFJetsPuppi": "Jet", "ak4PFJetsCHS": "JetCHS"}  # each collection its table (the profiles' names)
    jets = [(n, j) for j, n in names.items() if not pat and inv.has(j, product_type="recoPFJets")]
    jets = jets if jets and w.need("SimplePFJetFlatTableProducer") else []
    for name, src in jets:
        rows.append(f"""
table("{name[0].lower()}{name[1:]}Table", cms.EDProducer("SimplePFJetFlatTableProducer",
    src=cms.InputTag("{src}"), name=cms.string("{name}"), doc=cms.string("AK4 jets ({src}), uncorrected"),
    cut=cms.string(""), singleton=cms.bool(False), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True),
    variables=jetVariables))""")
    if rows:
        rows.insert(
            0,
            """
jetVariables = cms.PSet(kinematics,
    nConstituents=Var("nConstituents", "uint8", doc="number of constituents"),
    chHEF=Var("chargedHadronEnergyFraction", "float", precision=6, doc="charged hadron energy fraction"),
    neHEF=Var("neutralHadronEnergyFraction", "float", precision=6, doc="neutral hadron energy fraction"),
    chEmEF=Var("chargedEmEnergyFraction", "float", precision=6, doc="charged EM energy fraction"),
    neEmEF=Var("neutralEmEnergyFraction", "float", precision=6, doc="neutral EM energy fraction"),
    muEF=Var("muonEnergyFraction", "float", precision=6, doc="muon energy fraction"),
    x=Var("vx", "float", doc="x of the jet's vertex: the origin, without vertex correction [cm]"),
    y=Var("vy", "float", doc="y of the jet's vertex [cm]"),
    z=Var("vz", "float", doc="z of the jet's vertex [cm]"),
)""",
        )
    for label, name, src in () if pat else (("puppiMet", "PuppiMET", "pfMetPuppi"), ("pfMet", "PFMET", "pfMet")):
        if inv.has(src, product_type="recoPFMETs") and w.need("SimpleMETFlatTableProducer"):
            rows.append(f"""
table("{label}Table", cms.EDProducer("SimpleMETFlatTableProducer",
    src=cms.InputTag("{src}"), name=cms.string("{name}"), doc=cms.string("{src}"),
    singleton=cms.bool(True), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True),
    variables=cms.PSet(pt=Var("pt", "float", precision=10, doc="pt [GeV]"), phi=Var("phi", "float", precision=10,
        doc="phi"), sumEt=Var("sumEt", "float", precision=10, doc="scalar sum of Et [GeV]"))))""")
    taus = not pat and inv.has("hpsPFTauProducer", product_type="recoPFTaus")
    taus = taus and w.need("SimplePFTauCandidateFlatTableProducer")
    if taus:
        lead = (
            '\n        leadCandIdx=ref("leadChargedHadrCand()", "row in PFCandidates of the leading charged '
            'hadron; -1: none"),'
            if w.pf
            else ""
        )
        rows.append(f"""
table("tauTable", cms.EDProducer("SimplePFTauCandidateFlatTableProducer", src=cms.InputTag("hpsPFTauProducer"),
    name=cms.string("Tau"), doc=cms.string("hadronic taus (HPS, hpsPFTauProducer)"), cut=cms.string(""),
    singleton=cms.bool(False), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True),
    variables=cms.PSet(kinematics,
        charge=Var("charge", "int16", doc="charge"),
        decayMode=Var("decayMode", "int16", doc="decay mode (HPS)"),{lead}
    )))""")
    # Which supercluster table an electron's or photon's supercluster is in: the barrel PF superclusters are the
    # parents of the barrel (and Run 3 endcap) objects, whose own supercluster is a refined copy
    # (particleFlowEGamma); the HGCal objects' own supercluster is an HGCal one.
    sc = w.superclusters
    egamma = {
        "barrel": [("superClusterEBIdx", "?isEB()&&", "parentSuperCluster()", "SuperClusterEB")]
        + [("superClusterEEIdx", "?isEE()&&", "parentSuperCluster()", "SuperClusterEE")] * (not s.phase2),
        "hgcal": [("superClusterIdx", "?", "superCluster()", "SuperClusterHGCal")],
    }
    tracks = [("trackIdx", "closestCtfTrackRef()", "GeneralTrack (generalTracks)")]
    tracks += [("gsfTrackIdx", "gsfTrack()", "GsfTrack (electronGsfTracks)")] * w.gsf
    candidates = [
        ("electron", "Electron", "gedGsfElectrons", "recoGsfElectrons", "barrel", tracks),
        ("electronHGC", "ElectronHGC", "ecalDrivenGsfElectronsHGC", "recoGsfElectrons", "hgcal", tracks),
        ("photon", "Photon", "gedPhotons", "recoPhotons", "barrel", []),
        ("photonHGC", "PhotonHGC", "photonsHGC", "recoPhotons", "hgcal", []),
        ("muon", "Muon", "muons", "recoMuons", None, [("trackIdx", "innerTrack()", "GeneralTrack (inner track)")]
         + [(c, r, f"{n} ({src})") for n, src, r, c in muons.muon_tracks(w) if r]),
    ]  # fmt: skip
    for label, name, src, type_, region, refs in [] if pat else candidates:
        if inv.has(src, product_type=type_) and w.need("SimpleCandidateFlatTableProducer"):
            extra = (
                '\n        isGlobal=Var("isGlobalMuon", bool, doc="global muon"),'
                '\n        isTracker=Var("isTrackerMuon", bool, doc="tracker muon"),'
                '\n        isStandalone=Var("isStandAloneMuon", bool, doc="standalone muon"),'
                # where it starts: the reference point of the track it was made from (reco::Muon's vertex)
                + "".join(
                    f'\n        {c}=Var("v{c}", "float", doc="{c} of the reference point of the track the muon was '
                    f"made from (a global muon: the track its TeV refit chose; a tracker muon: the inner track; a "
                    f'standalone-only muon: the standalone track) [cm]"),'
                    for c in "xyz"
                )
                if name == "Muon"
                else ""
            )
            extra += "".join(f'\n        {c}=ref("{r}", "row in {t}; -1: none", lazy=True),' for c, r, t in refs)
            for column, test, r, table in egamma.get(region, []):
                if sc.get(table) in ("particleFlowSuperClusterECAL", "particleFlowSuperClusterHGCal"):
                    extra += (
                        f'\n        {column}=Var("{test}{r}.isNonnull()?{r}.key():-1", "int", lazyEval=True,'
                        f'\n            doc="row in {table}; -1: none"),'
                    )
            extra += _egamma_id(name)
            setup, shapes = hgcal_shapes(w, label, src) if region == "hgcal" else ("", "")
            rows.append(f"""{setup}
table("{label}Table", cms.EDProducer("SimpleCandidateFlatTableProducer", src=cms.InputTag("{src}"),
    name=cms.string("{name}"), doc=cms.string("{src}"), cut=cms.string(""), singleton=cms.bool(False),
    extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(kinematics,
        charge=Var("charge", "int16", doc="charge"),{extra}
    ){shapes}))""")
    rows += [constituents(w, jets, taus), jet_tags(w, jets)]
    if inv.has("offlineBeamSpot", product_type="recoBeamSpot") and w.need("SimpleBeamspotFlatTableProducer"):
        rows.append("""
table("beamSpotTable", cms.EDProducer("SimpleBeamspotFlatTableProducer", src=cms.InputTag("offlineBeamSpot"),
    name=cms.string("OfflineBeamSpot"), doc=cms.string("offline beam spot"), extension=cms.bool(False),
    variables=cms.PSet(
        x=Var("x0", "float", precision=14, doc="x [cm]"),
        y=Var("y0", "float", precision=14, doc="y [cm]"),
        z=Var("z0", "float", precision=14, doc="z [cm]"),
        sigmaZ=Var("sigmaZ", "float", precision=10, doc="width in z [cm]"),
        dxdz=Var("dxdz", "float", precision=10, doc="slope of the beam line, dx/dz"),
        dydz=Var("dydz", "float", precision=10, doc="slope of the beam line, dy/dz"),
        widthX=Var("BeamWidthX", "float", precision=10, doc="width in x [cm]"),
        widthY=Var("BeamWidthY", "float", precision=10, doc="width in y [cm]"),
        xErr=Var("x0Error", "float", precision=10, doc="uncertainty of x [cm]"),
        yErr=Var("y0Error", "float", precision=10, doc="uncertainty of y [cm]"),
        covXY=Var("covariance(0,1)", "float", precision=10, doc="covariance of x and y [cm2]"))))""")
    if not rows:
        return
    w.add(
        """
# Physics objects from the reconstruction (no PAT step), named and laid out as standard NanoAOD writes them (a few
# of its columns), uncut and in collection order
kinematics = cms.PSet(
    pt=Var("pt", "float", precision=10, doc="pt [GeV]"),
    eta=Var("eta", "float", precision=12, doc="pseudorapidity"),
    phi=Var("phi", "float", precision=12, doc="azimuth"),
    mass=Var("mass", "float", precision=10, doc="mass [GeV]"),
)"""
        + "".join(rows)
    )


def hgcal_shapes(w, label, src):
    """(setup, externalVariables) for the table `label` of the HGCal electrons or photons `src`: their shower
    shapes, from the value maps PAT makes of them (RecoEgamma/EgammaTools), made here; ("", "") without them."""
    kind = "Electron" if label.startswith("electron") else "Photon"
    plugin = f"HGCal{kind}IDValueMapProducer"
    sections = ("HGCEERecHits", "HGCHEFRecHits", "HGCHEBRecHits")  # the value maps read all three
    if not all(w.inv.has("HGCalRecHit", s) for s in sections) or not w.need(plugin, "RecHitMapProducer"):
        return "", ""
    module = f"hgc{kind}ID"
    setup = f"""
# HGCal's shower shapes of {src} (the value maps PAT makes, RecoEgamma/EgammaTools), from the HGCal rechits
from RecoEgamma.EgammaTools.hgcal{kind}IDValueMap_cff import hgcal{kind}IDValueMap
table("{module}", hgcal{kind}IDValueMap.clone({kind.lower()}s="{src}"))"""
    if not w.rechit_map:
        w.rechit_map = True
        setup = (
            """
from RecoLocalCalo.HGCalRecProducers.recHitMapProducer_cff import recHitMapProducer
table("recHitMapProducer", recHitMapProducer.clone())"""
            + setup
        )
    shapes = "".join(
        f'\n        {v}=ExtVar("{module}:{v}", float, precision=10, doc="HGCal shower: {doc}; -1: not computed"),'
        for v, doc in EGAMMA_HGCAL.items()
    )
    return setup, f",\n    externalVariables=cms.PSet({shapes}\n    )"


def pf_links(w, pat=False):
    """The PF candidates' rows of their track, GSF track, muon and TICL candidate, and their PF clusters (CMSSW
    branch nanoaod-pfcandidate-links), as text for pf_candidates(); "" without them."""
    if not w.branch(PF_LINKS, "the PF candidates' TICL candidates and PF clusters"):
        return ""
    inv = w.inv
    tag = lambda written, src: f'cms.InputTag("{src}")' if written else 'cms.InputTag("")'
    ticl = w.s.phase2 and inv.has("pfTICL", product_type="recoPFCandidates") and w.ticl
    blocks = inv.has("particleFlowBlock")  # the PF blocks hold the candidates' clusters (not in an AOD)
    if w.pf_clusters and not blocks:
        w.notes.append("the PF candidates' PF clusters: the input has no PF blocks (AOD)")
    clusters = "".join(
        f'\n        cms.PSet(src=cms.InputTag("{src}"), name=cms.string("PFCandidateClusters{name[9:]}"),'
        f' doc=cms.string("PF candidate <-> {src}")),'
        for name, src in w.pf_clusters * blocks
    )
    return f"""
# Their tracks, GSF tracks, muons and TICL candidates (the HGCal ones, pfTICL, one per TICL candidate), and their PF
# clusters from their PF blocks, one table of (candidate, cluster) pairs per collection (CMSSW branch
# nanoaod-pfcandidate-links)
table("pfCandidateLinkTable", cms.EDProducer("PFCandidateLinkTableProducer", src=cms.InputTag("particleFlow"),
    name=cms.string("PFCandidates"), tracks={tag("GeneralTrack" in w.written, "generalTracks")},
    gsfTracks={tag(w.gsf, "electronGsfTracks")},
    muons={tag(not pat and inv.has("muons", product_type="recoMuons"), "muons")},
    ticlCandidates={tag(ticl, "pfTICL")}, clusters=cms.VPSet({clusters}
    )))"""


def constituents(w, jets, taus):
    """The PF candidates of the RECO jets and taus (CMSSW branch nanoaod-reco-constituents), as text for physics():
    `jets` (table, collection) pairs, `taus` whether the tau table is written."""
    if not w.pf or not (jets or taus) or not w.branch(CONSTITUENTS, "the constituents of jets and taus"):
        return ""
    rows = [(f"{name}PFCands", "SimplePFJetConstituentTableProducer", src) for name, src in jets]
    rows += [("TauPFCands", "SimplePFTauConstituentTableProducer", "hpsPFTauProducer")] * taus
    return "\n# Their PF candidates (CMSSW branch nanoaod-reco-constituents): (object, PF candidate) pairs\n" + "".join(
        f'table("{name[0].lower()}{name[1:]}Table", cms.EDProducer("{plugin}", jets=cms.InputTag("{src}"),\n'
        f'    candidates=cms.InputTag("particleFlow"), name=cms.string("{name}"), candIdxName=cms.string("pfCandIdx"),\n'
        f'    candIdxDoc=cms.string("row in PFCandidates"), jetCut=cms.string(""), jetConstCut=cms.string("")))\n'
        for name, plugin, src in rows
    )


def jet_tags(w, jets):
    """The b-tags of the CHS jets (CMSSW branch nanoaod-jet-tags), as text for physics()."""
    chs = [name for name, src in jets if src == "ak4PFJetsCHS"]
    tags = [("btagDeepCSVB", ["pfDeepCSVJetTags:probb", "pfDeepCSVJetTags:probbb"]),
            ("btagJP", ["pfJetProbabilityBJetTags"])]  # fmt: skip
    tags = [(c, t) for c, t in tags if all(w.inv.has(*x.split(":")) for x in t)]
    if not chs or not tags or not w.branch(JET_TAGS, "the b-tags of the CHS jets"):
        return ""
    return f"""
# The b-tags of the CHS jets, the jets they are computed on (CMSSW branch nanoaod-jet-tags), extending their table
table("jetCHSTagTable", cms.EDProducer("JetTagTableProducer", src=cms.InputTag("ak4PFJetsCHS"), name=cms.string("{chs[0]}"),
    variables=cms.PSet({"".join(f'{chr(10)}        {c}=cms.PSet(src=cms.VInputTag({", ".join(repr(x) for x in t)}), doc=cms.string("{" + ".join(t)}"), precision=cms.int32(10)),' for c, t in tags)}
    )))"""
