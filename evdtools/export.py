"""From a reconstruction (EDM) file to the NanoAOD the converter reads, by running the CMSSW event-display NanoAOD
flavour on it:

    cmsDriver.py evd -s NANO:@EVD --mc --filein file:step3.root --fileout file:evd_nano.root \\
        --eventcontent NANOAODSIM --datatier NANOAODSIM -n 10 --geometry G --era E --conditions C

The job needs the geometry, era and conditions the file was made with. The file records its global tag and the list
of geometry files (in its stored parameter sets); the era is not recorded anywhere, so it is the release's default
for that geometry (Configuration.PyReleaseValidation.upgradeWorkflowComponents.upgradeProperties). A file made with
another era needs --era.
"""
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile

import uproot

from . import Problem

STEP = "NANO:@EVD"
OUTPUT = "evd_nano.root"


def describe(path):
    """("nano" or "edm", number of events, the CMSSW release that wrote it or None) of a ROOT file; a Problem if it
    is neither kind."""
    from .nano import _open, written_by
    try:
        f = _open(path)
    except Exception as e:  # uproot raises several kinds for a missing file, a non-ROOT file, no access
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


def _stored_settings(blobs):
    """(global tags, lists of geometry XML files) named in the encoded parameter sets of an EDM file, each distinct
    value once, in file order. A string parameter is stored as name=+Z(text\\0), a list as name=+z({\\0a\\0,b\\0})."""
    tags = [m.decode() for m in re.findall(rb"globaltag=\+Z\(([^\x00)]+)\x00\)", blobs)]
    xml = [tuple(part.rstrip(b"\x00").decode() for part in m.split(b"\x00,") if part.strip(b"\x00"))
           for m in re.findall(rb"geomXMLFiles=\+z\(\{\x00?(.*?)\}\)", blobs, re.S)]
    return list(dict.fromkeys(tags)), list(dict.fromkeys(xml))


def provenance(path):
    """(global tags, lists of geometry XML files) an EDM file was made with (see _stored_settings); two empty
    lists if its parameter sets cannot be read."""
    from .nano import _open
    try:
        with _open(path) as f:
            branch = f["ParameterSets/IdToParameterSetsBlobs"]
            return _stored_settings(b"".join(bytes(branch.basket(i).data) for i in range(branch.num_baskets)))
    except Exception:
        return [], []


def geometry_name(geometry):
    """D110, Run4D110 or ExtendedRun4D110 -> ExtendedRun4D110 (what cmsDriver's --geometry takes); other names
    are passed as they are."""
    return re.sub(r"^(?:Extended)?(?:Run4)?(D\d+\w*)$", r"ExtendedRun4\1", geometry)


# Runs in the CMSSW python: the Run4 geometries of the release with their default era and conditions, and which of
# them lists exactly the given geometry files.
_RUN4 = r"""
import importlib, json, sys
from Configuration.PyReleaseValidation.upgradeWorkflowComponents import upgradeProperties
wanted = [list(x) for x in json.load(sys.stdin)]
out = {"known": {}, "matches": []}
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
print(json.dumps(out))
"""


def _environment(cmssw):
    """How to run a command in a CMSSW environment: (prefix of the command line, environment). `cmssw`: a CMSSW
    area to set up for it (cron jobs: the caller's own environment is not passed on, as another python's library
    paths would break cmsRun); None: this process's environment, which must be one."""
    if cmssw is None:
        if not os.environ.get("CMSSW_BASE"):
            raise Problem("this is a CMSSW reconstruction file: turning it into NanoAOD runs cmsRun, so run cmsenv "
                          "in a release that has the event-display NanoAOD (NANO:@EVD) first")
        return [], None
    setup = f"source /cvmfs/cms.cern.ch/cmsset_default.sh && cd {shlex.quote(cmssw)} && eval $(scram runtime -sh) && cd \"$OLDPWD\" && exec \"$@\""
    keep = {k: os.environ[k] for k in ("HOME", "USER", "KRB5CCNAME", "X509_USER_PROXY", "TMPDIR") if k in os.environ}
    return ["bash", "-c", setup, "evd"], {**keep, "PATH": "/usr/bin:/bin"}


def settings(path, geometry=None, era=None, conditions=None, cmssw=None, log=sys.stderr):
    """The (geometry, era, conditions) to export `path` with: what is given, else what the file records and the
    release's defaults for its geometry. Says on `log` what was found; a Problem if something is still missing."""
    prefix, env = _environment(cmssw)
    if geometry and era and conditions:
        return geometry_name(geometry), era, conditions
    tags, xml = provenance(path)
    result = subprocess.run([*prefix, "python3", "-c", _RUN4], input=json.dumps(xml), capture_output=True, text=True,
                            env=env)
    run4 = json.loads(result.stdout) if result.returncode == 0 else {"known": {}, "matches": []}
    # why the release's geometries could not be read, for whichever message below needs them
    why = f"\n(this release's Run4 geometries could not be read:\n{result.stderr.strip()[-500:]})" if result.returncode else ""
    if geometry is None:
        if len(run4["matches"]) != 1:
            found = (f"it matches {' and '.join(run4['matches'])}" if run4["matches"] else
                     "none of this release's Run4 geometries lists its geometry files" if xml else
                     "the file does not record its geometry files")
            raise Problem(f"{path}: cannot tell which geometry it was made with ({found}); give --geometry, "
                          "e.g. --geometry D110" + why)
        geometry = run4["matches"][0]
        print(f"geometry {geometry} (from the file's geometry files)", file=log)
    geometry = geometry_name(geometry)
    defaults = run4["known"].get(geometry, {})
    if conditions is None and len(tags) == 1:
        conditions = tags[0]
        print(f"conditions {conditions} (the file's global tag)", file=log)
    elif conditions is None and defaults:
        conditions = defaults["conditions"]
        print(f"conditions {conditions} (this release's default for {geometry}"
              + (f"; the file names {', '.join(tags)}" if tags else "") + ")", file=log)
    if era is None and defaults:
        era = defaults["era"]
        print(f"era {era} (this release's default for {geometry}; the file does not record its era)", file=log)
    missing = [name for name, value in (("--era", era), ("--conditions", conditions)) if value is None]
    if missing:
        raise Problem(f"{path}: this release has no default for geometry {geometry}; give {' and '.join(missing)}" + why)
    return geometry, era, conditions


def cmsdriver(inputs, events, geometry, era, conditions, threads=4, output=OUTPUT):
    """The cmsDriver.py command line that writes the event-display NanoAOD of the first `events` events (None:
    all) of the EDM files `inputs` to `output`, in the directory it runs in."""
    source = lambda p: p if re.match(r"\w+:", p) else f"file:{os.path.abspath(p)}"
    return ["cmsDriver.py", "evd", "-s", STEP, "--mc", "--filein", ",".join(map(source, inputs)),
            "--fileout", f"file:{output}", "--eventcontent", "NANOAODSIM", "--datatier", "NANOAODSIM",
            "-n", str(events if events else -1), "--geometry", geometry_name(geometry), "--era", era,
            "--conditions", conditions, "--nThreads", str(threads), "--python_filename", "evd_nano_cfg.py"]


def export(inputs, workdir, events=None, geometry=None, era=None, conditions=None, cmssw=None, threads=4,
           log=sys.stderr):
    """Run the export of the EDM files `inputs` in `workdir`; returns the NanoAOD file written there. When the job
    fails, the Problem raised says why if that is known (a release without the flavour), or else shows the end of
    the job's output and where all of it was kept."""
    geometry, era, conditions = settings(inputs[0], geometry, era, conditions, cmssw, log)
    command = cmsdriver(inputs, events, geometry, era, conditions, threads)
    prefix, env = _environment(cmssw)
    print(f"running {' '.join(map(shlex.quote, command))}", file=log)
    log_path = os.path.join(workdir, "cmsRun.log")
    with open(log_path, "w") as out:
        try:
            result = subprocess.run([*prefix, *command], cwd=workdir, stdout=out, stderr=subprocess.STDOUT, env=env)
        except FileNotFoundError:
            raise Problem("cmsDriver.py not found: run cmsenv first") from None
    nano = os.path.join(workdir, OUTPUT)
    if result.returncode or not os.path.exists(nano):
        with open(log_path, errors="replace") as f:
            output = f.read()
        if "Impossible to map" in output:  # cmsDriver does not know the flavour (and prints all those it knows)
            raise Problem(f"this CMSSW release has no {STEP}. The event-display NanoAOD is the package "
                          "DPGAnalysis/EventDisplayNanoAOD: use a release that has it, or add the package to your "
                          "area as the evd documentation says (Getting started), then cmsenv and try again")
        fd, kept = tempfile.mkstemp(prefix="evd-cmsRun-", suffix=".log")  # a new file, never one planted in /tmp
        with os.fdopen(fd, "w") as f:
            f.write(output)
        tail = "\n".join(output.splitlines()[-25:])
        raise Problem(f"the export job failed (exit code {result.returncode}); the end of its output (all of it: "
                      f"{kept}):\n{tail}")
    return nano
