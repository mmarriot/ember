"""The writer state that the section modules add to, and the frame of the configuration: header, source, output."""

import textwrap
from collections import namedtuple

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


class Writer:
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
        self.rechit_map = False  # whether the HGCal rechit map (of the e/gamma shower shapes) is made

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


def header(w, inputs, made_by, pat=False):
    s = w.s
    if pat:
        w.add(
            f"""

# ---- Ember's tables, after the PAT + standard NANO configuration above (cmsDriver.py -s PAT,NANO). Added by
# {made_by or "ember"}: hits, clusters, HGCal, tracks; the physics objects are standard NanoAOD's.
# Left out (not in the input, or not in this release):
#{{NOTES}}
from PhysicsTools.NanoAOD.common_cff import ExtVar, Var
"""
        )
        return
    w.add(
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


def process(w, inputs, events, threads, drop=(), pat=False):
    s = w.s
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
        w.add(dropped(w, drop) + tables)
        return
    geometry = (
        f"Configuration.Geometry.Geometry{s.geometry}Reco_cff"
        if s.phase2
        else "Configuration.StandardSequences.GeometryRecoDB_cff"
    )
    files = "".join(f'\n        "{f}",' for f in inputs)
    w.add(
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
{dropped(w, drop)}process.maxEvents.input = {events if events else -1}
process.options.numberOfThreads = {threads}
{tables}"""
    )


def dropped(w, drop):
    """The source's inputCommands that drop the products the release cannot read."""
    if not drop:
        return ""
    w.notes.append(
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


def output(w, output, pat=False):
    if pat:
        module = "NANOAODoutput" if w.s.data else "NANOAODSIMoutput"
        w.add(
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
    w.add(
        f"""
# The output: every table of this process. LZ4 is quick to write and to read back, and the file is temporary.
process.output = cms.OutputModule("NanoAODOutputModule", fileName=cms.untracked.string("{output}"),
    outputCommands=cms.untracked.vstring("drop *", "keep nanoaodFlatTable_*_*_EMBER"),
    compressionAlgorithm=cms.untracked.string("LZ4"), compressionLevel=cms.untracked.int32(4))
process.end = cms.EndPath(process.output, process.emberTables)
"""
    )
