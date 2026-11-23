"""Calorimeter hits and clusters: HGCal rechits and reconstruction, ECAL and HCAL rechits, PF clusters and
superclusters."""

from .writer import ALL, CALO_RECHITS, CLUSTER_HITS


def hgcal(w):
    """HGCal rechits (TruthInfo, positions from TICLGeom), then the HGCalNanoAOD reconstruction tables."""
    if w.need("RecHitFlatTableProducer") and w.inv.has("HGCalRecHit", "HGCEERecHits"):
        w.add(
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
        w.hit_tables["recHitTable"] = ("TruthHGCalRecHits", "rechit_ID")
    hgcal_reco(w)


def hgcal_reco(w):
    """DPGAnalysis/HGCalNanoAOD's tables: layer clusters if the input has them, one table per trackster collection
    of the input, TICL candidates if it has tracksters. Its track table is scheduled by tracks()."""
    inv = w.inv
    tracksters = inv.modules("ticlTracksters")
    layer_clusters = inv.has("hgcalMergeLayerClusters")
    if not tracksters:
        w.notes.append("TICL tracksters and candidates: the input has none")
    plugins = ["LayerClustersCollectionTableProducer"] * layer_clusters + [
        "TracksterCollectionTableProducer", "TICLCandidateTableProducer", "TICLCandidateExtraTableProducer"
    ] * bool(tracksters)  # fmt: skip
    if not plugins or not w.need(*plugins):
        return
    w.hgcal_nano = True
    soa = inv.soa()
    if soa:
        w.notes.append(
            f"the SoA collections {', '.join(soa)}: this release has no table producer for them (legacy tables "
            "are written)"
        )
    labels = ["hgcalLayerClustersTable", "hgcalLayerClustersExtraTable"] * layer_clusters
    labels += ["ticlCandidateTable", "ticlCandidateExtraTable"] * bool(tracksters)
    w.ticl = bool(tracksters)
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
    w.add(text)


def pf_rechits(w, pat=False):
    """ECAL and HCAL PF rechits (TruthInfo, positions from CaloGeometry), remade in the job if the input lacks
    them (RECO keeps only the cleaned-away ones)."""
    if not w.need("PFRecHitFlatTableProducer"):
        return
    s, inv = w.s, w.inv
    kinds = ["ECAL", "HBHE", "HF", "HO"] + ([] if s.phase2 else ["PS"])
    remade = [k for k in kinds if not inv.has(f"particleFlowRecHit{k}", product_type="recoPFRecHits")]
    # what remaking each needs (an AOD has only the reduced rechit collections)
    sources = {"ECAL": [("ecalRecHit", "EcalRecHitsEB")], "PS": [("ecalPreshowerRecHit", "EcalRecHitsES")],
               "HBHE": [("hbhereco", "")], "HF": [("hfreco", "")], "HO": [("horeco", "")]}  # fmt: skip
    lacking = [k for k in remade if not all(inv.has(*src) for src in sources[k])]
    if lacking:
        w.notes.append(f"PF rechits {', '.join(lacking)}: the input has neither them nor the rechits to remake them")
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
    w.hit_tables["pfRecHitTable"] = ("TruthPFRecHits", "rechit_ID")
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
            w.add(text)
            return
        text += f"""
# The input does not keep these PF rechits ({", ".join(remade)}): they are made again from its rechits, with the
# reconstruction's own producers (only those run).
process.load("Configuration.StandardSequences.{reco}")
for kind in {remade!r}:
    process.emberTables.add(getattr(process, "particleFlowRecHit" + kind))
"""
    w.add(text)


def clusters(w):
    """PF clusters and superclusters, and the hits of every kind of cluster (once the release has the producers)."""
    s, inv = w.s, w.inv
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
    rows = [r for r in rows if w.need(r[1])]
    w.superclusters = {r[2]: r[3].partition(":")[0] for r in rows if "Super" in r[1]}
    w.pf_clusters = [(r[2], r[3]) for r in rows if r[2].startswith("PFCluster")]
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
    if w.hgcal_nano and inv.has("hgcalMergeLayerClusters"):  # its table is HGCalNanoAOD's (hgcal_reco)
        rows.append(("hgcalLayerClusters", None, "HGCalLayerClusters", "hgcalMergeLayerClusters",
                     "CaloClusterHitsTableProducer"))  # fmt: skip
    if not rows:
        return
    if w.cluster_hits:
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
        w.notes.append(
            "the hits of clusters: this release has no " + ", ".join(sorted(CLUSTER_HITS)) + " (add them with "
            f"git cms-merge-topic mmarriot:nanoaod-cluster-hits, or every table at once with git cms-merge-topic mmarriot:{ALL})"
        )
    if text:
        w.add(text)


def calo_rechits(w):
    """Every ECAL and HCAL rechit with the position of its cell, one table per collection (CMSSW branch
    nanoaod-calo-rechits), instead of the PF rechits (a subset of them), when the release has the producers and the
    input the rechits. Whether they are written."""
    s, inv = w.s, w.inv
    kinds = [
        ("EB", "EcalRecHitTableProducer", "ecalRecHit", "EcalRecHitsEB", "ECAL barrel"),
        ("EE", "EcalRecHitTableProducer", "ecalRecHit", "EcalRecHitsEE", "ECAL endcap"),
        ("ES", "EcalRecHitTableProducer", "ecalPreshowerRecHit", "EcalRecHitsES", "preshower"),
        ("HBHE", "HBHERecHitTableProducer", "hbhereco", "", "HCAL barrel and endcap"),
        ("HF", "HFRecHitTableProducer", "hfreco", "", "HCAL forward"),
        ("HO", "HORecHitTableProducer", "horeco", "", "HCAL outer"),
    ]
    kinds = [k for k in kinds if inv.has(k[2], k[3]) and not (s.phase2 and k[0] in ("EE", "ES"))]
    if not kinds or not w.branch(CALO_RECHITS, "every calorimeter rechit (the PF rechits are written)"):
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
        w.hit_tables[label] = (f"TruthRecHit{k}", "detId")
    w.add(text)
    return True
