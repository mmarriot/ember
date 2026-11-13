"""Where the event-display site is, and each user's area on it.

    <site>/data/u/<login>/<name>.evdb   a user's bundles, written by `evd view`
    <site>/data/u/<login>/index.json    that user's list, newest first:
                                        {"updated", "bundles": [{"file", "title", "events", "size", "created", "expires"}]}

`file` is relative to the site, so a share link is <url>/#b=<file>. A bundle is kept KEEP_DAYS days after it was last
published (`evd clean`, run from cron, removes older ones); publishing it again renews it.

The site is a directory. Where it is mounted (lxplus mounts /eos) files are copied into it; elsewhere an /eos path is
reached through XRootD with xrdcp and xrdfs, which every CMSSW environment has and which need a Kerberos ticket.
"""
import datetime
import getpass
import glob
import json
import os
import re
import shutil
import subprocess
import tempfile
import time

from . import Problem

# Placeholders until the CMS site exists: the EOS project space the site is served from, its address, and the folder
# beside the site that holds what the cron jobs run and their state. Set EVD_SITE_DIR, EVD_SITE_URL and
# EVD_SERVICE_DIR to use another site.
DEFAULT_DIR = "/eos/project/c/cms-evd/www"
DEFAULT_URL = "https://cms-evd.web.cern.ch"
DEFAULT_SERVICE = "/eos/project/c/cms-evd/service"
KEEP_DAYS = 30
USERS = "data/u"  # the per-user areas, relative to the site
EOS = {"/eos/project/": "root://eosproject.cern.ch/", "/eos/user/": "root://eosuser.cern.ch/",
       "/eos/cms/": "root://eoscms.cern.ch/"}


def site_dir(given=None):
    return given or os.environ.get("EVD_SITE_DIR") or DEFAULT_DIR


def site_url(given=None):
    return (given or os.environ.get("EVD_SITE_URL") or DEFAULT_URL).rstrip("/")


def service_dir(given=None):
    return given or os.environ.get("EVD_SERVICE_DIR") or DEFAULT_SERVICE


def login(given=None):
    """Whose area: the account name, which on lxplus is the CERN login the site knows the user by."""
    return given or os.environ.get("EVD_USER") or getpass.getuser()


def link(url, user, name):
    return f"{url}/#b={USERS}/{user}/{name}.evdb"


def check_name(name):
    """A bundle's name is part of its address: letters, digits, '.', '_' and '-' only."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise Problem(f"'{name}' cannot be a bundle name: use letters, digits, '.', '_' and '-' (see --name)")
    return name


def _iso(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).isoformat(timespec="seconds")


class _Mounted:
    """The site as a directory of this machine."""

    def __init__(self, root):
        self.root = root

    def read(self, path):
        """The bytes of <site>/path, or None if there is no such file."""
        try:
            with open(os.path.join(self.root, path), "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None

    def put(self, source, path):
        """Copy the local file `source` to <site>/path; it appears there complete or not at all."""
        target = os.path.join(self.root, path)
        try:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copyfile(source, f"{target}.tmp{os.getpid()}")
            os.replace(f"{target}.tmp{os.getpid()}", target)
        except PermissionError as e:
            raise Problem(f"cannot write to {os.path.dirname(target)}: {e.strerror}. The user areas of the site are "
                          "writable by CMS members only; -o FILE writes the bundle here instead") from None

    def remove(self, path):
        """Remove <site>/path; False if there was no such file."""
        try:
            os.remove(os.path.join(self.root, path))
            return True
        except FileNotFoundError:
            return False


class _XRootD:
    """The site on an EOS instance this machine does not mount, through xrdcp and xrdfs."""

    def __init__(self, host, root):
        self.host, self.root = host, root

    def _run(self, *command):
        try:
            return subprocess.run(command, capture_output=True)
        except FileNotFoundError:
            raise Problem(f"{command[0]} not found: the site is not mounted on this machine, and reaching it through "
                          "XRootD needs xrdcp and xrdfs (run cmsenv first)") from None

    def _fail(self, what, result):
        error = result.stderr.decode(errors="replace").strip()
        if re.search(r"auth|credential|ticket|permission denied|not authorized", error, re.I):
            raise Problem(f"cannot {what}: {self.host} refused ({error.splitlines()[-1]}). Get a Kerberos ticket "
                          "with `kinit <login>@CERN.CH`; the user areas of the site are writable by CMS members")
        raise Problem(f"cannot {what}: {error or 'xrootd error'}")

    def _url(self, path):
        return f"{self.host}{self.root}/{path}"  # root://host//eos/...

    def read(self, path):
        result = self._run("xrdcp", "-s", "-f", self._url(path), "-")
        if result.returncode == 0:
            return result.stdout
        if re.search(rb"no such file|\[3011\]", result.stderr, re.I):
            return None
        self._fail(f"read {self.root}/{path}", result)

    def put(self, source, path):
        target, partial = f"{self.root}/{path}", f"{path}.tmp{os.getpid()}"
        for step in (("xrdfs", self.host, "mkdir", "-p", os.path.dirname(target)),
                     ("xrdcp", "-s", "-f", source, self._url(partial)),
                     ("xrdfs", self.host, "mv", f"{self.root}/{partial}", target)):  # EOS renames over an old file
            result = self._run(*step)
            if result.returncode:
                self._fail(f"write {target}", result)

    def remove(self, path):
        result = self._run("xrdfs", self.host, "rm", f"{self.root}/{path}")
        if result.returncode and not re.search(rb"no such file|\[3011\]", result.stderr, re.I):
            self._fail(f"remove {self.root}/{path}", result)
        return result.returncode == 0


def store(site):
    """The site at `site`: a directory here, or root://host//path, or an /eos path this machine does not mount."""
    url = re.fullmatch(r"(root://[^/]+)/(/.*?)/*", site)
    if url:
        return _XRootD(url.group(1) + "/", url.group(2))
    if os.path.isdir(site):
        return _Mounted(site)
    host = next((h for prefix, h in EOS.items() if site.startswith(prefix)), None)
    if host:
        return _XRootD(host, site.rstrip("/"))
    raise Problem(f"the site directory {site} does not exist (set EVD_SITE_DIR or --site, or write the bundle here "
                  "with -o FILE)")


def _listing(files, user):
    data = files.read(f"{USERS}/{user}/index.json")
    try:
        return json.loads(data)["bundles"] if data else []
    except (ValueError, KeyError, TypeError):
        return []  # not an index: the next publish writes a new one


def listing(site, user):
    """The index entries of a user's bundles, newest first."""
    return _listing(store(site), user)


def _write_index(files, user, entries):
    entries = sorted(entries, key=lambda e: e.get("created") or "", reverse=True)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"updated": _iso(time.time()), "bundles": entries}, f, indent=1)
    try:
        files.put(f.name, f"{USERS}/{user}/index.json")
    finally:
        os.remove(f.name)


def _entry(bundle, file, title, modified, days):
    """The index entry of the local bundle file `bundle`, published as `file` and last written at `modified`."""
    from .bundle import Bundle  # here, so that the site's location can be asked for (below) without numpy
    b = Bundle(bundle)  # refuses anything that is not a complete bundle
    b._file.close()
    return {"file": file, "title": f"{title} · {len(b)} events", "events": len(b), "size": os.path.getsize(bundle),
            "created": b.header["source"].get("created"), "expires": _iso(modified + days * 86400)}


def publish(bundle, site, user, name, title=None, days=KEEP_DAYS):
    """Put the bundle file `bundle` in the user's area as `name` and list it; a bundle of that name is replaced.
    Returns (its index entry, whether it replaced one)."""
    file = f"{USERS}/{user}/{check_name(name)}.evdb"
    entry = _entry(bundle, file, title or name, time.time(), days)
    files = store(site)
    before = _listing(files, user)
    others = [e for e in before if e.get("file") != file]
    files.put(bundle, file)
    _write_index(files, user, [entry, *others])
    return entry, len(others) < len(before)


def remove(site, user, name):
    """Remove a user's bundle and its index entry; False if the user has no bundle of that name."""
    file = f"{USERS}/{user}/{check_name(name)}.evdb"
    files = store(site)
    entries = _listing(files, user)
    others = [e for e in entries if e.get("file") != file]
    found = files.remove(file) or len(others) < len(entries)
    if len(others) < len(entries):
        _write_index(files, user, others)
    return found


def clean(site, days=KEEP_DAYS, dry_run=False, log=print, now=None):
    """For cron, on a machine that mounts the site: remove the user bundles last published more than `days` days ago
    (and files that a publish left half-copied more than a day ago), then rewrite the index of each area that
    changed, so that it lists exactly the bundles present, with their expiry. Touches nothing outside
    <site>/data/u/. Returns the files removed (with `dry_run`: those that would be)."""
    now, removed = now or time.time(), []
    files = _Mounted(site)
    for area in sorted(glob.glob(os.path.join(site, USERS, "*", ""))):
        user = os.path.basename(os.path.dirname(area))
        old = [p for p in glob.glob(os.path.join(area, "*.tmp*")) if now - os.path.getmtime(p) > 86400]
        listed = {e.get("file"): e for e in _listing(files, user)}
        entries = {}
        for path in sorted(glob.glob(os.path.join(area, "*.evdb"))):
            file, modified = os.path.relpath(path, site), os.path.getmtime(path)
            if now - modified > days * 86400:
                old.append(path)
                continue
            title = listed[file]["title"].rsplit(" · ", 1)[0] if file in listed else os.path.basename(path)[:-5]
            try:
                entries[file] = _entry(path, file, title, modified, days)
            except (OSError, ValueError) as e:
                log(f"leaving {file}: not a readable bundle ({e})")
        for path in old:
            log(f"{'would remove' if dry_run else 'removing'} {os.path.relpath(path, site)}")
            if not dry_run:
                os.remove(path)
        removed += old
        if entries != listed and not dry_run:
            _write_index(files, user, list(entries.values()))
    return removed


if __name__ == "__main__":  # for the shell scripts in service/: eval "$(python3 -m evdtools.site)"
    print(f"EVD_SITE_DIR='{site_dir()}'\nEVD_SITE_URL='{site_url()}'\nEVD_SERVICE_DIR='{service_dir()}'")
