"""The cmsRun configuration ember writes for a reconstruction (EDM) file: one self-contained `ember_cfg.py`, made only
of modules of the user's CMSSW release, that writes the NanoAOD tables the profiles draw.

What goes in it depends on three things, each found here:
  - what the release has: its module plugins (plugins(), from edmPluginDump: 0.1 s, so it is not cached);
  - what the input holds: its products (products(), from the branch names of its Events tree);
  - the era family: Phase 2 (HGCal, TICL) or Run 3 (ECAL endcap and preshower, HCAL endcap).

A table whose producer the release lacks, or whose collection the input lacks, is left out, and the configuration's
header says so. Table names and columns follow the release's own NanoAOD producers (HGCalNanoAOD, TruthInfo,
standard NanoAOD), so that the profiles that read ember's NanoAOD also read the NanoAOD those flavours make.

    inventory.py  what the release and the input have
    writer.py     the Writer that the sections add to; the header, process, source and output
    calo.py, tracks.py, physics.py, muons.py, truth.py   the sections, one module per producer family
"""

from . import calo, muons, physics, tracks, truth, writer
from .inventory import Inventory, Product, is_product, module_plugins, plugins, products
from .writer import BRANCHES, CLUSTER_HITS, CONFIG, MUON_TRACK_LINKS, OUTPUT, Settings

__all__ = [
    "BRANCHES", "CLUSTER_HITS", "CONFIG", "MUON_TRACK_LINKS", "OUTPUT", "Inventory", "Product", "Settings", "config",
    "is_product", "module_plugins", "plugins", "products",
]  # fmt: skip


def config(
    settings, inputs, events, inventory, release, threads=4, output=OUTPUT, made_by="", drop=(), pat=False,
    associators=True, truth_maps=None,
):  # fmt: skip
    """(the text of ember_cfg.py, the notes on what was left out). `inputs`: EDM file URLs (file:... or root://...),
    `events`: how many (None: all), `release`: the module plugins of the release (plugins()), `drop`: products of
    the input that the release cannot read (export.unreadable()). `pat`: the text is the part to append to the
    configuration of `cmsDriver.py -s PAT,NANO --processName EMBER` (export.cmsdriver), whose standard NanoAOD has the
    physics objects: ember's tables of everything else, written in that job's NanoAOD. `associators`: run the
    truth associators when the input holds no association maps of its own (truth.truth_tables()); `truth_maps`: the
    release's reco <-> truth association tables and the maps they read (export.truth_maps())."""
    # The order matters: later sections read what earlier ones wrote on `w` (calo: ticl, pf_clusters, hit_tables;
    # tracks: gsf, track_tables, written), so a reordered call silently loses columns.
    w = writer.Writer(settings, inventory, release)
    writer.header(w, made_by, pat)
    writer.process(w, inputs, events, threads, drop, pat)
    if settings.phase2:
        calo.hgcal(w)
    if not calo.calo_rechits(w):
        calo.pf_rechits(w, pat)
    calo.clusters(w)
    tracks.general_tracks(w)
    tracks.vertices(w, pat)
    physics.pf_candidates(w, pat)
    physics.physics_objects(w, pat)
    muons.muon_system(w, pat)
    tracks.track_hits(w)
    if not pat:
        muons.muon_track_links(w)
    tracks.mtd_rechits(w)
    truth.truth_tables(w, associators, truth_maps or {}, set(drop), pat)
    writer.output(w, output, pat)
    return w.text(), w.notes
