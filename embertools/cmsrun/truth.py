"""Configuration section for the truth: the truth graph's tables and the reco <-> truth associations."""

import re

from .writer import ALL, first_lower


def truth_tables(w, associators, maps, drop, pat=False):
    """The truth graph's tables (PhysicsTools/TruthInfo, git cms-merge-topic mmarriot:truthgraph-nano-tables), when
    the release has their producers and the input the graph: particles (the default selection plus every particle
    that entered the calorimeter, which carry the hits' energy), vertices, children; the simulated energy of each
    particle in each hit of the hit tables written before; the reco <-> truth associations of particles and of
    vertices (`maps`: table label -> (module, instance) of its map).

    An input with maps of its own (made by the associators of its reconstruction) gives them, and no associator runs
    (they could need collections it lacks); its vertex maps are not read, as the truth vertices they match would have
    to be kept. Else the associators run, unless `associators` is false. With `pat`, no vertex association: the PV and
    SV tables are then standard NanoAOD's (the leading vertex; slimmedSecondaryVertices), not the collections the maps
    index."""
    inv = w.inv
    if not inv.has("truthLogicalGraphProducer"):
        if w.settings.phase2 and not w.settings.data:
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
            f'table("{first_lower(name)}Table", truthGraphHitFlatTable.clone(\n'
            f'    hitTable="{module}", hitIdColumn="{column}", name="{name}"))\n'
            for module, (name, column) in w.hit_tables.items()
        )
    else:
        w.notes.append("truth of the hits: the input has no hit index (truthLogicalGraphHitIndexProducer)")
    # the maps the input holds (not those of a class this release cannot read, dropped on input)
    stored = {(p.module, p.instance) for p in inv.items if p not in drop}
    if pat:
        maps = {label: key for label, key in maps.items() if not _of_vertices(label)}
    held = sorted(label for label, key in maps.items() if key in stored and not _of_vertices(label))
    if not maps:
        w.notes.append("reco <-> truth associations: the release's truth tables name no association tables")
        assoc = ""
    elif held:
        if len(held) < len(maps):
            w.notes.append(
                f"reco <-> truth associations {_short_names(set(maps) - set(held))}: the input's own maps do not have "
                "them, or are of vertices (with maps of its own, no associator runs)"
            )
        assoc = (
            "# The input holds association maps of its own: the tables read them, and no associator runs (they\n"
            "# could need collections the input lacks)\n" + _schedule(held)
        )
    elif associators:
        assoc = (
            "# The associators make the maps here: about 1 s per event of wall time at 200 pileup (3 s of CPU),\n"
            "# little without pileup (--no-truth-associators leaves them out)\n"
            + _schedule(maps)
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


def _of_vertices(label):
    """Whether an association table is of vertices, e.g. truthGraphOfflinePrimaryVerticesToTruthTable."""
    return "Vertices" in label


def _short_names(labels):
    return ", ".join(sorted(re.sub(r"^truthGraph|Table$", "", label) for label in labels))


def _schedule(labels):
    """The text that adds the modules `labels` to the task."""
    listed = "".join(f"\n    {label!r}," for label in sorted(labels))
    return f"for label in [{listed}\n]:\n    process.emberTables.add(getattr(process, label))\n"
