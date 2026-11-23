"""The truth graph's tables and the reco <-> truth associations."""

import re

from .writer import ALL


def truth_tables(w, associators, maps, drop, pat=False):
    """The truth graph's tables (PhysicsTools/TruthInfo, git cms-merge-topic mmarriot:truthgraph-nano-tables),
    when the release has their producers and the input the graph: particles, vertices, children; the simulated
    energy of each particle in each hit of the hit tables written above; the reco <-> truth associations of
    particles and of vertices (`maps`: table label -> (module, instance) of its map). An input with maps of its own
    (made with the associators in its reconstruction) gives them, and no associator runs (they could need
    collections it lacks; its vertex maps are not read, as the truth vertices they match would have to be kept);
    else the associators run, unless `associators` is false. With `pat`, no vertex association: the PV and SV
    tables are standard NanoAOD's (the leading vertex; slimmedSecondaryVertices), not the collections the maps index. The particles: the default selection plus every particle that entered the
    calorimeter, which carry the hits' energy."""
    inv = w.inv
    if not inv.has("truthLogicalGraphProducer"):
        if w.s.phase2 and not w.s.data:
            w.notes.append("truth: the input has no truth graph (truthLogicalGraphProducer)")
        return
    if not w.need("TruthGraphFlatTableProducer", "TruthGraphHitFlatTableProducer"):
        w.notes[-1] += (
            f" (add them with git cms-merge-topic mmarriot:truthgraph-nano-tables, or every table at once with git "
            f"cms-merge-topic mmarriot:{ALL})"
        )
        return
    hits = ""
    if inv.has("truthLogicalGraphHitIndexProducer"):
        hits = "from PhysicsTools.TruthInfo.truthGraphHitFlatTable_cfi import truthGraphHitFlatTable\n" + "".join(
            f'table("{name[0].lower()}{name[1:]}Table", truthGraphHitFlatTable.clone(\n'
            f'    hitTable="{module}", hitIdColumn="{column}", name="{name}"))\n'
            for module, (name, column) in w.hit_tables.items()
        )
    else:
        w.notes.append("truth of the hits: the input has no hit index (truthLogicalGraphHitIndexProducer)")
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
        w.notes.append("reco <-> truth associations: the release's truth tables name no association tables")
        assoc = ""
    elif held:
        if len(held) < len(maps):
            w.notes.append(
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
            + "# Only the trackster collections the input has: the associator stops on a missing one (TICL v6\n"
            "# has no CLUE3D tracksters)\n"
            'if hasattr(process, "truthBranchTracksterAssociators"):\n'
            "    associator = process.truthBranchTracksterAssociators\n"
            "    associator.recoCollections = [t for t in associator.recoCollections\n"
            f"                                  if t.getModuleLabel() in {inv.modules('ticlTracksters')!r}]\n"
        )
    else:
        w.notes.append("reco <-> truth associations: --no-truth-associators, and the input holds no maps")
        assoc = ""
    # the truth vertices that the vertex maps match are kept, when the associators make those maps here
    keep = (
        ""
        if associators and maps and not held and not pat
        else "\n    keepVerticesMatchedBy=[], keepVerticesMatchedByTruthToReco=[]  # no vertex maps\n"
    )
    w.add(
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
