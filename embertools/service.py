"""Keep an Ember site in sync with campaigns of NanoAOD files (run from cron, e.g. every 15 minutes).

Each input file becomes one bundle, <site>/data/<campaign>/<file stem>.ember, written once and skipped afterwards
(a <file stem>.evdb, from before the project was called Ember, counts as written); then <site>/index.json is rebuilt
from the bundles present, newest data first. Safe to repeat and to overlap: bundles and the index are replaced by
atomic renames, and a lock directory keeps two runs from converting the same file. Inputs still being written
(modified in the last `settle` seconds) wait for the next run; a file that fails `max_failures` times is skipped
until its entry is removed from <state>/failures.json.

The configuration (JSON) is described in service/README.md ("Campaigns"); service/campaigns.example.json has every key.
"""

import contextlib
import copy
import datetime
import glob
import json
import os
import re
import secrets
import shutil
import socket
import tempfile
import time

from .bundle import Bundle, summary
from .site import EXTENSION, EXTENSIONS, USERS, replacing, service_dir, site_dir

LOCK_STALE = 3 * 3600  # s: a lock untouched for this long was left by a pass that died (see _take_lock)
# s: a partial bundle unwritten for this long is not being written (a writer adds a record every few s)
PARTIAL_QUIET = 1800


def now():
    """The time now, as ISO 8601 text in UTC."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def log(*args):
    """Print a line to the cron log, with the time."""
    print(now(), *args, flush=True)


class _Log:
    """A file-like object for the messages of a step of the pass (e.g. the export): each line is logged with the time,
    as log() writes it."""

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
    """Replace the JSON file `path` by a rename, so that a reader never sees half of it."""
    with replacing(path, "w") as f:
        json.dump(data, f, indent=1)


def _stem(campaign, path):
    """Name of an input's bundle: the file name without extension, or with "stem": "wildcards" the parts of the path
    matched by the `inputs` pattern's wildcards, joined by "_" (for inputs that share a file name, e.g. one
    Events_1.root per run directory)."""
    if campaign.get("stem") != "wildcards":
        return os.path.splitext(os.path.basename(path))[0]
    parts = re.fullmatch(_wildcards(campaign["inputs"]), path).groups()
    return "_".join(parts[k] for k in campaign["stem_parts"]) if "stem_parts" in campaign else "_".join(parts)


def _wildcards(pattern):
    """The glob `pattern` as a regular expression with one group per wildcard (*, ? or [...]), as glob matches them:
    none of them matches a "/". In a class, "!" first negates it and a "]" right after the "[" (or "[!") is a
    character, as in glob; everything else in it is taken literally, except ranges such as 0-9."""
    out = []
    for part in re.split(r"(\*+|\?|\[!?\]?[^\]]*\])", pattern):
        if part.startswith("*"):  # "**" matches as "*" does, without recursive=True
            out.append("([^/]*)")
        elif part == "?":
            out.append("([^/])")
        elif part.startswith("[") and len(part) > 2:
            body = part[1:-1]
            negated = body.startswith("!")
            body = body[1:] if negated else body
            body = "".join("\\" + c if c in "\\]^[" else c for c in body)
            out.append(f"([{'^/' if negated else ''}{body}])")
        else:
            out.append(re.escape(part))
    return "".join(out)


def pending(campaign, site, settle, failures, max_failures):
    """(input path, bundle path, key in failures) of the inputs of a campaign that have no bundle yet, oldest first.
    Files still being written (modified less than `settle` seconds ago) and files given up on are skipped. Of inputs
    that would make the same bundle (see stem_parts), only the first is taken."""
    out, targets = [], set()
    for path in sorted(glob.glob(campaign["inputs"]), key=_natural):
        stem = _stem(campaign, path)
        target = os.path.join(site, "data", campaign["name"], f"{stem}{EXTENSION}")
        key = f"{campaign['name']}/{stem}"
        if (
            any(os.path.exists(os.path.join(site, "data", campaign["name"], stem + e)) for e in EXTENSIONS)
            or target in targets
            or failures.get(key, 0) >= max_failures
            or time.time() - _mtime(path) < settle
        ):
            continue
        targets.add(target)
        out.append((path, target, key))
    return out


def _mtime(path):
    """When `path` was last modified; for a file removed since the glob found it, now (it waits, and is gone next
    time)."""
    try:
        return os.path.getmtime(path)
    except FileNotFoundError:
        return time.time()


def _remember_title(site, campaign, file_titles=None):
    """Write the campaign's title (and titles of files, if given) to data/<campaign>/campaign.json, so that whichever
    process rewrites the index can show them."""
    folder = os.path.join(site, "data", campaign["name"])
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, "campaign.json")
    try:
        with open(path) as f:
            files = json.load(f).get("files", {})
    except (OSError, ValueError, AttributeError):  # none yet, or not what this function wrote: start again
        files = {}
    _write_json(path, {"title": campaign.get("title", campaign["name"]), "files": {**files, **(file_titles or {})}})


def build_index(site):
    """The site's index.json for the viewer: every non-empty bundle of the campaigns, newest data first. The users'
    folder (data/u/, see embertools/site.py) is not a campaign: nothing in it is listed. A file that cannot be read is
    logged and left out."""
    users = os.path.join(site, USERS)

    def campaign_files(pattern):
        return [p for p in glob.glob(os.path.join(site, "data", "*", pattern)) if os.path.dirname(p) != users]

    titles, file_titles = {}, {}
    for path in campaign_files("campaign.json"):
        try:
            with open(path) as f:
                meta = json.load(f)
            titles[os.path.basename(os.path.dirname(path))] = meta["title"]
            file_titles.update(
                {f"{os.path.basename(os.path.dirname(path))}/{k}": v for k, v in meta.get("files", {}).items()}
            )
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
            log(f"skipping unreadable {path}: {e!r}")
    bundles = []
    for path in [p for e in EXTENSIONS for p in campaign_files(f"*{e}")]:
        campaign, stem = os.path.basename(os.path.dirname(path)), os.path.splitext(os.path.basename(path))[0]
        try:
            header, events = summary(path)
            source = header["source"]
        except (OSError, ValueError, KeyError) as e:
            log(f"skipping unreadable {path}: {e}")
            continue
        if not events:
            continue
        part = re.search(r"_(\d+)$", stem)
        name = (
            file_titles.get(f"{campaign}/{stem}")
            or f"{titles.get(campaign, campaign)} · {f'file {int(part.group(1))}' if part else stem}"
        )
        bundles.append(
            {
                "file": os.path.relpath(path, site),
                "campaign": campaign,
                "campaign_title": titles.get(campaign, campaign),
                "events": events,
                "title": f"{name} · {events} events",
                "data_time": source.get("data_time") or source.get("created"),
                "created": source.get("created"),
            }
        )
    bundles.sort(key=lambda x: (x["data_time"] or "", _natural(x["file"])), reverse=True)
    return {"updated": now(), "bundles": bundles}


def sync(config, max_files=None, dry_run=False, convert=None, export=None):
    """One pass: convert up to `max_files` new inputs, then rewrite the index. Returns the number converted.
    `config` is the campaigns configuration; `convert` and `export` stand in for nano.convert and export.export in
    tests."""
    site = config.get("site") or site_dir()
    state = config.get("state") or os.path.join(service_dir(), "state")
    if any(c["name"] == "u" for c in config["campaigns"]):
        raise ValueError("a campaign cannot be named u: data/u/ holds the users' areas")
    settle, max_failures = config.get("settle", 600), config.get("max_failures", 3)
    os.makedirs(state, exist_ok=True)
    os.makedirs(site, exist_ok=True)
    lock = os.path.join(state, "lock")
    token = _take_lock(lock, site)
    if token is None:
        log("another sync is running; nothing to do")
        return 0

    try:
        failures_path = os.path.join(state, "failures.json")
        failures = {}
        if os.path.exists(failures_path):
            with open(failures_path) as f:
                failures = json.load(f)
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
            os.utime(lock)  # still alive: the lock's age is the time since the last input started
            try:
                n = _convert_input(campaign, path, source, target, convert, export)
                log(f"{key}: {n} events in {time.time() - started:.0f} s")
                done += 1
            except Exception as e:  # noqa: BLE001
                # Keep going with the other files; give up on this one after max_failures.
                failures[key] = failures.get(key, 0) + 1
                _write_json(failures_path, failures)
                log(f"{key}: failed ({failures[key]}/{max_failures}): {e!r}")
        if not dry_run:
            _write_json(os.path.join(site, "index.json"), build_index(site))
            log("index updated")
        return done
    finally:
        _release_lock(lock, token)


def _take_lock(lock, site):
    """Take the lock of the sync passes, a directory: os.mkdir is atomic, so only one pass creates it. Returns the
    token written in it, or None if another pass holds it. The holder touches the lock before each input, so a lock
    untouched for LOCK_STALE was left by a pass that died. It is taken over by a rename, which only one of several
    passes can win, and the partial bundles that pass left are removed: those not written for PARTIAL_QUIET (the dead
    pass may have written its last record well after it last touched the lock)."""
    token = f"{socket.gethostname()}.{os.getpid()}.{secrets.token_hex(4)}"
    try:
        os.mkdir(lock)
    except FileExistsError:
        try:
            if time.time() - os.path.getmtime(lock) < LOCK_STALE:
                return None
            os.rename(lock, f"{lock}.stale.{token}")
        except FileNotFoundError:  # another pass took it over first
            return None
        log("took over a stale lock; removing the partial bundles of the pass that left it")
        shutil.rmtree(f"{lock}.stale.{token}", ignore_errors=True)
        for extension in EXTENSIONS:
            for tmp in glob.glob(os.path.join(site, "data", "*", f"*{extension}.tmp*")):
                if time.time() - os.path.getmtime(tmp) >= PARTIAL_QUIET:
                    os.remove(tmp)
        try:
            os.mkdir(lock)
        except FileExistsError:  # a new pass started meanwhile
            return None
    with open(os.path.join(lock, "owner"), "w") as f:
        f.write(token)
    return token


def _release_lock(lock, token):
    """Remove the lock if it is still this pass's (a pass that ran too long may have lost it to another)."""
    try:
        with open(os.path.join(lock, "owner")) as f:
            if f.read() != token:
                return
    except OSError:
        return
    shutil.rmtree(lock, ignore_errors=True)


def _convert_input(campaign, path, source, target, convert, export):
    """Convert the input `path` of a campaign (read from `source`) to the bundle `target`; returns the number of
    events. A reconstruction file is first exported to NanoAOD, in a temporary folder."""
    limit = campaign.get("max_events") or None  # as on the command line, 0 means all
    with tempfile.TemporaryDirectory(prefix="ember-export-") as work:
        if campaign.get("export"):
            source = export([source], work, limit, log=_Log(), **campaign["export"])
        return convert(
            [source],
            target,
            campaign["profile"],
            limit,
            data_time=datetime.datetime.fromtimestamp(os.path.getmtime(path), datetime.timezone.utc),
            **({"run_info": campaign["runInfo"]} if campaign.get("runInfo") else {}),
        )


def simulate(
    source, site, campaign="live_demo", title="Simulated live data", events=5, interval=60.0, start=0, sleep=time.sleep
):
    """Stand-in for new data arriving: every `interval` seconds, publish the next `events` events of the bundle
    `source` as a new file data/<campaign>/part_NNNN.ember (as sync would), then rewrite the index. Returns the number
    of files written. Records (events, and the per-run tables of their runs) are copied as they are, so the viewer
    cannot tell them from converted data."""
    from .bundle import BundleWriter

    src = Bundle(source)
    folder = os.path.join(site, "data", campaign)
    _remember_title(site, {"name": campaign, "title": title})
    written = 0
    for first in range(start, len(src), events):
        part = os.path.join(folder, f"part_{first // events + 1:04d}{EXTENSION}")
        header = copy.deepcopy(src.header)
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


def publish_to_campaign(bundle, site, campaign, title, name=None, file_title=None):
    """Add a finished bundle (e.g. a simulated sample) to the site as data/<campaign>/<name>.ember, with an optional
    title of its own, and rewrite the index. The copy is renamed into place, so readers never see half a file. A
    bundle of that name with the older extension .evdb is replaced too: it is removed once the new one is there."""
    summary(bundle)  # refuse anything that is not a complete bundle
    stem = name or os.path.splitext(os.path.basename(bundle))[0]
    _remember_title(site, {"name": campaign, "title": title}, {stem: file_title} if file_title else None)
    target, *older = (os.path.join(site, "data", campaign, stem + e) for e in EXTENSIONS)
    with replacing(target) as out, open(bundle, "rb") as f:
        shutil.copyfileobj(f, out)
    for path in older:
        with contextlib.suppress(FileNotFoundError):
            os.remove(path)
    _write_json(os.path.join(site, "index.json"), build_index(site))
    log(f"published {os.path.relpath(target, site)}")
    return target
