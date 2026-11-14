"""The evd command: view (convert, publish, link), list, rm, clean, the older commands, and the single-file build."""

import json
import os
import subprocess
import sys
import time

import pytest
from nanoaod import write_nano

from evdtools import __version__, export
from evdtools.__main__ import main
from evdtools.bundle import Bundle

pytest.importorskip("awkward")  # writes the input files

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = {"name": "test", "display": [{"table": "Hit", "label": "Hits", "position": ["x", "x", "x"]}]}
EVENTS = [{"Hit": {"x": [1.0, 2.0]}} for _ in range(12)]


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """A NanoAOD file with 12 events, a profile that draws it, and an empty site that is the default one."""
    (tmp_path / "test.json").write_text(json.dumps(PROFILE))
    write_nano(str(tmp_path / "ttbar.root"), EVENTS)
    (tmp_path / "site").mkdir()
    monkeypatch.setenv("EVD_SITE_DIR", str(tmp_path / "site"))
    monkeypatch.setenv("EVD_SITE_URL", "https://evd.example")
    monkeypatch.setenv("EVD_USER", "alice")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_a_file_alone_is_converted_published_and_its_link_printed_last(setup, capsys):
    assert main(["ttbar.root", "--profile", "test.json"]) == 0
    out = capsys.readouterr().out
    assert out.splitlines()[-1] == "https://evd.example/#b=data/u/alice/ttbar.evdb" and out.splitlines()[-2] == ""
    assert "ttbar.root: NanoAOD, 12 events" in out and "10 events of 12 (--max-events 0 for all)" in out
    assert "published ttbar: kept until" in out
    published = setup / "site" / "data" / "u" / "alice" / "ttbar.evdb"
    assert (
        len(Bundle(str(published))) == 10
        and Bundle(str(published)).header["source"]["converter"] == f"evdtools {__version__}"
    )
    [entry] = json.load(open(published.parent / "index.json"))["bundles"]
    assert entry["file"] == "data/u/alice/ttbar.evdb" and entry["title"] == "ttbar · 10 events"
    assert set(entry) == {"file", "title", "events", "size", "created", "published", "expires"}
    assert not list(setup.glob("*.evdb"))  # nothing left here


def test_view_takes_a_name_a_title_and_every_event(setup, capsys):
    assert (
        main(
            [
                "view",
                "ttbar.root",
                "--profile",
                "test.json",
                "--name",
                "run1",
                "--title",
                "My sample",
                "--max-events",
                "0",
            ]
        )
        == 0
    )
    out = capsys.readouterr().out
    assert "12 events, " in out and "of 12" not in out and "published run1" in out
    assert main(["ttbar.root", "--profile", "test.json", "--name", "run1", "--events", "0-10"]) == 0
    assert "replaced run1" in capsys.readouterr().out
    [entry] = json.load(open(setup / "site" / "data" / "u" / "alice" / "index.json"))["bundles"]
    assert entry["title"] == "run1 · 11 events"  # every event asked for by number, not the first 10


def test_output_or_no_publish_only_writes_the_bundle(setup, capsys):
    assert main(["ttbar.root", "--profile", "test.json", "-o", "out/mine.evdb"]) == 1  # no such directory
    assert main(["ttbar.root", "--profile", "test.json", "-o", "mine.evdb"]) == 0
    assert main(["ttbar.root", "--profile", "test.json", "--no-publish", "--name", "other"]) == 0
    assert len(Bundle("mine.evdb")) == 10 and len(Bundle("other.evdb")) == 10 and not os.listdir(setup / "site")
    assert capsys.readouterr().out.splitlines()[-1] == "wrote other.evdb"


def test_list_and_rm(setup, capsys):
    assert main(["list"]) == 0 and "no published bundle" in capsys.readouterr().out
    main(["ttbar.root", "--profile", "test.json", "--name", "a"])
    main(["ttbar.root", "--profile", "test.json", "--name", "bb", "--max-events", "2"])
    capsys.readouterr()
    assert main(["list", "-l"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].split() == ["NAME", "EVENTS", "SIZE", "EXPIRES", "TITLE"]
    assert [line.split()[:2] for line in lines[1::2]] == [["bb", "2"], ["a", "10"]]  # newest first
    assert lines[2].strip() == "https://evd.example/#b=data/u/alice/bb.evdb"
    assert main(["rm", "a", "nope"]) == 1
    captured = capsys.readouterr()
    assert "removed a" in captured.out and "no bundle named nope" in captured.err
    assert [e["file"] for e in json.load(open(setup / "site/data/u/alice/index.json"))["bundles"]] == [
        "data/u/alice/bb.evdb"
    ]


def test_inputs_that_cannot_be_shown_are_explained(setup, capsys):
    (setup / "physics.json").write_text(
        json.dumps({"name": "physics", "display": [{"table": "Jet", "label": "Jets", "position": ["x"] * 3}]})
    )
    assert main(["ttbar.root", "--profile", "physics.json"]) == 1
    assert "has none of the tables that the profile physics draws (it has: Hit)" in capsys.readouterr().err
    assert main(["missing.root"]) == 1 and "no such file" in capsys.readouterr().err
    assert main(["ttbar.root", "--profile", "nope"]) == 1 and "built-in profiles (calo, cms" in capsys.readouterr().err
    assert main(["ttbar.root", "--profile", "test.json", "--name", "a/b"]) == 1
    assert (
        main(["ttbar.root", "--profile", "test.json", "--events", "99"]) == 1
        and "no event was converted" in capsys.readouterr().err
    )
    assert main(["ttbar.root", "--profile", "test.json", "--site", str(setup / "nowhere")]) == 1
    assert "does not exist" in capsys.readouterr().err and not os.listdir(setup / "site")


def test_a_reconstruction_file_is_exported_first(setup, capsys, monkeypatch):
    calls = []

    def fake_export(inputs, work, events, geometry, era, conditions, threads, log, **more):
        calls.append((inputs, events, geometry, era, conditions, more))
        print("geometry ExtendedRun4D110 (from the file's geometry files)", file=log)
        return str(setup / "ttbar.root")

    monkeypatch.setattr(export, "export", fake_export)
    monkeypatch.setattr(
        export, "describe", lambda path: ("edm", 50, "CMSSW_20_1_0") if path == "step3.root" else ("nano", 12, None)
    )
    assert (
        main(["step3.root", "--profile", "test.json", "--max-events", "4", "--geometry", "D110", "--nano", "kept.root"])
        == 0
    )
    out = capsys.readouterr().out
    assert calls == [(["step3.root"], 4, "D110", None, None, {})]
    assert "step3.root: CMSSW reconstruction from CMSSW_20_1_0, 50 events" in out and "the first 4 with cmsRun" in out
    assert "  geometry ExtendedRun4D110" in out and out.splitlines()[-1].endswith("#b=data/u/alice/step3.evdb")
    assert os.path.exists("kept.root")
    assert main(["step3.root", "ttbar.root"]) == 1 and "mix" in capsys.readouterr().err
    assert main(["convert", "step3.root", "-o", "x.evdb"]) == 1 and "evd view" in capsys.readouterr().err


def test_the_older_commands_still_work(setup, capsys):
    for command in ("convert", "from-nano"):
        assert (
            main(
                [
                    command,
                    "ttbar.root",
                    "-o",
                    f"{command}.evdb",
                    "--profile",
                    "test.json",
                    "--max-events",
                    "3",
                    "-j",
                    "1",
                ]
            )
            == 0
        )
        assert len(Bundle(f"{command}.evdb")) == 3
    assert main(["validate", "convert.evdb"]) == 0 and main(["inspect", "convert.evdb"]) == 0
    out = capsys.readouterr().out
    assert "ok" in out and "3 events, profile test, from ttbar.root, by evdtools" in out
    assert main(["publish", "convert.evdb", "--campaign", "simulation", "--title", "Simulation"]) == 0
    assert json.load(open(setup / "site" / "index.json"))["bundles"][0]["file"] == "data/simulation/convert.evdb"


def test_clean_removes_what_expired(setup, capsys):
    main(["ttbar.root", "--profile", "test.json"])
    published = setup / "site" / "data" / "u" / "alice" / "ttbar.evdb"
    old = time.time() - 40 * 86400
    os.utime(published, (old, old))
    assert main(["clean", "--dry-run"]) == 0 and published.exists()
    assert main(["clean", "--days", "60"]) == 0 and published.exists()
    assert main(["clean"]) == 0 and not published.exists()
    assert "1 file(s) removed" in capsys.readouterr().out
    assert main(["clean", "--site", str(setup / "nowhere")]) == 1


def test_evd_runs_as_one_file_with_its_profiles_inside(setup):
    sys.path.insert(0, os.path.join(REPO, "tools"))
    try:
        from build_zipapp import build
    finally:
        sys.path.pop(0)
    evd = build(str(setup / "bin" / "evd"))
    assert os.access(evd, os.X_OK)
    run = lambda *args: subprocess.run([sys.executable, evd, *args], capture_output=True, text=True, cwd=setup)
    assert run("--version").stdout.strip() == f"evd {__version__}"
    done = run("ttbar.root", "--profile", "test.json")
    assert done.returncode == 0 and done.stdout.splitlines()[-1] == "https://evd.example/#b=data/u/alice/ttbar.evdb"
    failed = run("ttbar.root")  # the built-in cms profile is found in the file, and draws nothing of this input
    assert failed.returncode == 1 and "none of the tables that the profile cms draws" in failed.stderr


# Review findings: each of these failed before its fix.
def test_options_may_come_before_the_file(setup, capsys):
    assert main(["-o", "out.evdb", "--profile", "test.json", "ttbar.root"]) == 0 and len(Bundle("out.evdb")) == 10
    assert main(["--max-events", "3", "--profile", "test.json", "--no-publish", "ttbar.root"]) == 0
    assert len(Bundle("ttbar.evdb")) == 3
    for flag in ("-h", "--help", "--version"):
        with pytest.raises(SystemExit) as e:
            main([flag])
        assert e.value.code == 0
    assert "evd view" not in capsys.readouterr().out.split("usage:")[1].splitlines()[0]  # the top-level help


def test_a_hostile_user_option_is_refused_before_anything_is_written(setup, capsys):
    (setup / "site" / "data" / "simulation").mkdir(parents=True)
    main(["convert", "ttbar.root", "-o", str(setup / "site/data/simulation/ttbar.evdb"), "--profile", "test.json"])
    for user in ("../..", "../simulation", "a/b", "x y"):
        assert main(["ttbar.root", "--profile", "test.json", "--user", user]) == 1
        assert main(["rm", "--user", user, "ttbar"]) == 1
        assert main(["list", "--user", user]) == 1
    assert "login" in capsys.readouterr().err
    assert (setup / "site/data/simulation/ttbar.evdb").exists() and os.listdir(setup / "site") == ["data"]
    assert os.listdir(setup / "site" / "data") == ["simulation"]


def test_output_does_not_need_the_input_to_have_a_publishable_name(setup, capsys):
    os.rename("ttbar.root", "my file (v2).root")
    assert main(["my file (v2).root", "--profile", "test.json", "-o", "out.evdb"]) == 0
    assert main(["my file (v2).root", "--profile", "test.json"]) == 1 and "--name" in capsys.readouterr().err


def test_a_site_that_cannot_be_written_is_found_before_converting(setup, capsys, monkeypatch):
    if os.geteuid() == 0:
        pytest.skip("root may write anywhere")
    users = setup / "site" / "data" / "u"
    users.mkdir(parents=True)
    os.chmod(users, 0o555)
    from evdtools import nano

    monkeypatch.setattr(nano, "convert", lambda *a, **k: pytest.fail("converted before checking the site"))
    try:
        assert main(["ttbar.root", "--profile", "test.json"]) == 1
    finally:
        os.chmod(users, 0o755)
    assert "cannot write" in capsys.readouterr().err


def test_list_says_when_the_site_is_not_there(setup, capsys):
    assert main(["list", "--site", str(setup / "nowhere")]) == 1
    assert "does not exist" in capsys.readouterr().err


def test_numbers_are_checked_when_the_command_line_is_read(setup, capsys):
    for bad in (["--events", "abc"], ["--events", "3-"], ["--max-events", "-1"], ["--max-events", "x"], ["-j", "0"]):
        with pytest.raises(SystemExit) as e:
            main(["ttbar.root", "--profile", "test.json", *bad])
        assert e.value.code == 2
    err = capsys.readouterr().err
    assert "invalid literal" not in err and "islice" not in err and "416622,416630-416640" in err
    with pytest.raises(SystemExit):
        main(["clean", "--days", "0"])


def test_rm_takes_the_name_with_or_without_its_suffix(setup, capsys):
    main(["ttbar.root", "--profile", "test.json"])
    assert main(["rm", "ttbar.evdb"]) == 0 and "removed ttbar" in capsys.readouterr().out


def test_options_for_reconstruction_files_are_said_to_be_ignored_for_nanoaod(setup, capsys):
    assert (
        main(["ttbar.root", "--profile", "test.json", "--geometry", "D110", "--nano", "kept.root", "-o", "o.evdb"]) == 0
    )
    err = capsys.readouterr().err
    assert "--geometry" in err and "--nano" in err and "ignored" in err and not os.path.exists("kept.root")


def test_threads_give_the_same_records_as_one_thread(setup):
    from evdtools.nano import convert
    import gzip, io

    for threads in (1, 4):
        convert(["ttbar.root"], f"t{threads}.evdb", "test.json", log=io.StringIO(), threads=threads)
    one, four = Bundle("t1.evdb"), Bundle("t4.evdb")
    raw = lambda b, e: (b._file.seek(e["offset"]), gzip.decompress(b._file.read(e["length"])))[1]
    assert len(one) == len(four) == 12 and [e["event"] for e in one.events] == [e["event"] for e in four.events]
    assert all(raw(one, a) == raw(four, b) for a, b in zip(one.events, four.events))
