"""The users' areas of the site: publish, list, remove, expiry, and the same through XRootD commands."""

import datetime
import json
import os
import stat
import time
from pathlib import Path

import numpy as np
import pytest

from embertools import Problem, site
from embertools.bundle import BundleWriter
from embertools.service import build_index


def bundle(path, events=2, created="2026-11-09T00:00:00+00:00"):
    header = {
        "schema": "evd/1",
        "profile": "cms",
        "tables": {"Hit": {"doc": "", "columns": {"e": {"type": "f32", "doc": ""}}}},
        "relations": {},
        "display": [],
        "source": {"files": ["x.root"], "created": created},
    }
    with BundleWriter(str(path), header) as out:
        for i in range(events):
            out.add((1, 1, i), {"Hit": (1, {"e": np.ones(1, np.float32)})}, {})
    return str(path)


def index(root, user="alice"):
    return json.loads(Path(root, "data", "u", user, "index.json").read_text())


def seconds(iso):
    return datetime.datetime.fromisoformat(iso).timestamp()


def test_publish_lists_the_bundle_in_the_users_area_and_gives_its_link(tmp_path):
    root = str(tmp_path / "site")
    os.makedirs(root)
    entry, replaced = site.publish_to_user_area(bundle(tmp_path / "a.ember"), root, "alice", "ttbar", "ttbar PU200")
    assert not replaced and os.path.exists(os.path.join(root, "data/u/alice/ttbar.ember"))
    listed = index(root)
    assert listed["bundles"] == [entry] and listed["updated"]
    assert entry["file"] == "data/u/alice/ttbar.ember" and entry["title"] == "ttbar PU200 · 2 events"
    assert entry["events"] == 2 and entry["size"] == os.path.getsize(tmp_path / "a.ember")
    assert entry["created"] == "2026-11-09T00:00:00+00:00"  # when it was converted
    assert abs(seconds(entry["published"]) - time.time()) < 5  # when it was put here
    assert seconds(entry["expires"]) - seconds(entry["published"]) == site.KEEP_DAYS * 86400
    assert site.link("https://ember.example", entry["file"]) == "https://ember.example/#b=data/u/alice/ttbar.ember"
    assert build_index(root)["bundles"] == []  # the site's own list does not show the users' bundles


def test_publishing_a_name_again_replaces_it_and_the_list_is_by_time_of_publication(tmp_path, monkeypatch):
    root = str(tmp_path / "site")
    os.makedirs(root)
    clock = iter(range(1_800_000_000, 1_800_001_000, 10))
    monkeypatch.setattr(time, "time", lambda: next(clock))
    # converted in the other order than published: the list follows the publication
    site.publish_to_user_area(bundle(tmp_path / "a.ember", created="2026-11-05T00:00:00+00:00"), root, "alice", "old")
    site.publish_to_user_area(bundle(tmp_path / "b.ember", created="2026-11-02T00:00:00+00:00"), root, "alice", "ttbar")
    site.publish_to_user_area(bundle(tmp_path / "d.ember", created="2026-11-01T00:00:00+00:00"), root, "alice", "last")
    entry, replaced = site.publish_to_user_area(
        bundle(tmp_path / "c.ember", 5, "2026-11-03T00:00:00+00:00"), root, "alice", "ttbar"
    )
    assert replaced and [(e["file"], e["events"]) for e in site.listing(root, "alice")] == [
        ("data/u/alice/ttbar.ember", 5),
        ("data/u/alice/last.ember", 2),
        ("data/u/alice/old.ember", 2),
    ]
    assert entry["published"] > site.listing(root, "alice")[1]["published"]  # publishing again renews it
    assert site.listing(root, "bob") == []
    assert not [f for f in os.listdir(os.path.join(root, "data/u/alice")) if ".tmp" in f]


def test_remove_takes_the_bundle_and_its_entry_away(tmp_path):
    root = str(tmp_path / "site")
    os.makedirs(root)
    site.publish_to_user_area(bundle(tmp_path / "a.ember"), root, "alice", "a")
    site.publish_to_user_area(bundle(tmp_path / "a.ember"), root, "alice", "b")
    assert site.remove(root, "alice", "a") and not site.remove(root, "alice", "a")
    assert [e["file"] for e in site.listing(root, "alice")] == ["data/u/alice/b.ember"]
    assert os.listdir(os.path.join(root, "data/u/alice")).count("a.ember") == 0


@pytest.mark.parametrize("name", ["a/b", "../x", "", ".hidden", "a b"])
def test_a_name_that_is_not_a_plain_file_name_is_refused(tmp_path, name):
    with pytest.raises(Problem, match="bundle name"):
        site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(tmp_path), "alice", name)


def test_something_that_is_not_a_complete_bundle_is_not_published(tmp_path):
    (tmp_path / "half.ember").write_bytes(Path(bundle(tmp_path / "a.ember")).read_bytes()[:-20])
    with pytest.raises(ValueError):
        site.publish_to_user_area(str(tmp_path / "half.ember"), str(tmp_path), "alice", "half")
    assert not os.path.exists(tmp_path / "data")


def test_a_site_out_of_reach_or_not_writable_is_a_problem_with_a_way_out(tmp_path):
    for call in (
        lambda: site.store(str(tmp_path / "nowhere")).check(),
        lambda: site.listing(str(tmp_path / "nowhere"), "alice"),
        lambda: site.remove(str(tmp_path / "nowhere"), "alice", "a"),
    ):
        with pytest.raises(Problem, match="does not exist.*-o FILE"):
            call()
    if os.geteuid() == 0:
        pytest.skip("root may write anywhere")
    root = tmp_path / "site"
    (root / "data" / "u").mkdir(parents=True)
    os.chmod(root / "data" / "u", stat.S_IRUSR | stat.S_IXUSR)
    try:
        with pytest.raises(Problem, match="cannot write"):
            site.store(str(root)).check("data/u/alice")  # found before converting
        with pytest.raises(Problem, match="cannot write"):
            site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(root), "alice", "a")
    finally:
        os.chmod(root / "data" / "u", stat.S_IRWXU)
    site.store(str(root)).check("data/u/alice")


def test_where_the_site_is_comes_from_the_argument_then_the_environment_then_the_default(monkeypatch):
    for name in ("EMBER_SITE_DIR", "EMBER_SITE_URL", "EMBER_SERVICE_DIR", "EMBER_USER"):
        monkeypatch.delenv(name, raising=False)
    assert (site.site_dir(), site.site_url(), site.service_dir()) == (
        site.DEFAULT_DIR,
        site.DEFAULT_URL,
        site.DEFAULT_SERVICE,
    )
    monkeypatch.setenv("EMBER_SITE_DIR", "/env/site")
    monkeypatch.setenv("EMBER_SITE_URL", "https://env.example/")
    monkeypatch.setenv("EMBER_USER", "carol")
    assert (site.site_dir(), site.site_url(), site.login()) == ("/env/site", "https://env.example", "carol")
    assert (site.site_dir("/arg"), site.site_url("https://arg/"), site.login("dave")) == ("/arg", "https://arg", "dave")


def age(path, days):
    t = time.time() - days * 86400
    os.utime(path, (t, t))


def test_clean_removes_expired_bundles_and_brings_the_lists_up_to_date(tmp_path):
    root = str(tmp_path / "site")
    os.makedirs(os.path.join(root, "data", "campaign"))
    kept_outside = bundle(os.path.join(root, "data", "campaign", "old.ember"))
    age(kept_outside, 400)
    for user, name in (("alice", "fresh"), ("alice", "expired"), ("bob", "expired")):
        site.publish_to_user_area(bundle(tmp_path / "a.ember"), root, user, name, f"{name} title")
    area = lambda user, f: os.path.join(root, "data", "u", user, f)
    age(area("alice", "expired.ember"), 31)
    age(area("bob", "expired.ember"), 45)
    age(area("alice", "fresh.ember"), 10)
    orphan = bundle(area("alice", "orphan.ember"), 3)  # copied but never listed (a publish that died in between)
    open(area("alice", "big.ember.tmp123"), "w").close()
    age(area("alice", "big.ember.tmp123"), 2)
    open(area("bob", "now.ember.tmp7"), "w").close()  # a publish in progress

    said = []
    would = site.clean(root, dry_run=True, log=said.append)
    assert sorted(map(os.path.basename, would)) == ["big.ember.tmp123", "expired.ember", "expired.ember"]
    assert all(os.path.exists(p) for p in would) and len(index(root)["bundles"]) == 2 and "would remove" in said[0]

    removed = site.clean(root, log=said.append)
    assert sorted(removed) == sorted(would) and not any(os.path.exists(p) for p in removed)
    assert os.path.exists(kept_outside) and os.path.exists(area("bob", "now.ember.tmp7")) and os.path.exists(orphan)
    alice = {os.path.basename(e["file"]): e for e in index(root)["bundles"]}
    assert set(alice) == {"fresh.ember", "orphan.ember"} and index(root, "bob")["bundles"] == []
    assert (
        alice["fresh.ember"]["title"] == "fresh title · 2 events"
        and alice["orphan.ember"]["title"] == "orphan · 3 events"
    )
    # published: the file's modification time, 10 days ago; it expires 30 days after that
    assert abs(seconds(alice["fresh.ember"]["published"]) - (time.time() - 10 * 86400)) < 5
    assert abs(seconds(alice["fresh.ember"]["expires"]) - (time.time() + 20 * 86400)) < 5
    assert [os.path.basename(e["file"]) for e in index(root)["bundles"]] == [
        "orphan.ember",
        "fresh.ember",
    ]  # newest first
    assert site.clean(root, log=said.append) == []
    assert site.clean(root, days=5, log=said.append) == [area("alice", "fresh.ember")]


# The same through XRootD: xrdcp and xrdfs replaced by scripts that act on local paths.
XRDCP = """#!/bin/bash
# xrdcp -s -f SRC DST
src=${3#root://fake/}; dst=${4#root://fake/}
[ -n "$FAKE_XROOTD_DENIED" ] && { echo "[FATAL] Auth failed: No protocols left to try" >&2; exit 52; }
[ -n "$FAKE_XROOTD_FULL" ] && [ "$dst" != "-" ] && { echo "[ERROR] Server responded with an error: [3009] Unable to write $dst; disk quota exceeded" >&2; exit 54; }
if [ ! -e "$src" ]; then echo "[ERROR] Server responded with an error: [3011] Unable to open file $src; No such file or directory" >&2; exit 54; fi
if [ "$dst" = "-" ]; then cat "$src"; else cp "$src" "$dst"; fi
"""
XRDFS = """#!/bin/bash
# xrdfs HOST mkdir -p DIR | mv A B | rm PATH | stat PATH
[ -n "$FAKE_XROOTD_DENIED" ] && { echo "[FATAL] Auth failed: No protocols left to try" >&2; exit 52; }
case "$2" in
  mkdir) mkdir -p "$4";;
  mv) mv "$3" "$4" 2>/dev/null || { echo "[ERROR] Server responded with an error: [3005] Unable to rename $3; file exists" >&2; exit 54; };;
  stat) [ -e "$3" ] || { echo "[ERROR] Server responded with an error: [3011] Unable to stat $3; No such file or directory" >&2; exit 54; };;
  rm) if [ -e "$3" ]; then rm "$3"; else echo "[ERROR] Server responded with an error: [3011] Unable to remove: No such file or directory" >&2; exit 54; fi;;
esac
"""


@pytest.fixture
def xrootd(tmp_path, monkeypatch):
    tools = tmp_path / "bin"
    tools.mkdir()
    for name, script in (("xrdcp", XRDCP), ("xrdfs", XRDFS)):
        (tools / name).write_text(script)
        os.chmod(tools / name, 0o755)
    monkeypatch.setenv("PATH", f"{tools}{os.pathsep}{os.environ['PATH']}")
    return f"root://fake/{tmp_path}/site", str(tmp_path / "site")


def test_a_site_reached_through_xrootd_is_published_to_listed_and_removed_from(tmp_path, xrootd):
    url, root = xrootd
    with pytest.raises(Problem, match="does not exist on root://fake/"):
        site.listing(url, "alice")
    os.makedirs(root)
    site.store(url).check("data/u/alice")
    assert site.listing(url, "alice") == []  # no index yet
    site.publish_to_user_area(bundle(tmp_path / "a.ember"), url, "alice", "a")
    entry, replaced = site.publish_to_user_area(bundle(tmp_path / "b.ember", 4), url, "alice", "a")
    assert replaced and site.listing(url, "alice") == [entry] == index(root)["bundles"] and entry["events"] == 4
    assert sorted(os.listdir(os.path.join(root, "data/u/alice"))) == ["a.ember", "index.json"]  # nothing half-copied
    assert site.remove(url, "alice", "a") and not site.remove(url, "alice", "a") and site.listing(url, "alice") == []


def test_an_eos_path_that_is_not_mounted_goes_through_xrootd(monkeypatch):
    monkeypatch.setattr(os.path, "isdir", lambda path: False)
    files = site.store("/eos/project/c/cms-ember/www")
    assert (files.host, files.root) == ("root://eosproject.cern.ch/", "/eos/project/c/cms-ember/www")
    assert files._url("data/u/a/x.ember") == "root://eosproject.cern.ch//eos/project/c/cms-ember/www/data/u/a/x.ember"
    files = site.store("root://eosuser.cern.ch//eos/user/a/alice/site/")
    assert (files.host, files.root) == ("root://eosuser.cern.ch/", "/eos/user/a/alice/site")


def test_no_kerberos_ticket_is_said_in_words(tmp_path, xrootd, monkeypatch):
    monkeypatch.setenv("FAKE_XROOTD_DENIED", "1")
    with pytest.raises(Problem, match="kinit"):
        site.publish_to_user_area(bundle(tmp_path / "a.ember"), xrootd[0], "alice", "a")


# Review findings: each of these failed before its fix.
@pytest.mark.parametrize("user", ["../..", "../simulation", "a/b", "x y", "", ".", "a", "1abc", "x" * 33, "ok;rm"])
def test_a_login_that_is_not_a_plain_account_name_is_refused_everywhere(tmp_path, user):
    root = tmp_path / "site"
    (root / "data" / "simulation").mkdir(parents=True)
    kept = bundle(root / "data" / "simulation" / "ttbar.ember")
    (root / "index.json").write_text('{"bundles": []}')
    calls = [
        lambda: site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(root), user, "x"),
        lambda: site.remove(str(root), user, "ttbar"),
        lambda: site.listing(str(root), user),
    ]
    for call in calls + ([lambda: site.login(user)] if user else []):  # (no login given: the account's)
        with pytest.raises(Problem, match="login"):
            call()
    assert os.path.exists(kept) and (root / "index.json").read_text() == '{"bundles": []}'
    assert sorted(os.listdir(root)) == ["data", "index.json"] and os.listdir(root / "data") == ["simulation"]


def test_a_login_is_lower_cased_as_the_viewer_does(monkeypatch):
    monkeypatch.setenv("EMBER_USER", "Alice_B-2")
    assert site.login() == "alice_b-2" and site.login("BOB") == "bob"


def test_clean_does_not_follow_a_symlinked_area_or_touch_what_is_not_a_plain_file(tmp_path):
    root = tmp_path / "site"
    campaign = root / "data" / "simulation"
    campaign.mkdir(parents=True)
    victims = [bundle(campaign / "ttbar.ember"), str(campaign / "x.ember.tmp1")]
    open(victims[1], "w").close()
    for v in victims:
        age(v, 40)
    site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(root), "alice", "mine")
    os.symlink("../simulation", root / "data" / "u" / "mallory")  # an area that is a link
    os.symlink(victims[0], root / "data" / "u" / "alice" / "link.ember")  # a link in an area
    os.symlink("/nonexistent", root / "data" / "u" / "alice" / "dangling.ember")
    (root / "data" / "u" / "alice" / "d.ember").mkdir()  # directories with file names
    (root / "data" / "u" / "alice" / "x.ember.tmp7").mkdir()
    said = []
    assert site.clean(str(root), log=said.append) == []
    assert all(os.path.exists(v) for v in victims) and not os.path.exists(campaign / "index.json")
    assert [e["file"] for e in index(str(root))["bundles"]] == ["data/u/alice/mine.ember"]
    assert any("mallory" in line for line in said)


def test_clean_never_writes_through_a_link_planted_in_an_area(tmp_path):
    """A user cannot make the service account write elsewhere: neither a link at the index's place nor links at the
    names the index used to be written under are written through; the link itself is replaced."""
    root = tmp_path / "site"
    root.mkdir()
    site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(root), "bob", "his")
    site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(root), "mallory", "hers")
    victim = root / "data" / "u" / "bob" / "index.json"
    before = victim.read_bytes()
    area = root / "data" / "u" / "mallory"
    (area / "index.json").unlink()
    os.symlink(victim, area / "index.json")  # her index is bob's
    for pid in range(os.getpid() - 2, os.getpid() + 3):  # and the old temporary names
        os.symlink(victim, area / f"index.json.tmp{pid}")
    site.clean(str(root), log=lambda line: None)
    assert victim.read_bytes() == before
    assert not (area / "index.json").is_symlink() and [e["file"] for e in index(str(root), "mallory")["bundles"]] == [
        "data/u/mallory/hers.ember"
    ]


def test_clean_keeps_a_bundle_published_anew_while_it_ran(tmp_path, monkeypatch):
    """clean reads the folder, then removes what was expired then: a bundle published again in between stays."""
    root = tmp_path / "site"
    root.mkdir()
    for name in ("a_old", "b_new"):  # read in this order
        site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(root), "alice", name)
    old = root / "data" / "u" / "alice" / "a_old.ember"
    age(old, 40)
    entry = site._entry

    def republish_meanwhile(path, *args):  # called for b_new.ember, after a_old.ember was found expired
        os.utime(old)
        return entry(path, *args)

    monkeypatch.setattr(site, "_entry", republish_meanwhile)
    assert site.clean(str(root), log=lambda line: None) == [] and old.exists()
    assert sorted(e["file"] for e in index(str(root))["bundles"]) == [
        "data/u/alice/a_old.ember",
        "data/u/alice/b_new.ember",
    ]


def test_an_area_swapped_for_a_link_while_clean_runs_does_not_redirect_it(tmp_path, monkeypatch):
    """Mallory's folder is read, then she puts a link to a campaign folder in its place: the campaign's old bundle stays
    and no index is written there."""
    root = tmp_path / "site"
    campaign = root / "data" / "simulation"
    campaign.mkdir(parents=True)
    victim = bundle(campaign / "zz_old.ember")
    age(victim, 40)
    for name in ("a_new", "zz_old"):
        site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(root), "mallory", name)
    area = root / "data" / "u" / "mallory"
    age(area / "zz_old.ember", 40)
    entry = site._entry

    def swap(path, *args):  # called for a_new.ember, once the folder is read
        if area.is_dir() and not area.is_symlink():
            area.rename(root / "data" / "u" / "hidden")
            os.symlink("../simulation", area)
        return entry(path, *args)

    monkeypatch.setattr(site, "_entry", swap)
    site.clean(str(root), log=lambda line: None)
    assert os.path.exists(victim) and not (campaign / "index.json").exists()
    hidden = root / "data" / "u" / "hidden"
    assert not (hidden / "zz_old.ember").exists()  # her own expired bundle is removed
    # her index is rewritten in her real folder; what the swap made unreadable is left out of it (her loss only)
    assert all(
        e["file"].startswith("data/u/mallory/") for e in json.loads((hidden / "index.json").read_text())["bundles"]
    )


def test_files_written_to_the_site_are_readable_by_the_web_server(tmp_path):
    root = tmp_path / "site"
    root.mkdir()
    site.publish_to_user_area(bundle(tmp_path / "a.ember"), str(root), "alice", "a")
    for f in ("a.ember", "index.json"):
        assert stat.S_IMODE(os.stat(root / "data" / "u" / "alice" / f).st_mode) & 0o044 == 0o044


def test_clean_only_removes_the_temporary_files_a_publish_leaves(tmp_path):
    root = str(tmp_path / "site")
    os.makedirs(root)
    for name in ("step3.tmpfix", "a.tmp1"):
        site.publish_to_user_area(bundle(tmp_path / "a.ember"), root, "alice", name)
    area = os.path.join(root, "data", "u", "alice")
    left = [os.path.join(area, n) for n in ("big.ember.tmp123", "index.json.tmp77")]
    for path in left + [os.path.join(area, n) for n in ("step3.tmpfix.ember", "a.tmp1.ember")]:
        open(path, "a").close()
        age(path, 2)
    assert sorted(site.clean(root, log=lambda _: None)) == sorted(left)
    assert sorted(os.listdir(area)) == ["a.tmp1.ember", "index.json", "step3.tmpfix.ember"]


def test_an_odd_file_in_one_area_does_not_stop_clean_or_list(tmp_path):
    root = str(tmp_path / "site")
    os.makedirs(root)
    for user in ("alice", "bob", "carol", "zed"):
        site.publish_to_user_area(bundle(tmp_path / "a.ember"), root, user, "old")
        age(os.path.join(root, "data", "u", user, "old.ember"), 40)
    area = lambda user, f: os.path.join(root, "data", "u", user, f)
    open(area("alice", "empty.ember"), "w").close()
    Path(area("alice", "short.ember")).write_bytes(b"EVDB\x01")
    header = {"schema": "evd/1", "profile": "cms", "tables": {}, "relations": {}, "display": []}  # no "source"
    with BundleWriter(area("alice", "nosource.ember"), header) as out:
        out.add((1, 1, 1), {}, {})
    Path(area("bob", "index.json")).write_text('{"bundles": ["x", {"file": 3}, {"file": "data/u/bob/old.ember"}]}')
    os.remove(area("carol", "index.json"))
    os.mkdir(area("carol", "index.json"))
    said = []
    removed = site.clean(root, log=said.append)
    assert sorted(os.path.relpath(p, root) for p in removed) == [
        f"data/u/{u}/old.ember" for u in ("alice", "bob", "carol", "zed")
    ]
    assert [e["file"] for e in index(root)["bundles"]] == ["data/u/alice/nosource.ember"]  # the one complete bundle
    assert index(root, "bob")["bundles"] == [] and index(root, "zed")["bundles"] == []
    Path(area("bob", "index.json")).write_text(
        '{"bundles": ["x", {"file": 3}, {"title": "t"}, {"file": "data/u/bob/b.ember"}]}'
    )
    assert site.listing(root, "bob") == [{"file": "data/u/bob/b.ember"}]


@pytest.mark.parametrize("days", [0, -1])
def test_clean_refuses_to_keep_bundles_for_less_than_a_day(tmp_path, days):
    root = str(tmp_path / "site")
    os.makedirs(root)
    site.publish_to_user_area(bundle(tmp_path / "a.ember"), root, "alice", "mine")
    with pytest.raises(ValueError, match="at least 1"):
        site.clean(root, days=days, log=lambda _: None)
    assert os.path.exists(os.path.join(root, "data", "u", "alice", "mine.ember"))


def test_a_root_url_with_one_slash_is_understood():
    files = site.store("root://eosuser.cern.ch/eos/user/a/alice/site")
    assert (files.host, files.root) == ("root://eosuser.cern.ch/", "/eos/user/a/alice/site")


def test_only_a_refusal_is_reported_as_a_missing_ticket(tmp_path, xrootd, monkeypatch):
    """A path with "auth" in it is not an authentication failure."""
    monkeypatch.setenv("FAKE_XROOTD_FULL", "1")
    with pytest.raises(Problem) as e:
        site.publish_to_user_area(bundle(tmp_path / "a.ember"), f"root://fake/{tmp_path}/author_site", "authier", "x")
    assert "quota exceeded" in str(e.value) and "kinit" not in str(e.value)


def test_bundles_named_evdb_from_before_the_rename_are_still_bundles(tmp_path):
    """Bundles published before the project was called Ember end in .evdb: they are listed, expire, can be removed,
    and a publish of the same name replaces them."""
    root = str(tmp_path / "site")
    area = os.path.join(root, "data", "u", "alice")
    os.makedirs(area)
    for name in ("kept", "expired", "removed", "replaced"):
        bundle(os.path.join(area, f"{name}.evdb"))
    age(os.path.join(area, "expired.evdb"), 31)
    open(os.path.join(area, "half.evdb.tmp1"), "w").close()
    age(os.path.join(area, "half.evdb.tmp1"), 2)

    removed = site.clean(root, log=lambda _: None)
    assert sorted(map(os.path.basename, removed)) == ["expired.evdb", "half.evdb.tmp1"]
    assert sorted((e["file"], e["title"]) for e in site.listing(root, "alice")) == [
        (f"data/u/alice/{name}.evdb", f"{name} · 2 events") for name in ("kept", "removed", "replaced")
    ]

    assert site.remove(root, "alice", "removed") and not site.remove(root, "alice", "removed")
    entry, replaced = site.publish_to_user_area(bundle(tmp_path / "a.ember", 3), root, "alice", "replaced")
    assert replaced and entry["file"] == "data/u/alice/replaced.ember"
    assert sorted(os.listdir(area)) == ["index.json", "kept.evdb", "replaced.ember"]
    assert [e["file"] for e in site.listing(root, "alice")] == ["data/u/alice/replaced.ember", "data/u/alice/kept.evdb"]


def test_through_xrootd_a_bundle_named_evdb_is_replaced_and_removed_too(tmp_path, xrootd):
    url, root = xrootd
    area = os.path.join(root, "data", "u", "alice")
    os.makedirs(area)
    bundle(os.path.join(area, "a.evdb"))
    bundle(os.path.join(area, "b.evdb"))  # on the site but in no index: still removed by name
    entry, replaced = site.publish_to_user_area(bundle(tmp_path / "x.ember"), url, "alice", "a")
    assert replaced and sorted(os.listdir(area)) == ["a.ember", "b.evdb", "index.json"]
    assert site.remove(url, "alice", "b") and sorted(os.listdir(area)) == ["a.ember", "index.json"]
    assert site.listing(url, "alice") == [entry]
