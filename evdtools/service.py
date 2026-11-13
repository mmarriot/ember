"""Keep an event-display site in sync with campaigns of NanoAOD files (run from cron, e.g. every 15 minutes).

Each input file becomes one bundle, <site>/data/<campaign>/<file stem>.evdb, written once and skipped afterwards;
then <site>/index.json is rebuilt from the bundles present, newest data first. Safe to repeat and to overlap: bundles
and the index are replaced by atomic renames, and a lock directory keeps two runs from converting the same file.
Inputs still being written (modified in the last `settle` seconds) wait for the next run; a file that fails
`max_failures` times is skipped until its entry is removed from <state>/failures.json.

Config (JSON; service/campaigns.example.json shows every key):
  {"campaigns": [{"name": "mct_22000077", "title": "MCT run 22000077", "profile": "mct", "max_events": 1000,
                  "inputs": "/eos/cms/store/.../Run22000077/*/NANO_22000077_*.root",
                  "xrootd": "root://eoscms.cern.ch/"}]}
  "site" and "state" default to the site of evdtools/site.py (EVD_SITE_DIR) and <EVD_SERVICE_DIR>/state.
  Optional per campaign: "stem": "wildcards" names bundles after the wildcard parts of the input path, and with
  "stem_parts": [0, 2] after those wildcards only, so that inputs differing in the others share a name and only the
  first of them is converted (one bundle per RelVal sample, whatever its files are called);
  "runInfo": where to find information about the runs (see evdtools/runinfo.py), e.g. "registry:RunRegistryP5.RunTable";
  "export": {"cmssw": area, "geometry": "D110", ...}: the inputs are CMSSW reconstruction files (e.g. RelVals), and
  the event-display NanoAOD of their first `max_events` events is made first, in that CMSSW area (evdtools/export.py;
  optional "era", "conditions", "threads").
"""
import datetime
import glob
import json
import os
import re
import shutil
import tempfile
import time

from .bundle import Bundle
from .site import service_dir, site_dir

LOCK_STALE = 3 * 3600  # s: a lock older than this was left by a run that died


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def log(*args):
    print(now(), *args, flush=True)


class _Log:
    """A file for the messages of a step of the pass, each line with the time, as log() writes them."""

    def write(self, text):
        for line in text.splitlines():
            if line.strip():
                log(line)

    def flush(self):
        pass


def _natural(path):
    """Sort key: NANO_22000077_10 after NANO_22000077_9."""
    return [int(s) if s.isdigit() else s for s in re.split(r"(\d+)", path)]


def _write_json(path, data):
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def _stem(campaign, path):
    """Name of an input's bundle: the file name without extension, or with "stem": "wildcards" the parts of the path
    matched by the `inputs` pattern's wildcards, joined by "_" (for inputs that share a file name, e.g. one
    Events_1.root per run directory)."""
    if campaign.get("stem") != "wildcards":
        return os.path.splitext(os.path.basename(path))[0]
    pattern = "".join("([^/]*)" if part == "*" else re.escape(part) for part in re.split(r"(\*)", campaign["inputs"]))
    parts = re.fullmatch(pattern, path).groups()
    return "_".join(parts[k] for k in campaign["stem_parts"]) if "stem_parts" in campaign else "_".join(parts)


def pending(campaign, site, settle, failures, max_failures):
    """Inputs of a campaign without a bundle yet, oldest first, skipping files still being written or given up on;
    of inputs that would make the same bundle (see stem_parts), the first."""
    out, targets = [], set()
    for path in sorted(glob.glob(campaign["inputs"]), key=_natural):
        stem = _stem(campaign, path)
        target = os.path.join(site, "data", campaign["name"], f"{stem}.evdb")
        key = f"{campaign['name']}/{stem}"
        if os.path.exists(target) or target in targets or failures.get(key, 0) >= max_failures \
                or time.time() - os.path.getmtime(path) < settle:
            continue
        targets.add(target)
        out.append((path, target, key))
    return out


def _remember_title(site, campaign, file_titles=None):
    """data/<campaign>/campaign.json keeps the campaign's title (and optional titles per file), so any process
    rewriting the index can show them."""
    folder = os.path.join(site, "data", campaign["name"])
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, "campaign.json")
    files = json.load(open(path)).get("files", {}) if os.path.exists(path) else {}
    _write_json(path, {"title": campaign.get("title", campaign["name"]), "files": {**files, **(file_titles or {})}})


def build_index(site):
    """index.json for the viewer: every non-empty bundle, newest data first."""
    titles, file_titles = {}, {}
    for path in glob.glob(os.path.join(site, "data", "*", "campaign.json")):
        with open(path) as f:
            meta = json.load(f)
        titles[os.path.basename(os.path.dirname(path))] = meta["title"]
        file_titles.update({f"{os.path.basename(os.path.dirname(path))}/{k}": v for k, v in meta.get("files", {}).items()})
    bundles = []
    for path in glob.glob(os.path.join(site, "data", "*", "*.evdb")):
        campaign, stem = os.path.basename(os.path.dirname(path)), os.path.splitext(os.path.basename(path))[0]
        try:
            b = Bundle(path)
            b._file.close()  # only the header and index are needed
        except (OSError, ValueError) as e:
            log(f"skipping unreadable {path}: {e}")
            continue
        if not len(b):
            continue
        part = re.search(r"_(\d+)$", stem)
        name = file_titles.get(f"{campaign}/{stem}") or f"{titles.get(campaign, campaign)} · {f'file {int(part.group(1))}' if part else stem}"
        bundles.append({
            "file": os.path.relpath(path, site), "campaign": campaign, "campaign_title": titles.get(campaign, campaign),
            "events": len(b), "title": f"{name} · {len(b)} events",
            "data_time": b.header["source"].get("data_time") or b.header["source"].get("created"),
            "created": b.header["source"].get("created"),
        })
    bundles.sort(key=lambda x: (x["data_time"] or "", _natural(x["file"])), reverse=True)
    return {"updated": now(), "bundles": bundles}


def sync(config, max_files=None, dry_run=False, convert=None, export=None):
    """One pass: convert up to `max_files` new inputs, then rewrite the index. Returns the number converted."""
    site = config.get("site") or site_dir()
    state = config.get("state") or os.path.join(service_dir(), "state")
    if any(c["name"] == "u" for c in config["campaigns"]):
        raise ValueError("a campaign cannot be named u: data/u/ holds the users' areas")
    settle, max_failures = config.get("settle", 600), config.get("max_failures", 3)
    os.makedirs(state, exist_ok=True)
    os.makedirs(site, exist_ok=True)
    lock = os.path.join(state, "lock")
    try:
        os.mkdir(lock)  # atomic: only one run gets it
    except FileExistsError:
        if time.time() - os.path.getmtime(lock) < LOCK_STALE:
            log("another sync is running; nothing to do")
            return 0
        log("removing a stale lock, and partial bundles of the run that left it")
        shutil.rmtree(lock, ignore_errors=True)
        for tmp in glob.glob(os.path.join(site, "data", "*", "*.evdb.tmp*")):
            os.remove(tmp)
        os.mkdir(lock)
    try:
        failures_path = os.path.join(state, "failures.json")
        failures = json.load(open(failures_path)) if os.path.exists(failures_path) else {}
        if not dry_run:
            for c in config["campaigns"]:
                _remember_title(site, c)
        todo = [(c, *p) for c in config["campaigns"] for p in pending(c, site, settle, failures, max_failures)]
        log(f"{len(todo)} input file(s) to convert" + (f", doing at most {max_files}" if max_files else ""))
        done = 0
        for campaign, path, target, key in todo[:max_files]:
            if dry_run:
                log(f"would convert {path} -> {target}")
                continue
            if convert is None:
                from .nano import convert  # needs uproot
            if export is None and campaign.get("export"):
                from .export import export
            os.makedirs(os.path.dirname(target), exist_ok=True)
            source = campaign["xrootd"] + path if campaign.get("xrootd") else path
            started = time.time()
            try:
                with tempfile.TemporaryDirectory(prefix="evd-export-") as work:
                    if campaign.get("export"):  # a reconstruction file: its event-display NanoAOD first
                        source = export([source], work, campaign.get("max_events"), log=_Log(), **campaign["export"])
                    n = convert([source], target, campaign["profile"], campaign.get("max_events"),
                                data_time=datetime.datetime.fromtimestamp(os.path.getmtime(path), datetime.timezone.utc),
                                **({"run_info": campaign["runInfo"]} if campaign.get("runInfo") else {}))
                log(f"{key}: {n} events in {time.time() - started:.0f} s")
                done += 1
            except Exception as e:  # keep going with the other files; give up on this one after max_failures
                failures[key] = failures.get(key, 0) + 1
                _write_json(failures_path, failures)
                log(f"{key}: failed ({failures[key]}/{max_failures}): {e!r}")
        if not dry_run:
            _write_json(os.path.join(site, "index.json"), build_index(site))
            log("index updated")
        return done
    finally:
        shutil.rmtree(lock, ignore_errors=True)


def simulate(source, site, campaign="live_demo", title="Simulated live data", events=5, interval=60.0, start=0,
             sleep=time.sleep):
    """Stand-in for new data arriving: every `interval` seconds, publish the next `events` events of the bundle
    `source` as a new file data/<campaign>/part_NNNN.evdb (as sync would), then rewrite the index. Returns the number
    of files written. Records (events, and the per-run tables of their runs) are copied as they are, so the viewer
    cannot tell them from converted data."""
    from .bundle import BundleWriter

    src = Bundle(source)
    folder = os.path.join(site, "data", campaign)
    _remember_title(site, {"name": campaign, "title": title})
    written = 0
    for first in range(start, len(src), events):
        part = os.path.join(folder, f"part_{first // events + 1:04d}.evdb")
        header = json.loads(json.dumps(src.header))  # a copy
        header["source"].update(data_time=now(), created=now())
        with BundleWriter(part, header) as out:
            for i in range(first, min(first + events, len(src))):
                ev = src.event(i)
                out.add(ev["event"], ev["tables"], ev["relations"])
            for run in sorted(out.runs()):  # each part carries the per-run tables and run info of its runs
                if tables := src.run(run):
                    out.add_run((run, 0, 0), tables, {})
            out.set_run_info({run: src.run_info(run) for run in out.runs()})
        _write_json(os.path.join(site, "index.json"), build_index(site))
        written += 1
        log(f"published {os.path.relpath(part, site)} (events {first}-{min(first + events, len(src)) - 1})")
        if first + events < len(src):
            sleep(interval)
    return written


def publish(bundle, site, campaign, title, name=None, file_title=None):
    """Add a finished bundle (e.g. a simulated sample) to the site as data/<campaign>/<name>.evdb, with an optional
    title of its own, and rewrite the index. The copy is renamed into place, so readers never see half a file."""
    Bundle(bundle)._file.close()  # refuse anything that is not a complete bundle
    stem = name or os.path.splitext(os.path.basename(bundle))[0]
    _remember_title(site, {"name": campaign, "title": title}, {stem: file_title} if file_title else None)
    target = os.path.join(site, "data", campaign, f"{stem}.evdb")
    shutil.copyfile(bundle, f"{target}.tmp{os.getpid()}")
    os.replace(f"{target}.tmp{os.getpid()}", target)
    _write_json(os.path.join(site, "index.json"), build_index(site))
    log(f"published {os.path.relpath(target, site)}")
    return target
