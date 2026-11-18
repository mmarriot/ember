"""The cmsRun configuration ember writes for a reconstruction (EDM) file: one self-contained `ember_cfg.py`, made only
of modules of the user's CMSSW release, that writes the NanoAOD tables the profiles draw.

What goes in it depends on three things, each found here:
  - what the release has: its module plugins (plugins(), from edmPluginDump: 0.1 s, so it is not cached);
  - what the input holds: its products (products(), from the branch names of its Events tree);
  - the era family: Phase 2 (HGCal, TICL) or Run 3 (ECAL endcap and preshower, HCAL endcap).

A table whose producer the release lacks, or whose collection the input lacks, is left out, and the configuration's
header says so. Table names and columns follow the release's own NanoAOD producers (HGCalNanoAOD, TruthInfo,
standard NanoAOD), so that the profiles that read ember's NanoAOD also read the NanoAOD those flavours make.
"""

import subprocess
from collections import namedtuple

Product = namedtuple("Product", "type module instance process")


def plugins(prefix=(), env=None):
    """The names of the module plugins (EDProducers and others) of the CMSSW release that `prefix` / `env` set up
    (see export._environment): those of edmPluginDump's "CMS EDM Framework Module" category."""
    result = subprocess.run([*prefix, "edmPluginDump", "-a"], capture_output=True, text=True, env=env, check=False)
    return module_plugins(result.stdout)


def module_plugins(dump):
    """The module plugin names in the output of `edmPluginDump -a` (a "Category <name>:" line, then each plugin's
    name indented by two spaces and its library by three)."""
    names, inside = set(), False
    for line in dump.splitlines():
        if line.startswith("Category "):
            inside = line == "Category CMS EDM Framework Module:"
        elif inside and line.startswith("  ") and not line.startswith("   "):
            names.add(line.strip())
    return names


def products(branches):
    """The products of an EDM file from the names of its Events branches, <type>_<module>_<instance>_<process>. (none
    of the four has an underscore; other branches, such as EventAuxiliary, have none)."""
    return [Product(*parts) for parts in (b.rstrip(".").split("_") for b in branches) if len(parts) == 4]


class Inventory:
    """What the input holds, by module label and instance (of any process: the HLT's own products have labels of
    their own, and a simulation step named HLT also writes generator particles and the truth graph)."""

    def __init__(self, items, classes=None):
        self.items = list(items)
        self.classes = classes or {}  # branch name -> class of the product, where known

    def has(self, module, instance="", type=None):
        return any(
            p.module == module and p.instance == instance and (type is None or p.type == type) for p in self.items
        )

    def modules(self, type):
        """The module labels of the offline products of a type (no instance, not the HLT's), in file order."""
        return list(
            dict.fromkeys(
                p.module for p in self.items if p.type == type and p.instance == "" and not p.module.startswith("hlt")
            )
        )

    def soa(self):
        """The SoA (portable host) collections in the input."""
        return sorted({f"{p.module}" for p in self.items if "PortableHostCollection" in p.type})


Settings = namedtuple("Settings", "phase2 data era geometry conditions")
OUTPUT = "ember_nano.root"
CONFIG = "ember_cfg.py"

# Cluster -> hit tables (a hit count on the cluster table and a table of DetId and fraction): the producers of the
# CMSSW pull request "NanoAOD tables of the hits of calorimeter clusters", used once the release has them.
CLUSTER_HITS = {"CaloClusterHitsTableProducer", "PFClusterHitsTableProducer", "SuperClusterHitsTableProducer"}


def config(settings, inputs, events, inventory, release, threads=4, output=OUTPUT, made_by="", drop=()):
    """(the text of ember_cfg.py, the notes on what was left out). `inputs`: EDM file URLs (file:... or root://...),
    `events`: how many (None: all), `release`: the module plugins of the release (plugins()), `drop`: products of
    the input that the release cannot read (export.unreadable())."""
    w = _Writer(settings, inventory, release)
    w.header(inputs, made_by)
    w.process(inputs, events, threads, drop)
    if settings.phase2:
        w.hgcal()
    w.pf_rechits()
    w.clusters()
    w.tracks()
    w.physics()
    w.output(output)
    return w.text(), w.notes


class _Writer:
    """Builds the configuration text, section by section, and notes what it leaves out."""

    def __init__(self, settings, inventory, release):
        self.s, self.inv, self.release = settings, inventory, release
        self.parts, self.notes, self.loaded = [], [], set()
        self.cluster_hits = CLUSTER_HITS <= release

    def text(self):
        notes = "".join(f"#   - {n}\n" for n in self.notes) or "#   (nothing)\n"
        return "\n".join(self.parts).replace("#{NOTES}\n", notes)

    def add(self, text):
        self.parts.append(text.strip("\n") + "\n")

    def need(self, *plugins):
        """Whether the release has all these module plugins; a note if not."""
        missing = [p for p in plugins if p not in self.release]
        if missing:
            self.notes.append(f"this release has no {', '.join(missing)}")
        return not missing

    def header(self, inputs, made_by):
        s = self.s
        self.add(
            f"""
# The NanoAOD that Ember reads, from a CMSSW reconstruction file, with modules of this release only.
# Written by {made_by or "ember"}; keep it, change it, and run it again with: cmsRun {CONFIG}
# Then: ember convert {OUTPUT} -o NAME.ember
#
# {"Phase 2" if s.phase2 else "Run 3"} {"data" if s.data else "simulation"}: era {s.era}"""
            + (f", geometry {s.geometry}" if s.phase2 else ", geometry from the conditions")
            + f""", conditions {s.conditions}
# Left out (not in the input, or not in this release):
#{{NOTES}}
import FWCore.ParameterSet.Config as cms
from Configuration.Eras.Era_{s.era}_cff import {s.era}
from PhysicsTools.NanoAOD.common_cff import Var

process = cms.Process("EMBER", {s.era})
"""
        )

    def process(self, inputs, events, threads, drop=()):
        s = self.s
        geometry = (
            f"Configuration.Geometry.Geometry{s.geometry}Reco_cff"
            if s.phase2
            else "Configuration.StandardSequences.GeometryRecoDB_cff"
        )
        files = "".join(f'\n        "{f}",' for f in inputs)
        self.add(
            f"""
process.load("Configuration.StandardSequences.Services_cff")
process.load("FWCore.MessageService.MessageLogger_cfi")
process.MessageLogger.cerr.FwkReport.reportEvery = 10
process.load("{geometry}")
process.load("Configuration.StandardSequences.MagneticField_cff")
process.load("Configuration.StandardSequences.FrontierConditions_GlobalTag_cff")
from Configuration.AlCa.GlobalTag import GlobalTag
process.GlobalTag = GlobalTag(process.GlobalTag, "{s.conditions}", "")

process.source = cms.Source("PoolSource", fileNames=cms.untracked.vstring({files}
    ),
)
{self.dropped(drop)}process.maxEvents.input = {events if events else -1}
process.options.numberOfThreads = {threads}

# Every table producer goes in this task; the output module runs them as the tables are needed.
process.emberTables = cms.Task()


def table(label, module):
    setattr(process, label, module)
    process.emberTables.add(module)
"""
        )

    def dropped(self, drop):
        """The source's inputCommands that drop the products the release cannot read."""
        if not drop:
            return ""
        self.notes.append(
            f"{len(drop)} input product(s) whose class this release has no dictionary for (dropped on input): "
            + ", ".join(sorted({p.type for p in drop}))
        )
        commands = "".join(f'\n    "drop {"_".join(p)}",' for p in drop)
        return (
            "# Products of the input whose class this release has no dictionary for: cmsRun could not open the file.\n"
            "# What was made from them stays (by default the source would drop that too).\n"
            f'process.source.inputCommands = cms.untracked.vstring(\n    "keep *",{commands}\n)\n'
            "process.source.dropDescendantsOfDroppedBranches = cms.untracked.bool(False)\n"
        )

    # Calorimeter hits

    def hgcal(self):
        """HGCal rechits (TruthInfo, positions from TICLGeom), then the HGCalNanoAOD reconstruction tables."""
        if self.need("RecHitFlatTableProducer") and self.inv.has("HGCalRecHit", "HGCEERecHits"):
            self.add(
                """
# HGCal rechits of the three sections in one table "rechits": DetId, energy, time, position and the cell's half
# width (TICLGeom radius to side), from PhysicsTools/TruthInfo. TICLGeom is an alpaka EventSetup product: it needs
# the accelerator configuration, and its producer in the task.
process.load("Configuration.StandardSequences.Accelerators_cff")
process.load("RecoTICL.Geometry.TICLGeom_cff")
process.emberTables.add(process.ticlGeomESProducer)
process.load("PhysicsTools.TruthInfo.recHitTable_cfi")
process.emberTables.add(process.recHitTable)
"""
            )
        self.hgcal_reco()

    def hgcal_reco(self):
        inv = self.inv
        tracksters = inv.modules("ticlTracksters")
        plugins = ("TracksterCollectionTableProducer", "TICLCandidateTableProducer", "TICLCandidateExtraTableProducer")
        if not tracksters or not self.need(*plugins):
            if not tracksters:
                self.notes.append("TICL tracksters and candidates: the input has none")
            return
        soa = inv.soa()
        if soa:
            self.notes.append(
                f"the SoA collections {', '.join(soa)}: this release has no table producer for them (legacy tables "
                "are written)"
            )
        tables = "".join(
            f'table("{t}TracksterTable", process.ticlTrackstersCLUE3DHighTableProducer.clone(src="{t}", name="{t}", doc="{t}",\n'
            f'    variables=tracksterVariables, collectionVariables=dict(tracksterVertices=dict(name="{t}vertices",\n'
            f"    variables=dict(vertex_mult=dict(precision=8))))))\n"
            for t in tracksters
        )
        self.add(
            f"""
# HGCal reconstruction as NANO:@HGCAL writes it (DPGAnalysis/HGCalNanoAOD): layer clusters, a table per trackster
# collection of the input with its layer clusters (the release's table for CLUE3D, made for each collection), TICL
# candidates with their tracksters and tracks, general and GSF tracks (with their HGCal entry point, which needs the
# propagators).
process.load("DPGAnalysis.HGCalNanoAOD.HGCalNanoAOD_cff")
process.load("TrackingTools.MaterialEffects.MaterialPropagator_cfi")
process.load("TrackingTools.MaterialEffects.OppositeMaterialPropagator_cfi")
for label in ("hgcalLayerClustersTable", "hgcalLayerClustersExtraTable", "ticlCandidateTable", "ticlCandidateExtraTable",
              "generalTracksTable", "trackMuonTable", "gsfTracksTable"):
    process.emberTables.add(getattr(process, label))
# The tracksters with the columns drawn, named as HGCalNanoAOD names them (its eVector0_y is the axis's z, and
# eVector0_z its y)
tracksterVariables = cms.PSet(
    raw_energy=Var("raw_energy", "float", precision=12, doc="raw energy [GeV]"),
    barycenter_x=Var("barycenter.x", "float", precision=14, doc="barycenter x [cm]"),
    barycenter_y=Var("barycenter.y", "float", precision=14, doc="barycenter y [cm]"),
    barycenter_z=Var("barycenter.z", "float", precision=14, doc="barycenter z [cm]"),
    EV1=Var("eigenvalues()[0]", "float", precision=10, doc="PCA eigenvalue 0"),
    EV2=Var("eigenvalues()[1]", "float", precision=10, doc="PCA eigenvalue 1"),
    EV3=Var("eigenvalues()[2]", "float", precision=10, doc="PCA eigenvalue 2"),
    eVector0_x=Var("eigenvectors()[0].x", "float", precision=10, doc="principal axis, x"),
    eVector0_y=Var("eigenvectors()[0].z", "float", precision=10, doc="principal axis, z (as HGCalNanoAOD)"),
    eVector0_z=Var("eigenvectors()[0].y", "float", precision=10, doc="principal axis, y (as HGCalNanoAOD)"),
    time=Var("time", "float", precision=10, doc="time [ns]"),
)
# The layer clusters with the columns drawn (the release's table has eight more, at full precision)
process.hgcalLayerClustersTable.variables = cms.PSet(
    energy=Var("energy", "float", precision=12, doc="energy [GeV]"),
    position_x=Var("x", "float", precision=14, doc="x [cm]"),
    position_y=Var("y", "float", precision=14, doc="y [cm]"),
    position_z=Var("z", "float", precision=14, doc="z [cm]"),
)
{tables}"""
        )

    def pf_rechits(self):
        """ECAL and HCAL PF rechits (TruthInfo, positions from CaloGeometry), remade in the job if the input lacks
        them (RECO keeps only the cleaned-away ones)."""
        if not self.need("PFRecHitFlatTableProducer"):
            return
        s, inv = self.s, self.inv
        kinds = ["ECAL", "HBHE", "HF", "HO"] + ([] if s.phase2 else ["PS"])
        remade = [k for k in kinds if not inv.has(f"particleFlowRecHit{k}", type="recoPFRecHits")]
        tags = ", ".join(f'"particleFlowRecHit{k}"' for k in kinds)
        text = f"""
# ECAL and HCAL PF rechits (the hits above the particle-flow thresholds) in one table "pfrechits": DetId, energy,
# time, position (CaloGeometry), from PhysicsTools/TruthInfo. The converter splits it by subdetector.
process.pfRecHitTable = cms.EDProducer("PFRecHitFlatTableProducer", objName=cms.string("pfrechits"),
    label_rechits=cms.VInputTag({tags}))
process.emberTables.add(process.pfRecHitTable)
"""
        if remade:
            reco = "Reconstruction_Data_cff" if s.data else "Reconstruction_cff"
            text += f"""
# The input does not keep these PF rechits ({", ".join(remade)}): they are made again from its rechits, with the
# reconstruction's own producers (only those run).
process.load("Configuration.StandardSequences.{reco}")
for kind in {remade!r}:
    process.emberTables.add(getattr(process, "particleFlowRecHit" + kind))
"""
        self.add(text)

    # Clusters

    def clusters(self):
        """PF clusters and superclusters, and the hits of every kind of cluster (once the release has the producers)."""
        s, inv = self.s, self.inv
        rows = []  # (label, plugin, table, src, hits plugin)
        for d in ["ECAL", "HCAL", "HF", "HO"] + ([] if s.phase2 else ["PS"]):
            if inv.has(f"particleFlowCluster{d}"):
                rows.append(
                    (
                        f"pfCluster{d}",
                        "LayerClustersCollectionTableProducer",
                        f"PFCluster{d}",
                        f"particleFlowCluster{d}",
                        "PFClusterHitsTableProducer",
                    )
                )
        superclusters = [
            ("superClusterEB", "SuperClusterEB", "particleFlowSuperClusterECAL", "particleFlowSuperClusterECALBarrel"),
            (
                "superClusterEE",
                "SuperClusterEE",
                "particleFlowSuperClusterECAL",
                "particleFlowSuperClusterECALEndcapWithPreshower",
            ),
            ("superClusterHGCal", "SuperClusterHGCal", "particleFlowSuperClusterHGCal", ""),
            ("superClusterHGCal", "SuperClusterHGCal", "ticlEGammaSuperClusters", ""),
        ]
        seen = set()
        for label, name, module, instance in superclusters:
            if label not in seen and inv.has(module, instance, "recoSuperClusters"):
                seen.add(label)
                src = f"{module}:{instance}" if instance else module
                rows.append((label, "SimpleSuperclusterFlatTableProducer", name, src, "SuperClusterHitsTableProducer"))
        if not rows or not self.need("LayerClustersCollectionTableProducer", "SimpleSuperclusterFlatTableProducer"):
            return
        text = """
# PF clusters (HGCalNanoAOD's table producer of reco::CaloCluster collections) and superclusters (standard NanoAOD's
# supercluster producer): energy and position.
pfClusterVariables = cms.PSet(
    energy=Var("energy", "float", precision=12, doc="energy [GeV]"),
    x=Var("x", "float", precision=14, doc="x [cm]"),
    y=Var("y", "float", precision=14, doc="y [cm]"),
    z=Var("z", "float", precision=14, doc="z [cm]"),
    nHits=Var("size", "uint16", doc="number of hits"),
)
superClusterVariables = cms.PSet(pfClusterVariables,
    rawEnergy=Var("rawEnergy", "float", precision=12, doc="raw energy [GeV]"),
    eta=Var("eta", "float", precision=12, doc="pseudorapidity of the position"),
    phi=Var("phi", "float", precision=12, doc="azimuth of the position"),
    etaWidth=Var("etaWidth", "float", precision=10, doc="eta width"),
    phiWidth=Var("phiWidth", "float", precision=10, doc="phi width"),
    nClusters=Var("clustersSize", "uint16", doc="number of clusters"),
)
superClusterVariables.nHits = Var("size", "uint16", doc="number of clusters")
superClusterVariables.x = Var("position().x()", "float", precision=14, doc="x [cm]")
superClusterVariables.y = Var("position().y()", "float", precision=14, doc="y [cm]")
superClusterVariables.z = Var("position().z()", "float", precision=14, doc="z [cm]")
"""
        for label, plugin, name, src, _ in rows:
            variables = "superClusterVariables" if "Super" in plugin else "pfClusterVariables"
            text += (
                f'table("{label}Table", cms.EDProducer("{plugin}", src=cms.InputTag("{src}"), name=cms.string("{name}"),\n'
                f'    doc=cms.string("{src}"), cut=cms.string(""), singleton=cms.bool(False), extension=cms.bool(False),\n'
                f"    skipNonExistingSrc=cms.bool(True), variables={variables}))\n"
            )
        if self.s.phase2 and inv.has("hgcalMergeLayerClusters"):
            rows.append(
                (
                    "hgcalLayerClusters",
                    None,
                    "HGCalLayerClusters",
                    "hgcalMergeLayerClusters",
                    "CaloClusterHitsTableProducer",
                )
            )
        if self.cluster_hits:
            text += """
# The hits of each cluster (the same source as its table, no cut): a count on the cluster table (n<Name>Hits) and a
# table <Name>Hits of DetId and fraction, one row per (cluster, hit). The converter finds each hit by its DetId.
"""
            for label, _, name, src, hits in rows:
                text += (
                    f'table("{label}Hits", cms.EDProducer("{hits}", src=cms.InputTag("{src}"), name=cms.string("{name}"),\n'
                    f'    hitsName=cms.string("{name}Hits"), precision=cms.int32(8), skipNonExistingSrc=cms.bool(True)))\n'
                )
        else:
            self.notes.append(
                "the hits of clusters: this release has no " + ", ".join(sorted(CLUSTER_HITS)) + " (in CMSSW after "
                "the pull request 'NanoAOD tables of the hits of calorimeter clusters')"
            )
        self.add(text)

    # Tracks and physics objects

    def tracks(self):
        """General tracks: HGCalNanoAOD's table (Phase 2: its TICL candidates extend it with their HGCal entry point),
        with the columns the profiles draw, and their outermost position."""
        if not self.inv.has("generalTracks", type="recoTracks") or not self.need("SimpleTrackFlatTableProducer"):
            return
        text = """
# General tracks, in the table NANO:@HGCAL writes (DPGAnalysis/HGCalNanoAOD), with the columns drawn: a helix from
# the reference point with the momentum, to the outermost hit (from the track extra)
"""
        if not self.s.phase2:
            text += """from DPGAnalysis.HGCalNanoAOD.hgcalGeneralTracks_cfi import generalTracksTable
table("generalTracksTable", generalTracksTable.clone())
"""
        self.add(
            text
            + """process.generalTracksTable.variables = cms.PSet(
    pt=Var("pt", "float", precision=12, doc="pt [GeV]"),
    eta=Var("eta", "float", precision=12, doc="pseudorapidity"),
    phi=Var("phi", "float", precision=12, doc="azimuth"),
    charge=Var("charge", "int16", doc="charge"),
    vx=Var("vx", "float", precision=14, doc="x of the reference point [cm]"),
    vy=Var("vy", "float", precision=14, doc="y of the reference point [cm]"),
    vz=Var("vz", "float", precision=14, doc="z of the reference point [cm]"),
    outerX=Var("outerX", "float", precision=14, doc="x of the outermost hit [cm]"),
    outerY=Var("outerY", "float", precision=14, doc="y of the outermost hit [cm]"),
    outerZ=Var("outerZ", "float", precision=14, doc="z of the outermost hit [cm]"),
    nhits=Var("numberOfValidHits", "uint8", doc="number of valid hits"),
    highPurity=Var("quality('highPurity')", bool, doc="high-purity track"),
)
"""
        )

    def physics(self):
        """Physics objects from the RECO collections, named and laid out as in standard NanoAOD (a subset of its
        columns), so that the same profile draws a standard NanoAOD."""
        inv = self.inv
        jets = next((j for j in ("ak4PFJetsPuppi", "ak4PFJetsCHS") if inv.has(j, type="recoPFJets")), None)
        rows = []
        if jets and self.need("SimplePFJetFlatTableProducer"):
            rows.append(f"""
table("jetTable", cms.EDProducer("SimplePFJetFlatTableProducer", src=cms.InputTag("{jets}"), name=cms.string("Jet"),
    doc=cms.string("AK4 jets ({jets}), uncorrected"), cut=cms.string("pt > 10"), singleton=cms.bool(False),
    extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(kinematics,
        nConstituents=Var("nConstituents", "uint8", doc="number of constituents"),
        chHEF=Var("chargedHadronEnergyFraction", "float", precision=6, doc="charged hadron energy fraction"),
        neHEF=Var("neutralHadronEnergyFraction", "float", precision=6, doc="neutral hadron energy fraction"),
        chEmEF=Var("chargedEmEnergyFraction", "float", precision=6, doc="charged EM energy fraction"),
        neEmEF=Var("neutralEmEnergyFraction", "float", precision=6, doc="neutral EM energy fraction"),
        muEF=Var("muonEnergyFraction", "float", precision=6, doc="muon energy fraction"),
    )))""")
        for label, name, src in (("puppiMet", "PuppiMET", "pfMetPuppi"), ("pfMet", "PFMET", "pfMet")):
            if inv.has(src, type="recoPFMETs") and self.need("SimpleMETFlatTableProducer"):
                rows.append(f"""
table("{label}Table", cms.EDProducer("SimpleMETFlatTableProducer", src=cms.InputTag("{src}"), name=cms.string("{name}"),
    doc=cms.string("{src}"), singleton=cms.bool(True), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True),
    variables=cms.PSet(pt=Var("pt", "float", precision=10, doc="pt [GeV]"), phi=Var("phi", "float", precision=10,
        doc="phi"), sumEt=Var("sumEt", "float", precision=10, doc="scalar sum of Et [GeV]"))))""")
        candidates = [
            ("electron", "Electron", "gedGsfElectrons", "recoGsfElectrons", "pt > 5"),
            ("electronHGC", "ElectronHGC", "ecalDrivenGsfElectronsHGC", "recoGsfElectrons", "pt > 5"),
            ("photon", "Photon", "gedPhotons", "recoPhotons", "pt > 10"),
            ("photonHGC", "PhotonHGC", "photonsHGC", "recoPhotons", "pt > 10"),
            ("muon", "Muon", "muons", "recoMuons", "pt > 3"),
        ]
        for label, name, src, type_, cut in candidates:
            if inv.has(src, type=type_) and self.need("SimpleCandidateFlatTableProducer"):
                muon = (
                    '\n        isGlobal=Var("isGlobalMuon", bool, doc="global muon"),'
                    '\n        isTracker=Var("isTrackerMuon", bool, doc="tracker muon"),'
                    '\n        isStandalone=Var("isStandAloneMuon", bool, doc="standalone muon"),'
                    if name == "Muon"
                    else ""
                )
                rows.append(f"""
table("{label}Table", cms.EDProducer("SimpleCandidateFlatTableProducer", src=cms.InputTag("{src}"),
    name=cms.string("{name}"), doc=cms.string("{src}"), cut=cms.string("{cut}"), singleton=cms.bool(False),
    extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(kinematics,
        charge=Var("charge", "int16", doc="charge"),{muon}
    )))""")
        if inv.has("offlinePrimaryVertices", type="recoVertexs") and self.need("SimpleVertexFlatTableProducer"):
            rows.append("""
table("pvTable", cms.EDProducer("SimpleVertexFlatTableProducer", src=cms.InputTag("offlinePrimaryVertices"),
    name=cms.string("PV"), doc=cms.string("the leading primary vertex"), cut=cms.string(""), maxLen=cms.uint32(1),
    singleton=cms.bool(False), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(position,
        ndof=Var("ndof", "float", precision=8, doc="number of degrees of freedom"),
        chi2=Var("normalizedChi2", "float", precision=8, doc="chi2 / ndof"),
        ntracks=Var("tracksSize", "uint16", doc="number of tracks"))))""")
        if inv.has("inclusiveSecondaryVertices", type="recoVertexs") and self.need("SimpleVertexFlatTableProducer"):
            rows.append("""
table("svTable", cms.EDProducer("SimpleVertexFlatTableProducer", src=cms.InputTag("inclusiveSecondaryVertices"),
    name=cms.string("SV"), doc=cms.string("inclusive secondary vertices"), cut=cms.string(""),
    singleton=cms.bool(False), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(position,
        ntracks=Var("tracksSize", "uint16", doc="number of tracks"))))""")
        if inv.has("offlineBeamSpot", type="recoBeamSpot") and self.need("SimpleBeamspotFlatTableProducer"):
            rows.append("""
table("beamSpotTable", cms.EDProducer("SimpleBeamspotFlatTableProducer", src=cms.InputTag("offlineBeamSpot"),
    name=cms.string("BeamSpot"), doc=cms.string("offline beam spot"), extension=cms.bool(False),
    variables=cms.PSet(
        x=Var("x0", "float", precision=14, doc="x [cm]"),
        y=Var("y0", "float", precision=14, doc="y [cm]"),
        z=Var("z0", "float", precision=14, doc="z [cm]"),
        sigmaZ=Var("sigmaZ", "float", precision=10, doc="width in z [cm]"))))""")
        if not rows:
            return
        self.add(
            """
# Physics objects from the reconstruction (no PAT step), named and laid out as standard NanoAOD writes them (a few
# of its columns)
kinematics = cms.PSet(
    pt=Var("pt", "float", precision=10, doc="pt [GeV]"),
    eta=Var("eta", "float", precision=12, doc="pseudorapidity"),
    phi=Var("phi", "float", precision=12, doc="azimuth"),
    mass=Var("mass", "float", precision=10, doc="mass [GeV]"),
)
position = cms.PSet(
    x=Var("x", "float", precision=14, doc="x [cm]"),
    y=Var("y", "float", precision=14, doc="y [cm]"),
    z=Var("z", "float", precision=14, doc="z [cm]"),
)"""
            + "".join(rows)
        )

    def output(self, output):
        self.add(
            f"""
# The output: every table of this process. LZ4 is quick to write and to read back, and the file is temporary.
process.output = cms.OutputModule("NanoAODOutputModule", fileName=cms.untracked.string("{output}"),
    outputCommands=cms.untracked.vstring("drop *", "keep nanoaodFlatTable_*_*_EMBER"),
    compressionAlgorithm=cms.untracked.string("LZ4"), compressionLevel=cms.untracked.int32(4))
process.end = cms.EndPath(process.output, process.emberTables)
"""
        )
