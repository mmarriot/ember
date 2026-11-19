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

import re
import textwrap
from collections import namedtuple

from . import Problem

Product = namedtuple("Product", "type module instance process")


def plugins(prefix=(), env=None):
    """The names of the module plugins (EDProducers and others) of the CMSSW release that `prefix` / `env` set up
    (see export._environment): those of edmPluginDump's "CMS EDM Framework Module" category."""
    from .export import cmssw_output

    names = module_plugins(cmssw_output([*prefix, "edmPluginDump", "-a"], env, "listing the release's plugins"))
    if not names:
        raise Problem("edmPluginDump lists no module plugins: run cmsenv in this shell, in a CMSSW release area")
    return names


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


def is_product(branch):
    """Whether an Events branch holds a product: <type>_<module>_<instance>_<process>. (none of the four has an
    underscore; other branches, such as EventAuxiliary, have none)."""
    return len(branch.rstrip(".").split("_")) == 4


def products(branches):
    """The products of an EDM file from the names of its Events branches (is_product)."""
    return [Product(*b.rstrip(".").split("_")) for b in branches if is_product(b)]


class Inventory:
    """What the input holds, by module label and instance (of any process: the HLT's own products have labels of
    their own, and a simulation step named HLT also writes generator particles and the truth graph)."""

    def __init__(self, items, classes=None):
        self.items = list(items)
        self.classes = classes or {}  # branch name -> class of the product, where known

    def has(self, module, instance="", product_type=None):
        return any(p.module == module and p.instance == instance and product_type in (None, p.type) for p in self.items)

    def modules(self, product_type):
        """The module labels of the offline products of a type (no instance, not the HLT's), in file order."""
        offline = (p.module for p in self.items if p.type == product_type and not p.instance)
        return list(dict.fromkeys(m for m in offline if not m.startswith("hlt")))

    def soa(self):
        """The SoA (portable host) collections in the input."""
        return sorted({f"{p.module}" for p in self.items if "PortableHostCollection" in p.type})


Settings = namedtuple("Settings", "phase2 data era geometry conditions")
OUTPUT = "ember_nano.root"
CONFIG = "ember_cfg.py"

# Cluster -> hit tables (a hit count on the cluster table and a table of DetId and fraction): the producers of the
# CMSSW branch mmarriot:nanoaod-cluster-hits (git cms-merge-topic), used once the release has them.
CLUSTER_HITS = {"CaloClusterHitsTableProducer", "PFClusterHitsTableProducer", "SuperClusterHitsTableProducer"}

# The generic NanoAOD table producers of the other CMSSW branches (git cms-merge-topic mmarriot:<branch>, or all of
# them with mmarriot:nanoaod-reco-tables-all), each used once the release has its plugins: branch -> plugins.
ALL = "nanoaod-reco-tables-all"
CALO_RECHITS = "nanoaod-calo-rechits"
TRACK_HITS = "nanoaod-track-hits"
VERTEX_TRACKS = "nanoaod-vertex-tracks"
PF_LINKS = "nanoaod-pfcandidate-links"
CONSTITUENTS = "nanoaod-reco-constituents"
JET_TAGS = "nanoaod-jet-tags"
MTD_RECHITS = "nanoaod-mtd-rechits"
MUON_RECHITS = "muontools-rechits-chambers"
MUON_TRACK_LINKS = "nanoaod-muon-track-links"
BRANCHES = {
    CALO_RECHITS: {"EcalRecHitTableProducer", "HBHERecHitTableProducer", "HFRecHitTableProducer",
                   "HORecHitTableProducer"},
    TRACK_HITS: {"TrackHitsTableProducer"},
    VERTEX_TRACKS: {"VertexTrackTableProducer"},
    PF_LINKS: {"PFCandidateLinkTableProducer"},
    CONSTITUENTS: {"SimplePFJetConstituentTableProducer", "SimplePFTauConstituentTableProducer"},
    JET_TAGS: {"JetTagTableProducer"},
    MTD_RECHITS: {"MTDRecHitTableProducer"},
    MUON_RECHITS: {"DTRecHitFlatTableProducer", "CSCRecHitFlatTableProducer", "MuChamberTableProducer",
                   "MuDTSegmentMatchTableProducer", "MuCSCSegmentMatchTableProducer", "MuGEMSegmentMatchTableProducer"},
    MUON_TRACK_LINKS: {"MuonTrackLinkTableProducer"},
}  # fmt: skip


def config(
    settings, inputs, events, inventory, release, threads=4, output=OUTPUT, made_by="", drop=(), pat=False,
    associators=True, truth_maps=None,
):  # fmt: skip
    """(the text of ember_cfg.py, the notes on what was left out). `inputs`: EDM file URLs (file:... or root://...),
    `events`: how many (None: all), `release`: the module plugins of the release (plugins()), `drop`: products of
    the input that the release cannot read (export.unreadable()). `pat`: the text is the part to append to the
    configuration of `cmsDriver.py -s PAT,NANO --processName EMBER` (export.cmsdriver), whose standard NanoAOD has the
    physics objects: ember's tables of everything else, written in that job's NanoAOD. `associators`: run the
    truth associators when the input holds no association maps of its own (truth()); `truth_maps`: the release's reco <-> truth association tables and the maps they read
    (export.truth_maps())."""
    w = _Writer(settings, inventory, release)
    w.header(inputs, made_by, pat)
    w.process(inputs, events, threads, drop, pat)
    if settings.phase2:
        w.hgcal()
    if not w.calo_rechits():
        w.pf_rechits(pat)
    w.clusters()
    w.tracks()
    w.vertices(pat)
    w.pf_candidates(pat)
    w.physics(pat)
    w.muon_system(pat)
    w.track_hits()
    if not pat:
        w.muon_track_links()
    w.mtd_rechits()
    w.truth(associators, truth_maps or {}, set(drop), pat)
    w.output(output, pat)
    return w.text(), w.notes


class _Writer:
    """Builds the configuration text, section by section, and notes what it leaves out."""

    def __init__(self, settings, inventory, release):
        self.s, self.inv, self.release = settings, inventory, release
        self.parts, self.notes = [], []
        self.hgcal_nano = False  # whether DPGAnalysis/HGCalNanoAOD's tables are loaded (layer clusters, tracks)
        self.cluster_hits = CLUSTER_HITS <= release
        self.hit_tables = {}  # hit table module -> (name of its truth table, its DetId column)
        self.track_tables = []  # (track table, its collection) of the tables whose hits are written (track_hits)
        self.written = set()  # the tables written that other tables point into (see where they are added)
        self.ticl = False  # whether the TICL candidate table is written
        self.pf_clusters = []  # (table, collection) of the PF cluster tables written
        self.gsf = False  # whether the GSF track table is written (electrons and PF candidates point into it)
        self.pf = False  # whether the PF candidate table is written (taus point into it)
        self.superclusters = {}  # supercluster table -> module of its collection

    def text(self):
        wrap = lambda n: textwrap.fill(
            n, 116, initial_indent="#   - ", subsequent_indent="#     ", break_on_hyphens=False
        )
        notes = "".join(wrap(n) + "\n" for n in self.notes) or "#   (nothing)\n"
        return "\n".join(self.parts).replace("#{NOTES}\n", notes)

    def add(self, text):
        self.parts.append(text.strip("\n") + "\n")

    def branch(self, name, what):
        """Whether the release has the producers of the CMSSW branch `name`; a note on `what` is left out if not."""
        missing = sorted(BRANCHES[name] - self.release)
        if missing:
            self.notes.append(
                f"{what}: this release has no {', '.join(missing)} (add them with git cms-merge-topic mmarriot:{name}, "
                f"or every table at once with git cms-merge-topic mmarriot:{ALL})"
            )
        return not missing

    def need(self, *plugins):
        """Whether the release has all these module plugins; a note if not."""
        missing = [p for p in plugins if p not in self.release]
        note = f"this release has no {', '.join(missing)}"
        if missing and note not in self.notes:
            self.notes.append(note)
        return not missing

    def header(self, inputs, made_by, pat=False):
        s = self.s
        if pat:
            self.add(
                f"""

# ---- Ember's tables, after the PAT + standard NANO configuration above (cmsDriver.py -s PAT,NANO). Added by
# {made_by or "ember"}: hits, clusters, HGCal, tracks; the physics objects are standard NanoAOD's.
# Left out (not in the input, or not in this release):
#{{NOTES}}
from PhysicsTools.NanoAOD.common_cff import ExtVar, Var
"""
            )
            return
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
from PhysicsTools.NanoAOD.common_cff import ExtVar, Var

process = cms.Process("EMBER", {s.era})
"""
        )

    def process(self, inputs, events, threads, drop=(), pat=False):
        s = self.s
        tables = """
# Every table producer goes in this task; the output module runs them as the tables are needed.
process.emberTables = cms.Task()


def table(label, module):
    setattr(process, label, module)
    process.emberTables.add(module)


# An index column: the row of the object that the reference r points to (its key in its collection, which its table
# keeps in order), -1 if none. lazy: for a method of the collection's own class, on a table producer of a base class
# (reco::Candidate).
def ref(r, doc, lazy=False):
    return Var(f"?{r}.isNonnull()?{r}.key():-1", "int", doc=doc, lazyEval=lazy)
"""
        if pat:
            self.add(self.dropped(drop) + tables)
            return
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
{tables}"""
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
# HGCal rechits of the three sections in one table "rechits": DetId, energy, time, position, from
# PhysicsTools/TruthInfo (also a "radius", TICLGeom's radius to side: sqrt(3) x the apothem for silicon, FLT_MAX for
# scintillator; the converter sizes cells from the DetId instead). TICLGeom is an alpaka EventSetup product: it
# needs the accelerator configuration, and its producer in the task.
process.load("Configuration.StandardSequences.Accelerators_cff")
process.load("RecoTICL.Geometry.TICLGeom_cff")
process.emberTables.add(process.ticlGeomESProducer)
process.load("PhysicsTools.TruthInfo.recHitTable_cfi")
process.emberTables.add(process.recHitTable)
"""
            )
            self.hit_tables["recHitTable"] = ("TruthHGCalRecHits", "rechit_ID")
        self.hgcal_reco()

    def hgcal_reco(self):
        """DPGAnalysis/HGCalNanoAOD's tables: layer clusters if the input has them, one table per trackster collection
        of the input, TICL candidates if it has tracksters. Its track table is scheduled by tracks()."""
        inv = self.inv
        tracksters = inv.modules("ticlTracksters")
        layer_clusters = inv.has("hgcalMergeLayerClusters")
        if not tracksters:
            self.notes.append("TICL tracksters and candidates: the input has none")
        plugins = ["LayerClustersCollectionTableProducer"] * layer_clusters + [
            "TracksterCollectionTableProducer", "TICLCandidateTableProducer", "TICLCandidateExtraTableProducer"
        ] * bool(tracksters)  # fmt: skip
        if not plugins or not self.need(*plugins):
            return
        self.hgcal_nano = True
        soa = inv.soa()
        if soa:
            self.notes.append(
                f"the SoA collections {', '.join(soa)}: this release has no table producer for them (legacy tables "
                "are written)"
            )
        labels = ["hgcalLayerClustersTable", "hgcalLayerClustersExtraTable"] * layer_clusters
        labels += ["ticlCandidateTable", "ticlCandidateExtraTable"] * bool(tracksters)
        self.ticl = bool(tracksters)
        text = f"""
# HGCal reconstruction as NANO:@HGCAL writes it (DPGAnalysis/HGCalNanoAOD): layer clusters, a table per trackster
# collection of the input with its layer clusters (the release's table for CLUE3D, made for each collection), TICL
# candidates with their tracksters and tracks (their HGCal entry point needs the propagators).
process.load("DPGAnalysis.HGCalNanoAOD.HGCalNanoAOD_cff")
process.load("TrackingTools.MaterialEffects.MaterialPropagator_cfi")
process.load("TrackingTools.MaterialEffects.OppositeMaterialPropagator_cfi")
for label in [{"".join(f"{chr(10)}    {label!r}," for label in labels)}
]:
    process.emberTables.add(getattr(process, label))
"""
        if layer_clusters:
            text += """# The layer clusters with the columns drawn (the release's table has eight more, at full precision)
process.hgcalLayerClustersTable.variables = cms.PSet(
    energy=Var("energy", "float", precision=12, doc="energy [GeV]"),
    position_x=Var("x", "float", precision=14, doc="x [cm]"),
    position_y=Var("y", "float", precision=14, doc="y [cm]"),
    position_z=Var("z", "float", precision=14, doc="z [cm]"),
)
"""
        if tracksters:
            text += """# The tracksters with the columns drawn, named as HGCalNanoAOD names them (its eVector0_y is the axis's z, and
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
tracksterTable = process.ticlTrackstersCLUE3DHighTableProducer
"""
            text += "".join(
                f'table("{t}TracksterTable", tracksterTable.clone(\n'
                f'    src="{t}", name="{t}", doc="{t}",\n'
                f"    variables=tracksterVariables, collectionVariables=dict(tracksterVertices=dict(\n"
                f'        name="{t}vertices", variables=dict(vertex_mult=dict(precision=8))))))\n'
                for t in tracksters
            )
        self.add(text)

    def pf_rechits(self, pat=False):
        """ECAL and HCAL PF rechits (TruthInfo, positions from CaloGeometry), remade in the job if the input lacks
        them (RECO keeps only the cleaned-away ones)."""
        if not self.need("PFRecHitFlatTableProducer"):
            return
        s, inv = self.s, self.inv
        kinds = ["ECAL", "HBHE", "HF", "HO"] + ([] if s.phase2 else ["PS"])
        remade = [k for k in kinds if not inv.has(f"particleFlowRecHit{k}", product_type="recoPFRecHits")]
        # what remaking each needs (an AOD has only the reduced rechit collections)
        sources = {"ECAL": [("ecalRecHit", "EcalRecHitsEB")], "PS": [("ecalPreshowerRecHit", "EcalRecHitsES")],
                   "HBHE": [("hbhereco", "")], "HF": [("hfreco", "")], "HO": [("horeco", "")]}  # fmt: skip
        lacking = [k for k in remade if not all(inv.has(*src) for src in sources[k])]
        if lacking:
            self.notes.append(
                f"PF rechits {', '.join(lacking)}: the input has neither them nor the rechits to remake them"
            )
        kinds = [k for k in kinds if k not in lacking]
        remade = [k for k in remade if k not in lacking]
        if not kinds:
            return
        tags = "".join(f'\n    "particleFlowRecHit{k}",' for k in kinds)
        text = f"""
# ECAL and HCAL PF rechits (the hits above the particle-flow thresholds) in one table "pfrechits": DetId, energy,
# time, position (CaloGeometry), from PhysicsTools/TruthInfo. The converter splits it by subdetector.
process.pfRecHitTable = cms.EDProducer("PFRecHitFlatTableProducer", objName=cms.string("pfrechits"),
    label_rechits=cms.VInputTag({tags}
))
process.emberTables.add(process.pfRecHitTable)
"""
        self.hit_tables["pfRecHitTable"] = ("TruthPFRecHits", "rechit_ID")
        if remade:
            reco = "Reconstruction_Data_cff" if s.data else "Reconstruction_cff"
            if pat:
                text += f"""
# The input does not keep these PF rechits ({", ".join(remade)}): they are made again from its rechits, with the
# reconstruction's own producers. Its configuration is read into a process of its own and only what this one lacks
# is taken (the producers they need, the parameter sets those name, and their EventSetup): loading it here would
# redefine PAT's modules.
from Configuration.Eras.Era_{s.era}_cff import {s.era} as recoEra
reco = cms.Process("RECO", recoEra)
reco.load("Configuration.StandardSequences.Accelerators_cff")  # its EventSetup has alpaka producers
reco.load("Configuration.StandardSequences.{reco}")
missing = {{**reco.producers_(), **reco.psets_(), **reco.vpsets_(), **reco.es_producers_(), **reco.es_sources_()}}
for name, item in {{**missing, **reco.es_prefers_(), **reco.processAccelerators_()}}.items():
    if not hasattr(process, name):
        setattr(process, name, item)
for kind in {remade!r}:
    process.emberTables.add(getattr(process, "particleFlowRecHit" + kind))
"""
                self.add(text)
                return
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
        rows = []  # (label, table producer, table, src, hits producer)
        for d in ["ECAL", "HCAL", "HF", "HO"] + ([] if s.phase2 else ["PS"]):
            if inv.has(f"particleFlowCluster{d}"):
                plugins = ("LayerClustersCollectionTableProducer", "PFClusterHitsTableProducer")
                rows.append((f"pfCluster{d}", *plugins[:1], f"PFCluster{d}", f"particleFlowCluster{d}", plugins[1]))
        superclusters = [
            ("superClusterEB", "SuperClusterEB", "particleFlowSuperClusterECAL:particleFlowSuperClusterECALBarrel"),
            ("superClusterHGCal", "SuperClusterHGCal", "particleFlowSuperClusterHGCal"),
            ("superClusterHGCal", "SuperClusterHGCal", "ticlEGammaSuperClusters"),
        ]
        if not s.phase2:  # Phase 2 has no ECAL endcap (its endcap collection is always empty)
            ecal = "particleFlowSuperClusterECAL:particleFlowSuperClusterECALEndcapWithPreshower"
            superclusters.insert(1, ("superClusterEE", "SuperClusterEE", ecal))
        for label, name, src in superclusters:
            module, _, instance = src.partition(":")
            if label not in {r[0] for r in rows} and inv.has(module, instance, "recoSuperClusters"):
                plugins = ("SimpleSuperclusterFlatTableProducer", "SuperClusterHitsTableProducer")
                rows.append((label, plugins[0], name, src, plugins[1]))
        rows = [r for r in rows if self.need(r[1])]
        self.superclusters = {r[2]: r[3].partition(":")[0] for r in rows if "Super" in r[1]}
        self.pf_clusters = [(r[2], r[3]) for r in rows if r[2].startswith("PFCluster")]
        text = ""
        if rows:
            text += """
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
"""
        for label, plugin, name, src, _ in rows:
            variables = "superClusterVariables" if "Super" in plugin else "pfClusterVariables"
            text += (
                f'table("{label}Table", cms.EDProducer("{plugin}",\n'
                f'    src=cms.InputTag("{src}"), name=cms.string("{name}"),\n'
                f'    doc=cms.string("{src}"), cut=cms.string(""), singleton=cms.bool(False), extension=cms.bool(False),\n'
                f"    skipNonExistingSrc=cms.bool(True), variables={variables}))\n"
            )
        if self.hgcal_nano and inv.has("hgcalMergeLayerClusters"):  # its table is HGCalNanoAOD's (hgcal_reco)
            rows.append(("hgcalLayerClusters", None, "HGCalLayerClusters", "hgcalMergeLayerClusters",
                         "CaloClusterHitsTableProducer"))  # fmt: skip
        if not rows:
            return
        if self.cluster_hits:
            text += """
# The hits of each cluster (the same source as its table, no cut): a count on the cluster table (n<Name>Hits) and a
# table <Name>Hits of DetId and fraction, one row per (cluster, hit). The converter finds each hit by its DetId.
"""
            for label, _, name, src, hits in rows:
                text += (
                    f'table("{label}Hits", cms.EDProducer("{hits}",\n'
                    f'    src=cms.InputTag("{src}"), name=cms.string("{name}"),\n'
                    f'    hitsName=cms.string("{name}Hits"), precision=cms.int32(8), skipNonExistingSrc=cms.bool(True)))\n'
                )
        else:
            self.notes.append(
                "the hits of clusters: this release has no " + ", ".join(sorted(CLUSTER_HITS)) + " (add them with "
                f"git cms-merge-topic mmarriot:nanoaod-cluster-hits, or every table at once with git cms-merge-topic mmarriot:{ALL})"
            )
        if text:
            self.add(text)

    # Tracks and physics objects

    def tracks(self):
        """General tracks: HGCalNanoAOD's table (Phase 2: its TICL candidates extend it with their HGCal entry point),
        with the columns the profiles draw, and their outermost position."""
        if not self.inv.has("generalTracks", product_type="recoTracks") or not self.need(
            "SimpleTrackFlatTableProducer"
        ):
            return
        text = """
# General tracks, in the table NANO:@HGCAL writes (DPGAnalysis/HGCalNanoAOD), with the columns drawn: a helix from
# the reference point with the momentum, to the outermost hit (from the track extra)
"""
        if self.hgcal_nano:
            text += "process.emberTables.add(process.generalTracksTable)\n"
        else:
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
            + self.track_time()
        )
        self.written.add("GeneralTrack")
        self.track_tables.append(("GeneralTrack", "generalTracks"))
        self.gsf_tracks()

    def track_time(self):
        """Phase 2: the tracks' time at the beam line from MTD (tofPID), when the input has it."""
        if not self.inv.has("tofPID", "t0"):
            return ""
        return """# Their time at the beam line from MTD (tofPID, Phase 2), and its uncertainty (negative: none)
process.generalTracksTable.externalVariables = cms.PSet(
    t0=ExtVar("tofPID:t0", float, precision=10, doc="time at the beam line [ns]"),
    sigmat0=ExtVar("tofPID:sigmat0", float, precision=8, doc="uncertainty of t0 [ns]; negative: no time"),
)
"""

    def gsf_tracks(self):
        """The electrons' GSF tracks (electronGsfTracks): the same columns as the general tracks."""
        self.gsf = self.inv.has("electronGsfTracks", product_type="recoGsfTracks") and self.need(
            "SimpleGsfTrackFlatTableProducer"
        )
        if self.gsf:
            self.track_tables.append(("GsfTrack", "electronGsfTracks"))
            self.add(
                """
# The electrons' GSF tracks, drawn as the general tracks are
table("gsfTrackTable", cms.EDProducer("SimpleGsfTrackFlatTableProducer", src=cms.InputTag("electronGsfTracks"),
    name=cms.string("GsfTrack"), doc=cms.string("electronGsfTracks"), cut=cms.string(""), singleton=cms.bool(False),
    extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(
        process.generalTracksTable.variables.clone(highPurity=None))))
"""
            )

    def vertices(self, pat=False):
        """Every primary vertex (row 0 is the leading one, which PF and PUPPI take as the hard scatter) and the
        inclusive secondary vertices, in collection order; with `pat`, standard NanoAOD has the leading one."""
        inv, rows = self.inv, []
        if pat:
            return
        time = (
            '\n        t=Var("t", "float", precision=10, doc="time [ns] (MTD)"),'
            '\n        tError=Var("tError", "float", precision=8, doc="uncertainty of t [ns]; 0 or less: no time"),'
        ) * self.s.phase2
        for label, name, src, doc, extra in [
            ("pvTable", "PV", "offlinePrimaryVertices", "offline primary vertices (row 0: the leading one)",
             '\n        ndof=Var("ndof", "float", precision=8, doc="number of degrees of freedom"),'
             '\n        chi2=Var("normalizedChi2", "float", precision=8, doc="chi2 / ndof"),' + time),
            ("svTable", "SV", "inclusiveSecondaryVertices", "inclusive secondary vertices", ""),
        ]:  # fmt: skip
            if inv.has(src, product_type="recoVertexs") and self.need("SimpleVertexFlatTableProducer"):
                rows.append(f"""
table("{label}", cms.EDProducer("SimpleVertexFlatTableProducer", src=cms.InputTag("{src}"),
    name=cms.string("{name}"), doc=cms.string("{doc}"), cut=cms.string(""),
    singleton=cms.bool(False), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True),
    variables=cms.PSet(
        x=Var("x", "float", precision=14, doc="x [cm]"),
        y=Var("y", "float", precision=14, doc="y [cm]"),
        z=Var("z", "float", precision=14, doc="z [cm]"),
        ntracks=Var("tracksSize", "uint16", doc="number of tracks"),{extra}
    )))""")
        if rows:
            self.add(
                "\n# Vertices: every primary vertex, and the inclusive secondary vertices"
                + "".join(rows)
                + self.vertex_tracks()
            )

    def pf_candidates(self, pat=False):
        """The PF candidates (particleFlow), with their PUPPI weight and the rows of their track, GSF track and (but
        with `pat`, whose physics objects are PAT's) muon, electron and photon."""
        inv = self.inv
        if not inv.has("particleFlow", product_type="recoPFCandidates") or not self.need(
            "SimplePFCandidateFlatTableProducer"
        ):
            return
        self.pf = True
        # with the CMSSW branch's producer, the rows of the tracks, GSF tracks and muons are its own, checked against
        # the collection each reference points into; else the references' keys (they point into these collections)
        linked = self.pf_links(pat)
        links = [] if linked else [("trackIdx", "trackRef()", "GeneralTrack (generalTracks)")]
        links += [("gsfTrackIdx", "gsfTrackRef()", "GsfTrack (electronGsfTracks)")] * (self.gsf and not linked)
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
            puppi = (
                '\n    externalVariables=cms.PSet(puppiWeight=ExtVar("puppi", float, precision=8, doc="PUPPI weight")),'
            )
        end = "?positionAtECALEntrance().R() > 0?positionAtECALEntrance().{}():0/0"
        self.add(
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

    def physics(self, pat=False):
        """Physics objects from the RECO collections, named and laid out as in standard NanoAOD (a subset of its
        columns), so that the same profile draws a standard NanoAOD; with `pat`, standard NanoAOD has them, and only
        the beam spot's position (which its BeamSpot table lacks) is written here. No table takes a cut: index
        columns (e.g. of the PF candidates) address their rows in collection order; the viewer's pT cuts hide the soft
        ones (at 200 pileup, about 175 CHS jets, 118 taus and 43 muons per event).
        The rows of the objects an object was made from are index columns, from references (ref)."""
        inv, s, rows = self.inv, self.s, []
        names = {"ak4PFJetsPuppi": "Jet", "ak4PFJetsCHS": "JetCHS"}  # each collection its table (the profiles' names)
        jets = [(n, j) for j, n in names.items() if not pat and inv.has(j, product_type="recoPFJets")]
        jets = jets if jets and self.need("SimplePFJetFlatTableProducer") else []
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
)""",
            )
        for label, name, src in () if pat else (("puppiMet", "PuppiMET", "pfMetPuppi"), ("pfMet", "PFMET", "pfMet")):
            if inv.has(src, product_type="recoPFMETs") and self.need("SimpleMETFlatTableProducer"):
                rows.append(f"""
table("{label}Table", cms.EDProducer("SimpleMETFlatTableProducer",
    src=cms.InputTag("{src}"), name=cms.string("{name}"), doc=cms.string("{src}"),
    singleton=cms.bool(True), extension=cms.bool(False), skipNonExistingSrc=cms.bool(True),
    variables=cms.PSet(pt=Var("pt", "float", precision=10, doc="pt [GeV]"), phi=Var("phi", "float", precision=10,
        doc="phi"), sumEt=Var("sumEt", "float", precision=10, doc="scalar sum of Et [GeV]"))))""")
        taus = not pat and inv.has("hpsPFTauProducer", product_type="recoPFTaus")
        taus = taus and self.need("SimplePFTauCandidateFlatTableProducer")
        if taus:
            lead = (
                '\n        leadCandIdx=ref("leadChargedHadrCand()", "row in PFCandidates of the leading charged '
                'hadron; -1: none"),'
                if self.pf
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
        sc = self.superclusters
        egamma = {
            "barrel": [("superClusterEBIdx", "?isEB()&&", "parentSuperCluster()", "SuperClusterEB")]
            + [("superClusterEEIdx", "?isEE()&&", "parentSuperCluster()", "SuperClusterEE")] * (not s.phase2),
            "hgcal": [("superClusterIdx", "?", "superCluster()", "SuperClusterHGCal")],
        }
        tracks = [("trackIdx", "closestCtfTrackRef()", "GeneralTrack (generalTracks)")]
        tracks += [("gsfTrackIdx", "gsfTrack()", "GsfTrack (electronGsfTracks)")] * self.gsf
        candidates = [
            ("electron", "Electron", "gedGsfElectrons", "recoGsfElectrons", "barrel", tracks),
            ("electronHGC", "ElectronHGC", "ecalDrivenGsfElectronsHGC", "recoGsfElectrons", "hgcal", tracks),
            ("photon", "Photon", "gedPhotons", "recoPhotons", "barrel", []),
            ("photonHGC", "PhotonHGC", "photonsHGC", "recoPhotons", "hgcal", []),
            ("muon", "Muon", "muons", "recoMuons", None, [("trackIdx", "innerTrack()", "GeneralTrack (inner track)")]
             + [(c, r, f"{n} ({src})") for n, src, r, c in self.muon_tracks() if r]),
        ]  # fmt: skip
        for label, name, src, type_, region, refs in [] if pat else candidates:
            if inv.has(src, product_type=type_) and self.need("SimpleCandidateFlatTableProducer"):
                extra = (
                    '\n        isGlobal=Var("isGlobalMuon", bool, doc="global muon"),'
                    '\n        isTracker=Var("isTrackerMuon", bool, doc="tracker muon"),'
                    '\n        isStandalone=Var("isStandAloneMuon", bool, doc="standalone muon"),'
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
                rows.append(f"""
table("{label}Table", cms.EDProducer("SimpleCandidateFlatTableProducer", src=cms.InputTag("{src}"),
    name=cms.string("{name}"), doc=cms.string("{src}"), cut=cms.string(""), singleton=cms.bool(False),
    extension=cms.bool(False), skipNonExistingSrc=cms.bool(True), variables=cms.PSet(kinematics,
        charge=Var("charge", "int16", doc="charge"),{extra}
    )))""")
        rows += [self.constituents(jets, taus), self.jet_tags(jets)]
        if inv.has("offlineBeamSpot", product_type="recoBeamSpot") and self.need("SimpleBeamspotFlatTableProducer"):
            rows.append("""
table("beamSpotTable", cms.EDProducer("SimpleBeamspotFlatTableProducer", src=cms.InputTag("offlineBeamSpot"),
    name=cms.string("OfflineBeamSpot"), doc=cms.string("offline beam spot"), extension=cms.bool(False),
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
# of its columns), uncut and in collection order
kinematics = cms.PSet(
    pt=Var("pt", "float", precision=10, doc="pt [GeV]"),
    eta=Var("eta", "float", precision=12, doc="pseudorapidity"),
    phi=Var("phi", "float", precision=12, doc="azimuth"),
    mass=Var("mass", "float", precision=10, doc="mass [GeV]"),
)"""
            + "".join(rows)
        )

    def muon_tracks(self):
        """(table, collection, reco::Muon's reference, index column) of the standalone and global muon tracks that are
        written: only with their hits (CMSSW branch nanoaod-track-hits), through which they are drawn."""
        if not BRANCHES[TRACK_HITS] <= self.release or "SimpleTrackFlatTableProducer" not in self.release:
            return []
        # A muon's outerTrack() points into standAloneMuons:UpdatedAtVtx, or into standAloneMuons where the update at
        # the vertex failed, and the two collections stop lining up after such a track: its key does not give a row.
        # So the standalone tracks get no expression (None, below): muon_track_links() writes their index.
        tracks = [("StandaloneMuonTrack", "standAloneMuons:UpdatedAtVtx", None, None),
                  ("GlobalMuonTrack", "globalMuons", "globalTrack()", "globalTrackIdx")]  # fmt: skip
        return [t for t in tracks if self.inv.has(*t[1].split(":"), product_type="recoTracks")]

    def muon_track_links(self):
        """The muons' rows of their standalone track (CMSSW branch nanoaod-muon-track-links), extending the muon table:
        the producer checks which collection the reference is in, which an expression cannot."""
        standalone = [t for t in self.muon_tracks() if t[0] == "StandaloneMuonTrack"]
        if not standalone or not self.inv.has("standAloneMuons", "", "recoTracks"):
            return
        if not self.branch(MUON_TRACK_LINKS, "the muons' standalone tracks"):
            return
        # every collection an outer track can be in must be given (else the producer throws): standAloneMuons too,
        # whose table is not written (outerTrackNotAtVtxIdx, unused)
        self.add("""
# The muons' standalone tracks (CMSSW branch nanoaod-muon-track-links): the row in the StandaloneMuonTrack table
# (standAloneMuons:UpdatedAtVtx), -1 if none or in standAloneMuons (the update at the vertex failed)
table("muonTrackLinkTable", cms.EDProducer("MuonTrackLinkTableProducer", src=cms.InputTag("muons"), name=cms.string("Muon"),
    tracks=cms.VPSet(
        cms.PSet(name=cms.string("standaloneTrackIdx"), type=cms.string("outer"), src=cms.InputTag("standAloneMuons", "UpdatedAtVtx"),
                 doc=cms.string("row in StandaloneMuonTrack (standAloneMuons:UpdatedAtVtx), -1 if none or not there")),
        cms.PSet(name=cms.string("outerTrackNotAtVtxIdx"), type=cms.string("outer"), src=cms.InputTag("standAloneMuons"),
                 doc=cms.string("index in standAloneMuons (not updated at the vertex), -1 if none or not there")))))""")

    def muon_system(self, pat=False):
        """DPGAnalysis/MuonTools' tables of the muon system's segments (DT, CSC, GEM) and of the GEM and RPC rechits,
        with their global position (and direction), in collection order (by DetId); with the CMSSW branch
        muontools-rechits-chambers, the DT and CSC rechits, the chambers in use and the muons' segments; the standalone
        and global muon tracks (muon_tracks)."""
        inv, parts = self.inv, []
        segment = """
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
        strips = (
            '\n        bx=Var("BunchX()", "int16", doc="bunch crossing"),'
            '\n        clusterSize=Var("clusterSize()", "int16", doc="number of strips"),'
        )
        hit = """
    variables=cms.PSet({}
    ),
    globalPosVariables=cms.PSet(
        x=GlobGeomVar("x()", precision=14, doc="x [cm]"),
        y=GlobGeomVar("y()", precision=14, doc="y [cm]"),
        z=GlobGeomVar("z()", precision=14, doc="z [cm]"),
    ),"""
        detid = lambda *names: "\n    detIdVariables=cms.PSet(" + "".join(
            f'\n        {n}=DetIdVar("{n}()", "int16", doc="{n}"),' for n in names
        ) + '\n        detId=DetIdVar("rawId()", "uint", doc="DetId"),\n    ),'  # fmt: skip
        tables = [
            ("dt4DSegments", "DTSegmentFlatTableProducer", "dtSegment", "DTSegment", "DT 4D segments",
             segment.format('\n        time=Var("?hasPhi()?phiSegment().t0():-99", "float", precision=8, doc="t0 [ns]; '
                            '-99: none"),') + detid("wheel", "station", "sector")),
            ("cscSegments", "CSCSegmentFlatTableProducer", "cscSegment", "CSCSegment", "CSC segments",
             segment.format('\n        nHits=Var("nRecHits", "int16", doc="number of hits"),\n        time=Var("time", '
                            '"float", precision=8, doc="time [ns]"),') + detid("endcap", "station", "ring", "chamber")),
            ("gemSegments", "GEMSegmentFlatTableProducer", "gemSegment", "GEMSegment", "GEM segments",
             segment.format('\n        nHits=Var("nRecHits", "int16", doc="number of hits"),')
             + detid("region", "station", "ring", "chamber")),
            ("gemRecHits", "GEMRecHitFlatTableProducer", "gemRecHit", "GEMRecHit", "GEM rechits",
             hit.format(strips) + detid("region", "station", "ring", "chamber", "layer", "roll")),
            ("rpcRecHits", "RPCRecHitFlatTableProducer", "rpcRecHit", "RPCRecHit", "RPC rechits",
             hit.format(strips + '\n        time=Var("time", "float", precision=8, doc="time [ns]"),')
             + detid("region", "ring", "station", "sector", "layer", "roll")),
        ]  # fmt: skip
        # the branch's tables: the DT and CSC rechits (RECO), and the chambers and the muons' segments, which need only
        # the segments (an AOD keeps them)
        sources = {"dtSegmentSrc": "dt4DSegments", "cscSegmentSrc": "cscSegments", "gemSegmentSrc": "gemSegments",
                   "dtRecHitSrc": "dt1DRecHits", "cscRecHitSrc": "csc2DRecHits", "rpcRecHitSrc": "rpcRecHits",
                   "gemRecHitSrc": "gemRecHits"}  # fmt: skip
        held = {k: src for k, src in sources.items() if inv.has(src)}
        more = bool(held) and self.branch(
            MUON_RECHITS, "the DT and CSC rechits, the muon chambers and the muons' segments"
        )
        # the chamber's DetId, which joins the MuonChamber table
        chamber = '\n        chamberDetId=DetIdVar("chamberId().rawId()", "uint", doc="DetId of the chamber"),\n    ),'
        tables += [
            ("dt1DRecHits", "DTRecHitFlatTableProducer", "dtRecHit", "DTRecHit", "DT rechits (wire pairs)",
             hit.format("")
             + detid("wheel", "station", "sector", "superlayer", "layer").replace("\n    ),", chamber)),
            ("csc2DRecHits", "CSCRecHitFlatTableProducer", "cscRecHit", "CSCRecHit", "CSC 2D rechits",
             hit.format('\n        time=Var("tpeak", "float", precision=8, doc="peak time [ns]"),')
             + detid("endcap", "station", "ring", "chamber", "layer").replace("\n    ),", chamber)),
        ] * more  # fmt: skip
        for src, plugin, cfi, name, doc, columns in tables:
            if inv.has(src) and self.need(plugin):
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
        tracks = "".join(
            f'table("{n[0].lower()}{n[1:]}Table", cms.EDProducer("SimpleTrackFlatTableProducer", src=cms.InputTag("{src}"),\n'
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
            for n, src, _, _ in self.muon_tracks()
        )
        self.track_tables += [(n, src) for n, src, _, _ in self.muon_tracks()]
        if tracks:
            parts.append(
                "# The standalone and global muon tracks, drawn through their hits (track_hits below)\n" + tracks
            )
        if parts:
            self.add(
                """
# The muon system (DPGAnalysis/MuonTools): segments, as a position and a direction, and the rechits, with their
# global positions; DetId and its fields
from DPGAnalysis.MuonTools.common_cff import DetIdVar, GlobGeomVar
"""
                + "".join(parts)
            )

    def calo_rechits(self):
        """Every ECAL and HCAL rechit with the position of its cell, one table per collection (CMSSW branch
        nanoaod-calo-rechits), instead of the PF rechits (a subset of them), when the release has the producers and the
        input the rechits. Whether they are written."""
        s, inv = self.s, self.inv
        kinds = [
            ("EB", "EcalRecHitTableProducer", "ecalRecHit", "EcalRecHitsEB", "ECAL barrel"),
            ("EE", "EcalRecHitTableProducer", "ecalRecHit", "EcalRecHitsEE", "ECAL endcap"),
            ("ES", "EcalRecHitTableProducer", "ecalPreshowerRecHit", "EcalRecHitsES", "preshower"),
            ("HBHE", "HBHERecHitTableProducer", "hbhereco", "", "HCAL barrel and endcap"),
            ("HF", "HFRecHitTableProducer", "hfreco", "", "HCAL forward"),
            ("HO", "HORecHitTableProducer", "horeco", "", "HCAL outer"),
        ]
        kinds = [k for k in kinds if inv.has(k[2], k[3]) and not (s.phase2 and k[0] in ("EE", "ES"))]
        if not kinds or not self.branch(CALO_RECHITS, "every calorimeter rechit (the PF rechits are written)"):
            return False
        text = """
# Every ECAL and HCAL rechit, with the position of its cell (CaloGeometry): one table per collection of DetId, energy,
# time, x, y, z (PhysicsTools/NanoAOD, CMSSW branch nanoaod-calo-rechits). The PF rechits are a subset: not written.
"""
        for k, plugin, module, instance, doc in kinds:
            label = f"{k.lower()}RecHitTable"
            text += (
                f'table("{label}", cms.EDProducer("{plugin}", src=cms.InputTag("{module}", "{instance}"),\n'
                f'    name=cms.string("RecHit{k}"), doc=cms.string("{doc} rechits"), precision=cms.int32(14),\n'
                f"    skipNonExistingSrc=cms.bool(True)))\n"
            )
            self.hit_tables[label] = (f"TruthRecHit{k}", "detId")
        self.add(text)
        return True

    def track_hits(self):
        """The valid hits of the tracks of each table in track_tables, in track order (CMSSW branch
        nanoaod-track-hits)."""
        # an AOD keeps no hits of its tracks (TrackingRecHitsOwned), and the producer would fail on them
        kept = [(n, src) for n, src in self.track_tables if self.inv.has(src.split(":")[0], "", "TrackingRecHitsOwned")]
        if len(kept) < len(self.track_tables):
            left = [n for n, _ in self.track_tables if (n, _) not in kept]
            self.notes.append(f"the hits of {', '.join(left)}: the input does not keep them (AOD)")
        self.track_tables = kept
        if not self.track_tables or not self.branch(TRACK_HITS, "the hits of tracks"):
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
        for name, src in self.track_tables:
            text += (
                f'table("{name[0].lower()}{name[1:]}HitsTable", cms.EDProducer("TrackHitsTableProducer",\n'
                f'    src=cms.InputTag("{src}"), name=cms.string("{name}"), hitsName=cms.string("{name}Hits"),\n'
                f'    hitsDoc=cms.string("valid hits of {src}"), precision=cms.int32(14), skipNonExistingSrc=cms.bool(True)))\n'
            )
        self.add(text)

    def vertex_tracks(self):
        """The (vertex, track) pairs of the primary and secondary vertices with the tracks' weights (CMSSW branch
        nanoaod-vertex-tracks), as text for vertices()."""
        pairs = [(name, src) for name, src in (("PV", "offlinePrimaryVertices"), ("SV", "inclusiveSecondaryVertices"))
                 if self.inv.has(src, product_type="recoVertexs")]  # fmt: skip
        if not pairs or "GeneralTrack" not in self.written:
            return ""
        if not self.branch(VERTEX_TRACKS, "the tracks of vertices"):
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

    def pf_links(self, pat=False):
        """The PF candidates' rows of their track, GSF track, muon and TICL candidate, and their PF clusters (CMSSW
        branch nanoaod-pfcandidate-links), as text for pf_candidates(); "" without them."""
        if not self.branch(PF_LINKS, "the PF candidates' TICL candidates and PF clusters"):
            return ""
        inv = self.inv
        tag = lambda written, src: f'cms.InputTag("{src}")' if written else 'cms.InputTag("")'
        ticl = self.s.phase2 and inv.has("pfTICL", product_type="recoPFCandidates") and self.ticl
        blocks = inv.has("particleFlowBlock")  # the PF blocks hold the candidates' clusters (not in an AOD)
        if self.pf_clusters and not blocks:
            self.notes.append("the PF candidates' PF clusters: the input has no PF blocks (AOD)")
        clusters = "".join(
            f'\n        cms.PSet(src=cms.InputTag("{src}"), name=cms.string("PFCandidateClusters{name[9:]}"),'
            f' doc=cms.string("PF candidate <-> {src}")),'
            for name, src in self.pf_clusters * blocks
        )
        return f"""
# Their tracks, GSF tracks, muons and TICL candidates (the HGCal ones, pfTICL, one per TICL candidate), and their PF
# clusters from their PF blocks, one table of (candidate, cluster) pairs per collection (CMSSW branch
# nanoaod-pfcandidate-links)
table("pfCandidateLinkTable", cms.EDProducer("PFCandidateLinkTableProducer", src=cms.InputTag("particleFlow"),
    name=cms.string("PFCandidates"), tracks={tag("GeneralTrack" in self.written, "generalTracks")},
    gsfTracks={tag(self.gsf, "electronGsfTracks")},
    muons={tag(not pat and inv.has("muons", product_type="recoMuons"), "muons")},
    ticlCandidates={tag(ticl, "pfTICL")}, clusters=cms.VPSet({clusters}
    )))"""

    def constituents(self, jets, taus):
        """The PF candidates of the RECO jets and taus (CMSSW branch nanoaod-reco-constituents), as text for physics():
        `jets` (table, collection) pairs, `taus` whether the tau table is written."""
        if not self.pf or not (jets or taus) or not self.branch(CONSTITUENTS, "the constituents of jets and taus"):
            return ""
        rows = [(f"{name}PFCands", "SimplePFJetConstituentTableProducer", src) for name, src in jets]
        rows += [("TauPFCands", "SimplePFTauConstituentTableProducer", "hpsPFTauProducer")] * taus
        return (
            "\n# Their PF candidates (CMSSW branch nanoaod-reco-constituents): (object, PF candidate) pairs\n"
            + "".join(
                f'table("{name[0].lower()}{name[1:]}Table", cms.EDProducer("{plugin}", jets=cms.InputTag("{src}"),\n'
                f'    candidates=cms.InputTag("particleFlow"), name=cms.string("{name}"), candIdxName=cms.string("pfCandIdx"),\n'
                f'    candIdxDoc=cms.string("row in PFCandidates"), jetCut=cms.string(""), jetConstCut=cms.string("")))\n'
                for name, plugin, src in rows
            )
        )

    def jet_tags(self, jets):
        """The b-tags of the CHS jets (CMSSW branch nanoaod-jet-tags), as text for physics()."""
        chs = [name for name, src in jets if src == "ak4PFJetsCHS"]
        tags = [("btagDeepCSVB", ["pfDeepCSVJetTags:probb", "pfDeepCSVJetTags:probbb"]),
                ("btagJP", ["pfJetProbabilityBJetTags"])]  # fmt: skip
        tags = [(c, t) for c, t in tags if all(self.inv.has(*x.split(":")) for x in t)]
        if not chs or not tags or not self.branch(JET_TAGS, "the b-tags of the CHS jets"):
            return ""
        return f"""
# The b-tags of the CHS jets, the jets they are computed on (CMSSW branch nanoaod-jet-tags), extending their table
table("jetCHSTagTable", cms.EDProducer("JetTagTableProducer", src=cms.InputTag("ak4PFJetsCHS"), name=cms.string("{chs[0]}"),
    variables=cms.PSet({"".join(f'{chr(10)}        {c}=cms.PSet(src=cms.VInputTag({", ".join(repr(x) for x in t)}), doc=cms.string("{" + ".join(t)}"), precision=cms.int32(10)),' for c, t in tags)}
    )))"""

    def mtd_rechits(self):
        """Every BTL and ETL rechit (CMSSW branch nanoaod-mtd-rechits), Phase 2."""
        inv = self.inv
        parts = [(n, i) for n, i in (("BTL", "FTLBarrel"), ("ETL", "FTLEndcap")) if inv.has("mtdRecHits", i)]
        if not parts or not self.branch(MTD_RECHITS, "the MTD rechits"):
            return
        self.add(
            "\n# Every MTD rechit (BTL and ETL) with its time and position (CMSSW branch nanoaod-mtd-rechits), one table\n"
            + "".join(
                f'table("{n.lower()}RecHitTable", cms.EDProducer("MTDRecHitTableProducer",\n'
                f'    src=cms.InputTag("mtdRecHits", "{i}"), name=cms.string("RecHit{n}"), doc=cms.string("{n} rechits"),\n'
                f"    precision=cms.int32(14), skipNonExistingSrc=cms.bool(True)))\n"
                for n, i in parts
            )
        )

    # Truth

    def truth(self, associators, maps, drop, pat=False):
        """The truth graph's tables (PhysicsTools/TruthInfo, git cms-merge-topic mmarriot:truthgraph-nano-tables),
        when the release has their producers and the input the graph: particles, vertices, children; the simulated
        energy of each particle in each hit of the hit tables written above; the reco <-> truth associations of
        particles and of vertices (`maps`: table label -> (module, instance) of its map). An input with maps of its own
        (made with the associators in its reconstruction) gives them, and no associator runs (they could need
        collections it lacks; its vertex maps are not read, as the truth vertices they match would have to be kept);
        else the associators run, unless `associators` is false. With `pat`, no vertex association: the PV and SV
        tables are standard NanoAOD's (the leading vertex; slimmedSecondaryVertices), not the collections the maps index. The particles: the default selection plus every particle that entered the
        calorimeter, which carry the hits' energy."""
        inv = self.inv
        if not inv.has("truthLogicalGraphProducer"):
            if self.s.phase2 and not self.s.data:
                self.notes.append("truth: the input has no truth graph (truthLogicalGraphProducer)")
            return
        if not self.need("TruthGraphFlatTableProducer", "TruthGraphHitFlatTableProducer"):
            self.notes[-1] += (
                f" (add them with git cms-merge-topic mmarriot:truthgraph-nano-tables, or every table at once with git "
                f"cms-merge-topic mmarriot:{ALL})"
            )
            return
        hits = ""
        if inv.has("truthLogicalGraphHitIndexProducer"):
            hits = "from PhysicsTools.TruthInfo.truthGraphHitFlatTable_cfi import truthGraphHitFlatTable\n" + "".join(
                f'table("{name[0].lower()}{name[1:]}Table", truthGraphHitFlatTable.clone(\n'
                f'    hitTable="{module}", hitIdColumn="{column}", name="{name}"))\n'
                for module, (name, column) in self.hit_tables.items()
            )
        else:
            self.notes.append("truth of the hits: the input has no hit index (truthLogicalGraphHitIndexProducer)")
        # the maps the input holds (not those of a class this release cannot read, dropped on input)
        stored = {(p.module, p.instance) for p in inv.items if p not in drop}
        vertex = lambda label: "Vertices" in label  # e.g. truthGraphOfflinePrimaryVerticesToTruthTable
        if pat:
            maps = {label: key for label, key in maps.items() if not vertex(label)}
        held = sorted(label for label, key in maps.items() if key in stored and not vertex(label))
        names = lambda labels: ", ".join(sorted(re.sub(r"^truthGraph|Table$", "", label) for label in labels))
        tables = lambda labels: (
            f"for label in [{''.join(f'{chr(10)}    {k!r},' for k in sorted(labels))}\n]:\n"
            "    process.emberTables.add(getattr(process, label))\n"
        )
        if not maps:
            self.notes.append("reco <-> truth associations: the release's truth tables name no association tables")
            assoc = ""
        elif held:
            if len(held) < len(maps):
                self.notes.append(
                    f"reco <-> truth associations {names(set(maps) - set(held))}: the input's own maps do not have "
                    "them, or are of vertices (with maps of its own, no associator runs)"
                )
            assoc = (
                "# The input holds association maps of its own: the tables read them, and no associator runs (they\n"
                "# could need collections the input lacks)\n" + tables(held)
            )
        elif associators:
            assoc = (
                "# The associators make the maps here: about 1 s per event of wall time at 200 pileup (3 s of CPU),\n"
                "# little without pileup (--no-truth-associators leaves them out)\n"
                + tables(maps)
                + "process.emberTables.add(process.truthGraphNanoAssociatorsTask)\n"
            )
        else:
            self.notes.append("reco <-> truth associations: --no-truth-associators, and the input holds no maps")
            assoc = ""
        # the truth vertices that the vertex maps match are kept, when the associators make those maps here
        keep = (
            ""
            if associators and maps and not held and not pat
            else "\n    keepVerticesMatchedBy=[], keepVerticesMatchedByTruthToReco=[]  # no vertex maps\n"
        )
        self.add(
            f"""
# The truth graph: its particles (the signal, the particles reco objects are matched to, every particle that entered
# the calorimeter, and their ancestors), their vertices and children (PhysicsTools/TruthInfo,
# SimGeneral/TruthGraphAssociatorProducers)
process.load("SimGeneral.TruthGraphAssociatorProducers.truthGraphNanoTables_cff")
process.truthGraphTable = process.truthGraphCaloBoundaryTable.clone({keep})
process.emberTables.add(process.truthGraphTable)
# The simulated energy of each particle in each hit of the hit tables above
{hits}# The reco <-> truth associations of particles and vertices
{assoc}"""
        )

    def output(self, output, pat=False):
        if pat:
            module = "NANOAODoutput" if self.s.data else "NANOAODSIMoutput"
            self.add(
                f"""
# Ember's tables go in the NanoAOD of the PAT + NANO job, read back quickly (LZ4: the file is temporary)
process.{module}.outputCommands.append("keep nanoaodFlatTable_*_*_EMBER")
process.{module}.compressionAlgorithm = "LZ4"
process.{module}.compressionLevel = 4
process.emberTablesPath = cms.EndPath(process.emberTables)
process.schedule.append(process.emberTablesPath)
"""
            )
            return
        self.add(
            f"""
# The output: every table of this process. LZ4 is quick to write and to read back, and the file is temporary.
process.output = cms.OutputModule("NanoAODOutputModule", fileName=cms.untracked.string("{output}"),
    outputCommands=cms.untracked.vstring("drop *", "keep nanoaodFlatTable_*_*_EMBER"),
    compressionAlgorithm=cms.untracked.string("LZ4"), compressionLevel=cms.untracked.int32(4))
process.end = cms.EndPath(process.output, process.emberTables)
"""
        )
