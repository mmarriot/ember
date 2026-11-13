"""Where the event-display site is, and each user's area on it.

    <site>/data/u/<login>/<name>.evdb   a user's bundles, written by `evd view`
    <site>/data/u/<login>/index.json    that user's list, most recently published first:
                                        {"updated", "bundles": [{"file", "title", "events", "size", "created",
                                                                 "published", "expires"}]}

`file` is relative to the site, so a share link is <url>/#b=<file>. `created` is when the bundle was converted,
`published` when it was last put on the site. A bundle is kept KEEP_DAYS days after it was published (`evd clean`,
run from cron, removes older ones); publishing it again renews it.

The site is a directory. Where it is mounted (lxplus mounts /eos) files are copied into it; elsewhere an /eos path is
reached through XRootD with xrdcp and xrdfs, which every CMSSW environment has and which need a Kerberos ticket.

Nothing here checks who the caller is: that one user cannot write in another's area rests on the access rights of
the folders under data/u/ (see service/README.md). What is checked is that a login or a bundle name is a plain name,
so that no path built from them leaves the user's area.
"""
import contextlib
import datetime
import getpass
import json
import os
import re
import shutil
import stat
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
PARTIAL = re.compile(r"\.(evdb|json)\.tmp\d+$")  # a file being copied in (replacing() and _XRootD.put)


def site_dir(given=None):
    return given or os.environ.get("EVD_SITE_DIR") or DEFAULT_DIR


def site_url(given=None):
    return (given or os.environ.get("EVD_SITE_URL") or DEFAULT_URL).rstrip("/")


def service_dir(given=None):
    return given or os.environ.get("EVD_SERVICE_DIR") or DEFAULT_SERVICE


def check_login(user):
    """A login as the viewer knows it: lower case; a letter, then letters, digits, '-' and '_', 2 to 32 in all. It
    names a folder, so anything else (a path, a space) is refused."""
    user = user.lower()
    if not re.fullmatch(r"[a-z][a-z0-9_-]{1,31}", user):
        raise Problem(f"'{user}' cannot be a login: a letter, then letters, digits, '-' and '_', 2 to 32 characters "
                      "(give your CERN login with --user or EVD_USER)")
    return user


def login(given=None):
    """Whose area: the account name, which on lxplus is the CERN login the site knows the user by."""
    return check_login(given or os.environ.get("EVD_USER") or getpass.getuser())


def link(url, user, name):
    return f"{url}/#b={USERS}/{user}/{name}.evdb"


def check_name(name):
    """A bundle's name is part of its address: letters, digits, '.', '_' and '-' only."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise Problem(f"'{name}' cannot be a bundle name: use letters, digits, '.', '_' and '-' (see --name)")
    return name


def _iso(seconds):
    return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc).isoformat(timespec="seconds")


@contextlib.contextmanager
def replacing(path):
    """The name to write a new `path` under: renamed onto `path` when the block ends, removed if it fails, so that a
    reader finds the old file or the complete new one."""
    partial = f"{path}.tmp{os.getpid()}"
    try:
        yield partial
        os.replace(partial, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.remove(partial)
        raise


class _Mounted:
    """The site as a directory of this machine."""

    def __init__(self, root):
        self.root = root

    def check(self, area=None):
        """A Problem if the site is not there, or (with `area`) if files cannot be written in <site>/area."""
        if not os.path.isdir(self.root):
            raise Problem(f"the site directory {self.root} does not exist (set EVD_SITE_DIR or --site, or write the "
                          "bundle here with -o FILE)")
        folder = os.path.join(self.root, area or "")
        while not os.path.isdir(folder):  # it will be created: can it be, in the nearest folder that exists?
            folder = os.path.dirname(folder)
        if area and not os.access(folder, os.W_OK | os.X_OK):
            self._denied(folder, "Permission denied")

    def _denied(self, folder, why):
        raise Problem(f"cannot write to {folder}: {why}. The user areas of the site are writable by CMS members "
                      "only; -o FILE writes the bundle here instead")

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
            with replacing(target) as partial:
                shutil.copyfile(source, partial)
        except PermissionError as e:
            self._denied(os.path.dirname(target), e.strerror)

    def remove(self, path):
        """Remove <site>/path; False if there was no such file."""
        try:
            os.remove(os.path.join(self.root, path))
            return True
        except FileNotFoundError:
            return False


class _XRootD:
    """The site on an EOS instance this machine does not mount, through xrdcp and xrdfs."""
    MISSING = re.compile(rb"no such file|\[3011\]", re.I)
    REFUSED = re.compile(r"auth failed|unable to authenticate|no protocols left to try|permission denied|"
                         r"not authorized|\[3010\]", re.I)

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
        if self.REFUSED.search(error):
            raise Problem(f"cannot {what}: {self.host} refused ({error.splitlines()[-1]}). Get a Kerberos ticket "
                          "with `kinit <login>@CERN.CH`; the user areas of the site are writable by CMS members")
        raise Problem(f"cannot {what}: {error or 'xrootd error'}")

    def _url(self, path):
        return f"{self.host}{self.root}/{path}"  # root://host//eos/...

    def check(self, area=None):
        """A Problem if the site cannot be reached (no xrdfs, no ticket, no such directory). Whether `area` can be
        written is only known when writing: one round trip tells that the server, the ticket and the site are there."""
        result = self._run("xrdfs", self.host, "stat", self.root)
        if result.returncode and self.MISSING.search(result.stderr):
            raise Problem(f"the site directory {self.root} does not exist on {self.host} (set EVD_SITE_DIR or "
                          "--site, or write the bundle here with -o FILE)")
        if result.returncode:
            self._fail(f"reach {self.root}", result)

    def read(self, path):
        result = self._run("xrdcp", "-s", "-f", self._url(path), "-")
        if result.returncode == 0:
            return result.stdout
        if self.MISSING.search(result.stderr):
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
        if result.returncode and not self.MISSING.search(result.stderr):
            self._fail(f"remove {self.root}/{path}", result)
        return result.returncode == 0


def store(site):
    """The site at `site`: a directory here, or root://host/path, or an /eos path this machine does not mount."""
    url = re.fullmatch(r"(root://[^/]+)/+(.*?)/*", site)
    if url:
        return _XRootD(url.group(1) + "/", "/" + url.group(2))
    host = next((h for prefix, h in EOS.items() if site.startswith(prefix)), None)
    if host and not os.path.isdir(site):
        return _XRootD(host, site.rstrip("/"))
    return _Mounted(site)


def _listing(files, user):
    data = files.read(f"{USERS}/{check_login(user)}/index.json")
    try:
        entries = json.loads(data)["bundles"] if data else []
    except (ValueError, KeyError, TypeError):
        return []  # not an index: the next publish writes a new one
    return [e for e in entries if isinstance(e, dict) and isinstance(e.get("file"), str)] \
        if isinstance(entries, list) else []


def listing(site, user):
    """The index entries of a user's bundles, most recently published first; a Problem if the site is not there."""
    files = store(site)
    files.check()
    return _listing(files, user)


def _write_index(files, user, entries):
    entries = sorted(entries, key=lambda e: str(e.get("published") or e.get("created") or ""), reverse=True)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"updated": _iso(time.time()), "bundles": entries}, f, indent=1)
    try:
        files.put(f.name, f"{USERS}/{user}/index.json")
    finally:
        os.remove(f.name)


def _entry(bundle, file, title, published, days):
    """The index entry of the local bundle file `bundle`, listed as `file` and published at `published` (s);
    ValueError if it is not a complete bundle."""
    from .bundle import summary  # here, so that the site's location can be asked for (below) without numpy
    header, events = summary(bundle)
    return {"file": file, "title": f"{title} · {events} events", "events": events, "size": os.path.getsize(bundle),
            "created": (header.get("source") or {}).get("created"), "published": _iso(published),
            "expires": _iso(published + days * 86400)}


def publish(bundle, site, user, name, title=None, days=KEEP_DAYS):
    """Put the bundle file `bundle` in the user's area as `name` and list it; a bundle of that name is replaced.
    Returns (its index entry, whether it replaced one).

    The index is read, changed and written back with no lock (there is none that works both on a mounted directory
    and through XRootD): two publishes of one user at the same moment can leave one of the two bundles out of the
    list, until that name is published again or the next `evd clean`, which lists the files present. The bundle
    itself is there, and its link works."""
    file = f"{USERS}/{check_login(user)}/{check_name(name)}.evdb"
    entry = _entry(bundle, file, title or name, time.time(), days)
    files = store(site)
    before = _listing(files, user)
    others = [e for e in before if e["file"] != file]
    files.put(bundle, file)
    _write_index(files, user, [entry, *others])
    return entry, len(others) < len(before)


def remove(site, user, name):
    """Remove a user's bundle and its index entry; False if the user has no bundle of that name."""
    file = f"{USERS}/{check_login(user)}/{check_name(name)}.evdb"
    files = store(site)
    files.check()
    entries = _listing(files, user)
    others = [e for e in entries if e["file"] != file]
    found = files.remove(file) or len(others) < len(entries)
    if len(others) < len(entries):
        _write_index(files, user, others)
    return found


def _clean_area(site, area, user, days, dry_run, log, now, removed):
    """clean() for one user's folder; the files removed are added to `removed`."""
    files = _Mounted(site)
    try:
        listed = {e["file"]: e for e in _listing(files, user)}
    except OSError:  # e.g. a folder named index.json
        listed = {}
    old, entries = [], {}
    for item in sorted(os.scandir(area), key=lambda item: item.name):
        info = item.stat(follow_symlinks=False)
        if not stat.S_ISREG(info.st_mode):
            continue  # a link, a folder: not something a publish wrote
        if PARTIAL.search(item.name):
            if now - info.st_mtime > 86400:
                old.append(item.path)
        elif item.name.endswith(".evdb"):
            file = os.path.relpath(item.path, site)
            if now - info.st_mtime > days * 86400:
                old.append(item.path)
                continue
            title = str(listed.get(file, {}).get("title") or item.name[:-5]).rsplit(" · ", 1)[0]
            try:
                entries[file] = _entry(item.path, file, title, info.st_mtime, days)
            except (OSError, ValueError) as e:
                log(f"leaving {file}: not a complete bundle ({e})")
    for path in old:
        log(f"{'would remove' if dry_run else 'removing'} {os.path.relpath(path, site)}")
        if not dry_run:
            os.remove(path)
        removed.append(path)
    if entries != listed and not dry_run:
        _write_index(files, user, list(entries.values()))


def clean(site, days=KEEP_DAYS, dry_run=False, log=print, now=None):
    """For cron, on a machine that mounts the site: remove the user bundles published more than `days` days ago (and
    files that a publish left half-copied more than a day ago), then rewrite the index of each area that changed, so
    that it lists exactly the bundles present, with when they were published (their modification time) and when
    they expire. Returns the files removed (with `dry_run`: those that would be).

    It touches only plain files directly in the folders that are directly in <site>/data/u/: a folder there that is
    a link, or resolves to somewhere else, is left alone and said, as are links and folders inside an area. A
    problem in one area is said and the others are still cleaned."""
    if days < 1:
        raise ValueError(f"clean keeps bundles for at least 1 day, not {days}: it would remove every user's bundles")
    now, removed = now or time.time(), []
    users = os.path.realpath(os.path.join(site, USERS))
    for item in sorted(os.scandir(users), key=lambda item: item.name) if os.path.isdir(users) else []:
        if item.is_symlink() or os.path.dirname(os.path.realpath(item.path)) != users:
            log(f"leaving {os.path.join(USERS, item.name)}: a link, not a user's folder")
        elif item.is_dir():
            try:
                _clean_area(site, os.path.join(site, USERS, item.name), item.name, days, dry_run, log, now, removed)
            except Exception as e:  # one odd area must not keep the others from being cleaned
                log(f"leaving {os.path.join(USERS, item.name)}: {type(e).__name__}: {e}")
    return removed


if __name__ == "__main__":  # for the shell scripts in service/: eval "$(python3 -m evdtools.site)"
    print(f"export EVD_SITE_DIR='{site_dir()}'\nexport EVD_SITE_URL='{site_url()}'\nexport EVD_SERVICE_DIR='{service_dir()}'")
