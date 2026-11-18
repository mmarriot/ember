"""From a reconstruction (EDM) file to the NanoAOD the converter reads: ember writes a cmsRun configuration of its own
(cmsrun.py) from the modules of the user's release, and runs it:

    ember_cfg.py   the configuration, which the user can keep and run again (cmsRun ember_cfg.py)
    ember_nano.root  its output, then converted

The job needs the era, geometry and conditions the file was made with. The file records its global tags and, for
Phase 2, the list of geometry files (in its stored parameter sets); the era is not recorded anywhere. Phase 2: the era
is the release's default for that geometry (Configuration.PyReleaseValidation.upgradeWorkflowComponents). Run 3: the
geometry comes from the conditions, and the era from the year (of the run number for data, of the global tag for
simulation). Each can be given instead (--era, --geometry, --conditions).

A MiniAOD file is turned into standard NanoAOD (cmsDriver.py -s NANO), which the `nano` profile draws. With `pat`,
a reconstruction file gets PAT and standard NanoAOD too (cmsDriver.py -s PAT,NANO), with ember's tables appended.
"""

import json
import os
import re
import shlex
import subprocess
import sys
import tempfile

from . import Problem, __version__, cmsrun

OUTPUT = cmsrun.OUTPUT

# The first run of each year of Run 3 data (the era of a data file follows its run number), and the last run known to
# be of the last year listed. The release records no such table: the year starts are those of each year's first
# runs, consistent with the runs of the release's data RelVals (Configuration/PyReleaseValidation relval_steps.py:
# 2022A 353015 ... 2025 UPC 400387). A later run gets the last era with a warning: 2026 has its own era (Run3_2026).
RUN3_YEARS = [(2022, 352319), (2023, 365739), (2024, 378238), (2025, 390000)]
RUN3_LAST_KNOWN = 400387


def describe(path):
    """("nano" or "edm", number of events, the CMSSW release that wrote it or None) of a ROOT file; a Problem if it
    is neither kind."""
    from .nano import open_file, written_by

    try:
        f = open_file(path)
    except Exception as e:  # noqa: BLE001 (uproot raises several kinds for a missing file, a non-ROOT file, no access)
        if not path.startswith("root://") and not os.path.exists(path):
            raise Problem(f"{path}: no such file") from None
        raise Problem(f"{path}: cannot be read as a ROOT file ({str(e).splitlines()[0][:200]})") from None
    with f:
        if "Events" not in f:
            raise Problem(f"{path}: no Events tree, so neither a NanoAOD nor a CMSSW reconstruction file")
        tree = f["Events"]
        if "EventAuxiliary" in tree:
            return "edm", tree.num_entries, written_by(f)
        if "run" in tree and "event" in tree:
            return "nano", tree.num_entries, written_by(f)
        raise Problem(f"{path}: its Events tree is neither NanoAOD (no run and event branches) nor CMSSW EDM")


def inventory(path):
    """What the EDM file at `path` holds (cmsrun.Inventory), from the names of its Events branches, with the class
    of each product (for unreadable())."""
    from .nano import open_file

    with open_file(path) as f:
        tree = f["Events"]
        branches = [b for b in tree.keys(recursive=False) if cmsrun.is_product(b)]
        classes = {b: str(tree[b].member("fClassName")) for b in branches if "fClassName" in tree[b].all_members}
        return cmsrun.Inventory(cmsrun.products(branches), classes)


# Runs in the CMSSW python: the branches whose class the release has no dictionary for (ROOT's class maps of the
# release name none), e.g. a development release's classes in its samples. cmsRun refuses to open such a file.
_DICTIONARIES = r"""
import json, sys
import ROOT
classes = json.load(sys.stdin)
print(json.dumps(sorted(b for b, c in classes.items() if not ROOT.gInterpreter.GetClassSharedLibs(c))))
"""


def unreadable(inv, prefix=(), env=None):
    """The products of the input whose class this release has no dictionary for (as Product tuples); none if that
    cannot be told. Cost: about 2 s, mostly importing ROOT."""
    if not inv.classes:
        return []
    out = cmssw_output([*prefix, "python3", "-c", _DICTIONARIES], env, "checking the input's classes", inv.classes)
    return cmsrun.products(json.loads(out))


def cmssw_output(command, env, what, data=None):
    """The output of a command run in the CMSSW environment (`data`: JSON on its input); a Problem that says to run
    cmsenv if it fails: CMSSW_BASE set by one shell and another python3 or PATH in this one (an LCG view sourced
    after cmsenv) break it in ways whose own messages do not say so."""
    try:
        result = subprocess.run(
            command, input=None if data is None else json.dumps(data), capture_output=True, text=True, env=env,
            check=False,
        )  # fmt: skip
    except FileNotFoundError:
        result = subprocess.CompletedProcess(command, 127, "", f"{command[0]}: not found")
    if result.returncode:
        raise Problem(
            f"{what} failed in the CMSSW environment: run cmsenv in this shell, in a CMSSW release area, then try "
            f"again (CMSSW_BASE is {os.environ.get('CMSSW_BASE') or 'not set'}). The command said:\n"
            + "\n".join(result.stderr.strip().splitlines()[-8:])
        )
    return result.stdout


def tier(inv):
    """ "mini" for MiniAOD (packed PF candidates, no general tracks), else "reco" (RECO, AOD, FEVT)."""
    mini = inv.has("packedPFCandidates") and not inv.has("generalTracks", product_type="recoTracks")
    return "mini" if mini else "reco"


def _stored_settings(blobs):
    """(global tags, lists of geometry XML files) named in the encoded parameter sets of an EDM file, each distinct
    value once, in file order. A string parameter is stored as name=+Z(text\\0), a list as name=+z({\\0a\\0,b\\0})."""
    tags = [m.decode() for m in re.findall(rb"globaltag=\+Z\(([^\x00)]+)\x00\)", blobs)]
    xml = [
        tuple(part.rstrip(b"\x00").decode() for part in m.split(b"\x00,") if part.strip(b"\x00"))
        for m in re.findall(rb"geomXMLFiles=\+z\(\{\x00?(.*?)\}\)", blobs, re.DOTALL)
    ]
    return list(dict.fromkeys(tags)), list(dict.fromkeys(xml))


def provenance(path):
    """(global tags, lists of geometry XML files) an EDM file was made with (see _stored_settings); two empty
    lists if its parameter sets cannot be read."""
    from .nano import branch_bytes, open_file

    try:
        with open_file(path) as f:
            return _stored_settings(branch_bytes(f["ParameterSets/IdToParameterSetsBlobs"]))
    except Exception:  # noqa: BLE001 (no such tree, or not readable: the settings are then asked for)
        return [], []


def geometry_name(geometry):
    """D110, Run4D110 or ExtendedRun4D110 -> ExtendedRun4D110 (what cmsDriver's --geometry takes); other names
    are passed as they are."""
    return re.sub(r"^(?:Extended)?(?:Run4)?(D\d+\w*)$", r"ExtendedRun4\1", geometry)


# Runs in the CMSSW python: the Run4 geometries of the release with their default era and conditions, which of them
# lists exactly the given geometry files, and the Run 3 eras of the release (Run3, Run3_2023, ...).
_RELEASE = r"""
import importlib, importlib.util, json, sys
from Configuration.PyReleaseValidation.upgradeWorkflowComponents import upgradeProperties
wanted = [list(x) for x in json.load(sys.stdin)]
out = {"known": {}, "matches": [], "run3": []}
for properties in upgradeProperties["Run4"].values():
    geometry = properties["Geom"]
    if geometry in out["known"]:
        continue
    out["known"][geometry] = {"era": properties["Era"], "conditions": properties["GT"]}
    try:
        cfi = importlib.import_module("Geometry.CMSCommonData.cms" + geometry.replace("Extended", "ExtendedGeometry", 1) + "XML_cfi")
        if list(cfi.XMLIdealGeometryESSource.geomXMLFiles) in wanted:
            out["matches"].append(geometry)
    except Exception:
        pass
for era in ["Run3"] + ["Run3_%d" % year for year in range(2023, 2031)]:
    if importlib.util.find_spec("Configuration.Eras.Era_%s_cff" % era):
        out["run3"].append(era)
print(json.dumps(out))
"""


def _environment(cmssw):
    """How to run a command in a CMSSW environment: (prefix of the command line, environment). `cmssw`: a CMSSW
    area to set up for it (cron jobs: the caller's own environment is not passed on, as another python's library
    paths would break cmsRun); None: this process's environment, which must be one."""
    if cmssw is None:
        if not os.environ.get("CMSSW_BASE"):
            raise Problem(
                "this is a CMSSW reconstruction file: turning it into NanoAOD runs cmsRun with modules of your "
                "CMSSW release, so run cmsenv in a release first"
            )
        return [], None
    setup = (
        f"source /cvmfs/cms.cern.ch/cmsset_default.sh && cd {shlex.quote(cmssw)} && eval $(scram runtime -sh)"
        ' && cd "$OLDPWD" && exec "$@"'
    )
    keep = {k: os.environ[k] for k in ("HOME", "USER", "KRB5CCNAME", "X509_USER_PROXY", "TMPDIR") if k in os.environ}
    return ["bash", "-c", setup, "ember"], {**keep, "PATH": "/usr/bin:/bin"}


def _release_settings(xml, prefix, env):
    """What the release says of its geometries and eras (see _RELEASE)."""
    return json.loads(cmssw_output([*prefix, "python3", "-c", _RELEASE], env, "reading the release's geometries", xml))


def newest_tag(tags):
    """The global tag of the last step that wrote the file: the one of the newest release (its leading number, e.g.
    201X > 200X), as a reconstruction runs in a release no older than the steps before it."""
    return max(tags, key=lambda t: (int(re.match(r"\d*", t).group() or 0), t))


def first_run(path, prefix=(), env=None):
    """The first run number of an EDM file (edmFileUtil), or None if it cannot be read."""
    result = subprocess.run(
        [*prefix, "edmFileUtil", "--eventsInLumis", path], capture_output=True, text=True, env=env, check=False
    )
    runs = re.findall(r"^\s*(\d+)\s+\d+\s+\d+\s*$", result.stdout, re.MULTILINE)
    return int(runs[0]) if runs else None


def settings(path, geometry=None, era=None, conditions=None, cmssw=None, log=sys.stderr, inv=None):
    """The cmsrun.Settings to export `path` with: what is given, else what the file records and the release's
    defaults. Says on `log` what was found; a Problem if something is still missing. `inv`: the file's inventory
    (whether it is data), read if not given."""
    prefix, env = _environment(cmssw)
    inv = inventory(path) if inv is None else inv
    data = not inv.has("genParticles")
    tags, xml = provenance(path)
    if geometry and era and conditions:
        phase2 = bool(re.match(r"^(?:Extended)?(?:Run4)?D\d+", geometry))
        return cmsrun.Settings(phase2, data, era, geometry_name(geometry) if phase2 else geometry, conditions)
    release = _release_settings(xml, prefix, env)
    phase2 = bool(geometry) or bool(release["matches"]) or (bool(xml) and not data)
    if phase2:
        return _phase2(path, geometry, era, conditions, tags, xml, release, data, log)
    return _run3(path, era, conditions, tags, release, data, prefix, env, log)


def _phase2(path, geometry, era, conditions, tags, xml, release, data, log):
    if geometry is None:
        if len(release["matches"]) != 1:
            if release["matches"]:
                found = f"it matches {' and '.join(release['matches'])}"
            elif xml:
                found = "none of this release's Run4 geometries lists its geometry files"
            else:
                found = "the file does not record its geometry files"
            raise Problem(
                f"{path}: cannot tell which geometry it was made with ({found}); give --geometry, e.g. --geometry D110"
            )
        geometry = release["matches"][0]
        print(f"geometry {geometry} (from the file's geometry files)", file=log)
    geometry = geometry_name(geometry)
    defaults = release["known"].get(geometry, {})
    if conditions is None and tags:
        conditions = newest_tag(tags)
        print(
            f"conditions {conditions} (the file's global tag"
            + (f", the newest of {', '.join(tags)}" if len(tags) > 1 else "")
            + ")",
            file=log,
        )
    elif conditions is None and defaults:
        conditions = defaults["conditions"]
        print(
            f"conditions {conditions} (this release's default for {geometry}"
            + (f"; the file names {', '.join(tags)}" if tags else "")
            + ")",
            file=log,
        )
    if era is None and defaults:
        era = defaults["era"]
        print(f"era {era} (this release's default for {geometry}; the file does not record its era)", file=log)
    missing = [name for name, value in (("--era", era), ("--conditions", conditions)) if value is None]
    if missing:
        raise Problem(f"{path}: this release has no default for geometry {geometry}; give {' and '.join(missing)}")
    return cmsrun.Settings(True, data, era, geometry, conditions)


def _run3(path, era, conditions, tags, release, data, prefix, env, log):
    """Run 3: the geometry from the conditions; the era of the year; the global tag the file's reconstruction used
    (data: its newest Prompt or Express tag)."""
    if conditions is None:
        if data:
            # the newest reconstruction tag: not the HLT's, which the file names too
            reco = [t for t in tags if re.search(r"_(Prompt|Express)", t)] or tags
            if reco:
                conditions = newest_tag(reco)
                print(
                    f"conditions {conditions} (the file's global tag"
                    + (f", the newest reconstruction one of {', '.join(tags)}" if len(tags) > 1 else "")
                    + ")",
                    file=log,
                )
            else:
                conditions = "auto:run3_data_prompt"
                print(f"conditions {conditions} (the file records no global tag)", file=log)
        elif tags:
            conditions = newest_tag(tags)
            print(f"conditions {conditions} (the file's global tag, the newest of {', '.join(tags)})", file=log)
        else:
            raise Problem(f"{path}: the file records no global tag; give --conditions")
    if era is None:
        eras = release["run3"]
        if data:
            run = first_run(path, prefix, env)
            year = next((y for y, first in reversed(RUN3_YEARS) if run and run >= first), None)
            if run is not None and year is None:
                raise Problem(f"{path}: run {run} is before Run 3; ember reads Phase 2 and Run 3 files only")
            how = f"run {run}" if run else "the newest year this release knows"
            if run and run > RUN3_LAST_KNOWN:
                print(
                    f"warning: run {run} is after the last run ember knows the year of ({RUN3_LAST_KNOWN}, 2025): "
                    f"taking the 2025 era; give --era (e.g. --era Run3_2026) if the run is of a later year",
                    file=log,
                )
        else:
            year = re.search(r"Run3_(\d{4})|(20\d\d)_realistic", conditions)
            year = int(year.group(1) or year.group(2)) if year else None
            how = f"the global tag {conditions}"
        name = eras[-1] if year is None and eras else "Run3" if year == 2022 else f"Run3_{year}"
        era = name if name in eras else None
        if era is None:
            raise Problem(f"{path}: cannot tell the era of this Run 3 file; give --era, e.g. --era Run3_2025")
        print(f"era {era} (from {how}; the file does not record its era)", file=log)
    return cmsrun.Settings(False, data, era, "", conditions)


def _source(path):
    """A URL or file:... as it is, a local path as file:<absolute path>."""
    return path if re.match(r"\w+:", path) else f"file:{os.path.abspath(path)}"


def cmsdriver(inputs, events, settings, threads=4, output=OUTPUT, step="NANO", hlt="HLT"):
    """The cmsDriver.py command line that writes standard NanoAOD (`step` "NANO" for a MiniAOD file, "PAT,NANO" for
    a reconstruction file) in a process named EMBER, and its configuration ember_cfg.py, without running it. `hlt`:
    the process name of the trigger the trigger objects come from (a RelVal that reran the trigger has a "reHLT"
    besides the original "HLT")."""
    tier = "NANOAOD" if settings.data else "NANOAODSIM"
    trigger = (
        ["--customise_commands", f'process.unpackedPatTrigger.triggerResults = cms.InputTag("TriggerResults::{hlt}")']
        if hlt != "HLT"
        else []
    )
    geometry = ["--geometry", settings.geometry] if settings.phase2 else []
    return [
        "cmsDriver.py", "ember", "-s", step, "--data" if settings.data else "--mc",
        "--filein", ",".join(map(_source, inputs)), "--fileout", f"file:{output}",
        "--eventcontent", tier, "--datatier", tier, "-n", str(events if events else -1),
        "--era", settings.era, *geometry, "--conditions", settings.conditions, "--processName", "EMBER",
        "--nThreads", str(threads), "--python_filename", cmsrun.CONFIG, "--no_exec", *trigger,
    ]  # fmt: skip


def export(
    inputs,
    workdir,
    events=None,
    geometry=None,
    era=None,
    conditions=None,
    cmssw=None,
    threads=4,
    log=sys.stderr,
    config=None,
    pat=False,
):
    """Write the cmsRun configuration for the EDM files `inputs` in `workdir` (a copy to `config` if given), run it
    there, and return the NanoAOD file it wrote. `pat`: for a reconstruction file, the physics objects of PAT and
    standard NanoAOD instead of ember's own tables of the RECO collections (cmsrun.config). When the job fails, the
    Problem raised shows the end of the job's output and where all of it was kept."""
    prefix, env = _environment(cmssw)
    inv = inventory(inputs[0])
    s = settings(inputs[0], geometry, era, conditions, cmssw, log, inv)
    path = os.path.join(workdir, cmsrun.CONFIG)
    reruns = [p.process for p in inv.items if p.type == "edmTriggerResults" and p.process.endswith("HLT")]
    hlt = next((p for p in reruns if p != "HLT"), "HLT")
    if tier(inv) == "mini":
        print("MiniAOD: standard NanoAOD (cmsDriver.py -s NANO)", file=log)
        _run([*prefix, *cmsdriver(inputs, events, s, threads, hlt=hlt)], workdir, env, "cmsDriver.log")
    else:
        if pat:
            print("--pat: PAT and standard NanoAOD (cmsDriver.py -s PAT,NANO), and ember's tables", file=log)
            command = cmsdriver(inputs, events, s, threads, step="PAT,NANO", hlt=hlt)
            _run([*prefix, *command], workdir, env, "cmsDriver.log")
        text, notes = cmsrun.config(
            s, list(map(_source, inputs)), events, inv, cmsrun.plugins(prefix, env), threads,
            made_by=f"embertools {__version__}", drop=unreadable(inv, prefix, env), pat=pat,
        )  # fmt: skip
        with open(path, "a" if pat else "w") as f:
            f.write(text)
        for note in notes:
            print(f"left out: {note}", file=log)
    if config:
        with open(path) as f, open(config, "w") as out:
            out.write(f.read())
    kept = f"kept as {config}" if config else "--config FILE.py keeps it"
    print(f"running cmsRun {cmsrun.CONFIG} ({kept})", file=log)
    _run([*prefix, "cmsRun", cmsrun.CONFIG], workdir, env, "cmsRun.log", keep=path)
    nano = os.path.join(workdir, OUTPUT)
    if not os.path.exists(nano):
        raise Problem(f"the export job wrote no {OUTPUT}")
    return nano


def _run(command, workdir, env, log_name, keep=None):
    """Run a command of the CMSSW environment in `workdir`, its output in `log_name` there; a Problem with the end
    of that output if it fails (all of it kept in a new temporary file, with a copy of the file `keep` beside it)."""
    log_path = os.path.join(workdir, log_name)
    with open(log_path, "w") as out:
        try:
            result = subprocess.run(command, cwd=workdir, stdout=out, stderr=subprocess.STDOUT, env=env, check=False)
        except FileNotFoundError:
            raise Problem(f"{command[0]} not found: run cmsenv first") from None
    if result.returncode:
        with open(log_path, errors="replace") as f:
            output = f.read()
        fd, kept = tempfile.mkstemp(prefix="ember-cmsRun-", suffix=".log")  # a new file, never one planted in /tmp
        with os.fdopen(fd, "w") as f:
            f.write(output)
        also = ""
        if keep:
            with open(keep) as f, open(kept[: -len(".log")] + "_cfg.py", "x") as out:  # "x": never an existing file
                out.write(f.read())
            also = f"; its configuration: {out.name}"
        tail = "\n".join(output.splitlines()[-25:])
        raise Problem(
            f"the export job failed (exit code {result.returncode}); the end of its output (all of it: {kept}{also}):"
            f"\n{tail}"
        )
