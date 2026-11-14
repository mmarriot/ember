"""The `ember` command: `ember FILE.root`, or `ember COMMAND ...` (`ember --help` lists the commands).

`ember` is this module (python3 -m embertools ...), installed as a script by pip or built into a single file by
tools/build_zipapp.py. Each command is a function below that takes the parsed arguments and returns the exit status.
The commands import what they need when they run: uproot, for example, is needed to convert but not to inspect a
bundle.
"""

import argparse
import os
import re
import shutil
import sys
import tempfile
import time

from . import Problem, __version__, site


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    top, commands = parser()
    if argv and argv[0] not in commands | {"-h", "--help", "--version"}:
        argv.insert(0, "view")  # ember FILE.root ..., ember -o out.ember FILE.root
    args = top.parse_args(argv)
    try:
        site.old_settings()
        return COMMANDS[args.command](args)
    except (Problem, ValueError, OSError) as e:
        # These messages are written to be read: a ValueError of the converter says what in the profile or the file
        # is wrong, an OSError which file could not be read or written. EMBER_DEBUG=1 shows where it came from.
        if os.environ.get("EMBER_DEBUG"):
            raise
        print(f"ember: {e}", file=sys.stderr)
        return 1
    except ModuleNotFoundError as e:
        # numpy and uproot are imported by the commands that need them: `ember list` and `ember rm` run without them.
        if os.environ.get("EMBER_DEBUG") or e.name not in ("numpy", "uproot", "scipy", "awkward"):
            raise
        print(f"ember: this command needs the Python package {e.name}: run cmsenv first", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


def parser():
    """(the argument parser, the names of its commands)."""
    top = argparse.ArgumentParser(
        prog="ember",
        description="Turn CMS events into event-display bundles and publish them on the event-display "
        "site. `ember FILE.root` is `ember view FILE.root`: convert, publish to your area, print the link.",
    )
    top.add_argument("--version", action="version", version=f"ember {__version__}")
    sub = top.add_subparsers(dest="command", required=True, metavar="command")

    # A user's own bundles on the site
    p = sub.add_parser(
        "view",
        help="convert NanoAOD (or CMSSW reconstruction) files, publish the bundle, print its link",
        description="Convert event-display NanoAOD files (written with NANO:@EVD), or CMSSW "
        "reconstruction files (step3: the NanoAOD is made first, which needs cmsenv), to one bundle, "
        "publish it to your area of the event-display site and print the link to share.",
    )
    p.add_argument("inputs", nargs="+", metavar="FILE.root")
    p.add_argument("-o", "--output", metavar="FILE.ember", help="write the bundle to this file and do not publish it")
    p.add_argument("--no-publish", action="store_true", help="write <name>.ember here and do not publish it")
    p.add_argument("--name", help="the bundle's name on the site (default: the first input's name)")
    p.add_argument("--title", help="its title in the viewer's list (default: its name)")
    _convert_options(p, "cms", "10, or all of those given with --events; 0: all", reconstruction=True)
    _site_options(p)
    edm = p.add_argument_group(
        "for CMSSW reconstruction files (default: what the file records, and the release's defaults for its geometry)"
    )
    edm.add_argument("--geometry", help="e.g. D110 or ExtendedRun4D110")
    edm.add_argument("--era", help="e.g. Phase2C17I13M9")
    edm.add_argument("--conditions", help="global tag, e.g. auto:phase2_realistic_T33")
    edm.add_argument("--nano", metavar="FILE.root", help="also keep the NanoAOD that was made, as this file")

    p = sub.add_parser("list", help="list your published bundles")
    p.add_argument("-l", "--links", action="store_true", help="print each bundle's link")
    _site_options(p)

    p = sub.add_parser("rm", help="remove one of your published bundles")
    p.add_argument("names", nargs="+", metavar="NAME")
    _site_options(p)

    # Bundle files
    p = sub.add_parser("convert", aliases=["from-nano"], help="convert NanoAOD event-display tables to a bundle file")
    p.add_argument("inputs", nargs="+")
    p.add_argument("-o", "--output", required=True)
    _convert_options(p, "hgcal")
    p.add_argument(
        "--sorted",
        action="store_true",
        help="list the events in (run, lumi, event) order, as a "
        "multi-threaded export does not write them (index only, no extra reading)",
    )
    p.add_argument(
        "--run-tables",
        help="NanoAOD file with the per-run tables (Runs tree, e.g. the channel table) "
        "of the same runs, for inputs made without them",
    )
    p.add_argument(
        "--run-info",
        help="information about the runs: a JSON file, or registry:<database>.<table> "
        "(e.g. registry:RunRegistryP5.RunTable)",
    )

    p = sub.add_parser("inspect", help="summarise a bundle")
    p.add_argument("bundle")

    p = sub.add_parser("validate", help="check the structure of every event of a bundle")
    p.add_argument("bundle")

    # Running the site (service/README.md)
    p = sub.add_parser("sync", help="site: convert new input files of the configured campaigns and update the index")
    p.add_argument("--config", required=True, help="JSON: campaigns (see embertools/service.py)")
    p.add_argument("--max-files", type=_number(1), help="convert at most this many files in this run")
    p.add_argument("--dry-run", action="store_true", help="only list what would be converted")

    p = sub.add_parser("publish", help="site: add a finished bundle to a campaign of the site's list")
    p.add_argument("bundle")
    _site_dir_option(p)
    p.add_argument("--campaign", required=True, help="folder and group in the data set list, e.g. simulation")
    p.add_argument("--title", required=True, help="title of the group, e.g. 'Simulation'")
    p.add_argument("--name", help="file name on the site (default: the bundle's)")
    p.add_argument("--file-title", help="title of this bundle in the list (default: group title and file name)")

    p = sub.add_parser(
        "simulate", help="site: publish the events of a bundle a few at a time, as if data were arriving"
    )
    p.add_argument("source", help="bundle to take the events from")
    p.add_argument("--site", help="site directory (gets data/<campaign>/part_NNNN.ember and index.json)")
    p.add_argument("--campaign", default="live_demo")
    p.add_argument("--title", default="Simulated live data")
    p.add_argument("--events", type=_number(1), default=5, help="events per published file")
    p.add_argument("--interval", type=float, default=60, help="seconds between files")
    p.add_argument("--start", type=_number(0), default=0, help="first event")

    p = sub.add_parser("clean", help="site: remove the users' bundles that have expired (for cron)")
    _site_dir_option(p)
    p.add_argument("--days", type=_number(1), help="keep a bundle this many days after it was published (default: 30)")
    p.add_argument("--dry-run", action="store_true", help="only list what would be removed")
    return top, set(sub.choices)


def _site_dir_option(p):
    p.add_argument("--site", help="the site's directory (default: $EMBER_SITE_DIR, else the CMS site)")


def _site_options(p):
    _site_dir_option(p)
    p.add_argument("--url", help="the site's address (default: $EMBER_SITE_URL, else the CMS site)")
    p.add_argument("--user", help="whose area on the site (default: $EMBER_USER, else your login)")


def _convert_options(p, profile, max_events=None, reconstruction=False):
    """The conversion options; `reconstruction`: the command also takes CMSSW reconstruction files."""
    p.add_argument("--profile", default=profile, help=f"profile name or JSON path (default: {profile})")
    p.add_argument(
        "--max-events",
        type=_number(0),
        metavar="N",
        help="convert at most N events" + (f" (default: {max_events})" if max_events else ""),
    )
    p.add_argument(
        "--events",
        type=_event_numbers,
        help="only these event numbers, e.g. 416622,416630-416640 (the profile's selection still applies"
        + ("; a reconstruction file is exported in full to find them)" if reconstruction else ")"),
    )
    threads = "threads to read and compress with (default: up to 4)"
    if reconstruction:
        threads += "; for a reconstruction file, also the threads of its cmsRun job (default: 4)"
    p.add_argument("-j", "--threads", type=_number(1), help=threads)


def _number(least):
    """An argparse type: a whole number, at least `least`."""

    def number(text):
        if not re.fullmatch(r"\d+", text) or int(text) < least:
            raise argparse.ArgumentTypeError(f"'{text}' is not a whole number of {least} or more")
        return int(text)

    return number


def _event_numbers(text):
    """An argparse type: event numbers and ranges, checked here and kept as text for nano.parse_events."""
    if not re.fullmatch(r"\s*\d+(-\d+)?(\s*,\s*\d+(-\d+)?)*\s*", text):
        raise argparse.ArgumentTypeError(f"'{text}' is not a list of event numbers such as 416622,416630-416640")
    return text


# A user's own bundles on the site


def _view(args):
    """Convert the inputs to one bundle and, unless told otherwise, publish it and print its link."""
    from . import export
    from .nano import convert, parse_events

    publish = not (args.output or args.no_publish)
    name = args.name or os.path.splitext(os.path.basename(args.inputs[0]))[0]
    if not args.output:  # the name is that of the file written, on the site or here
        site.check_name(name)
    kinds, entries, releases = zip(*map(export.describe, args.inputs))
    if len(set(kinds)) > 1:
        raise Problem("the inputs mix NanoAOD and CMSSW reconstruction files: give one kind at a time")
    kind, total = kinds[0], sum(entries)
    if publish:  # before any work (an export takes minutes): the site must be there, and the user's area writable
        user, files = site.login(args.user), site.store(site.site_dir(args.site))
        files.check(f"{site.USERS}/{user}")
    unused = [f"--{o}" for o in ("geometry", "era", "conditions", "nano") if getattr(args, o)] if kind == "nano" else []
    if unused:
        print(
            f"ember: {', '.join(unused)} ignored: for CMSSW reconstruction files, and the input is NanoAOD",
            file=sys.stderr,
        )

    # At most 10 events unless told otherwise; events asked for by number are all converted.
    limit = (None if args.events else 10) if args.max_events is None else args.max_events or None
    with tempfile.TemporaryDirectory(prefix="ember-") as work:
        made = f" from {' and '.join(dict.fromkeys(filter(None, releases)))}" if any(releases) else ""
        print(
            f"{', '.join(map(os.path.basename, args.inputs))}: "
            f"{'NanoAOD' if kind == 'nano' else 'CMSSW reconstruction'}{made}, {total} events"
        )
        inputs = args.inputs
        if kind == "edm":
            # Events asked for by number may be anywhere in the file: the NanoAOD is made of all of it.
            inputs = [_make_nanoaod(args, work, None if args.events else limit, total)]

        file = f"{name}{site.EXTENSION}"
        target = args.output or (os.path.join(work, file) if publish else file)
        started = time.time()
        written = convert(
            inputs,
            target,
            args.profile,
            limit,
            log=_Indented(sys.stdout),
            events=parse_events(args.events) if args.events else None,
            threads=args.threads,
        )
        cut = f" of {total} (--max-events 0 for all)" if kind == "nano" and limit and written == limit < total else ""
        print(f"  {written} events{cut}, {_size(os.path.getsize(target))}, {time.time() - started:.0f} s")
        if not written:
            os.remove(target)
            raise Problem(
                "no event was converted"
                + (": none of the events asked for is in the input" if args.events else ", so there is no bundle")
            )
        if not publish:
            print(f"wrote {target}")
            return 0
        entry, replaced = site.publish(target, site.site_dir(args.site), user, name, args.title)

    print(
        f"{'replaced' if replaced else 'published'} {name}: kept until {entry['expires'][:10]} "
        f"(ember list, ember rm {name})\n"
    )
    print(site.link(site.site_url(args.url), entry["file"]))
    return 0


def _make_nanoaod(args, work, limit, total):
    """Run the export of the reconstruction files `args.inputs` in the folder `work`; returns the NanoAOD file."""
    from . import export

    print(
        "making the event-display NanoAOD of "
        f"{'all of them' if not limit or limit >= total else f'the first {limit}'} with cmsRun"
    )
    started = time.time()
    nano = export.export(
        args.inputs,
        work,
        limit,
        args.geometry,
        args.era,
        args.conditions,
        threads=args.threads or 4,
        log=_Indented(sys.stdout),
    )
    print(f"  NanoAOD made in {time.time() - started:.0f} s")
    if args.nano:
        shutil.copyfile(nano, args.nano)
    return nano


def _list(args):
    """Print a table of the user's bundles, most recently published first."""
    user, url = site.login(args.user), site.site_url(args.url)
    entries = site.listing(site.site_dir(args.site), user)
    if not entries:
        print(f"{user} has no published bundle (ember FILE.root publishes one)")
        return 0
    rows = [
        (
            site.without_extension(os.path.basename(e["file"])),
            str(e.get("events", "")),
            _size(e.get("size") or 0),
            str(e.get("expires") or "")[:10],
            str(e.get("title") or ""),
        )
        for e in entries
    ]
    heading = ("NAME", "EVENTS", "SIZE", "EXPIRES", "TITLE")
    widths = [max(len(r[k]) for r in [heading, *rows]) for k in range(4)]  # the title, last, is not padded
    for row, entry in [(heading, None), *zip(rows, entries)]:
        print("  ".join([*(cell.ljust(w) for cell, w in zip(row, widths)), row[4]]).rstrip())
        if args.links and entry:
            print(f"    {site.link(url, entry['file'])}")
    return 0


def _rm(args):
    """Remove the named bundles of the user; a Problem naming those the user does not have."""
    user, missing = site.login(args.user), []
    for name in map(site.without_extension, args.names):
        if site.remove(site.site_dir(args.site), user, name):
            print(f"removed {name}")
        else:
            missing.append(name)
    if missing:
        raise Problem(f"{user} has no bundle named {', '.join(missing)} (ember list)")
    return 0


# Bundle files


def _convert(args):
    from .export import describe
    from .nano import convert, parse_events

    for path in args.inputs:
        if describe(path)[0] != "nano":
            raise Problem(f"{path} is a CMSSW reconstruction file, not NanoAOD: `ember view` makes its NanoAOD first")
    n = convert(
        args.inputs,
        args.output,
        args.profile,
        args.max_events or None,
        run_info=args.run_info,
        events=parse_events(args.events) if args.events else None,
        run_tables=args.run_tables,
        sort=args.sorted,
        threads=args.threads,
    )
    print(f"wrote {n} events to {args.output}")
    return 0


def _inspect(args):
    """Print what a bundle holds: its source, layers, relations, record sizes, runs and first events."""
    from .bundle import Bundle

    b = Bundle(args.bundle)
    h = b.header
    source = h["source"]
    print(
        f"{args.bundle}: {len(b)} events, profile {h['profile']}, from {', '.join(source['files'])}"
        + (f" ({source['cmssw']})" if source.get("cmssw") else "")
        + f", by {source.get('converter', '?')}"
    )
    print(f"  display: {', '.join(layer['label'] for layer in h['display'])}")
    relations = [f"{name} ({r['from']} -> {r['to']})" for name, r in h["relations"].items()]
    print(f"  relations: {', '.join(relations)}")
    sizes = [e["length"] for e in b.events]
    print(f"  record size: mean {sum(sizes) / len(sizes) / 1024:.0f} KB, max {max(sizes) / 1024:.0f} KB (gzip)")
    for r in b.runs:
        if r.get("info"):
            print(f"  run {r['run']}: " + ", ".join(f"{k} {v}" for k, v in r["info"].items()))
    for e in b.events[:5]:
        largest = sorted(e["counts"].items(), key=lambda kv: -kv[1])[:4]
        print(f"  run {e['run']} event {e['event']}: " + ", ".join(f"{t} {n}" for t, n in largest))
    return 0


def _validate(args):
    from .bundle import validate

    problems = validate(args.bundle)
    print("\n".join(problems) if problems else "ok")
    return 1 if problems else 0


# Running the site


def _sync(args):
    import json
    import signal

    from .service import sync

    # cron or a batch system stops jobs with SIGTERM: exit through the cleanup (partial bundle, lock)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    with open(args.config) as f:
        sync(json.load(f), args.max_files, args.dry_run)
    return 0


def _publish(args):
    from .service import publish

    publish(args.bundle, site.site_dir(args.site), args.campaign, args.title, args.name, args.file_title)
    return 0


def _simulate(args):
    from .service import simulate

    simulate(args.source, site.site_dir(args.site), args.campaign, args.title, args.events, args.interval, args.start)
    return 0


def _clean(args):
    from .service import log

    folder = site.site_dir(args.site)
    if not os.path.isdir(folder):
        raise Problem(f"the site directory {folder} is not mounted here: clean runs where the site is a directory")
    removed = site.clean(folder, args.days or site.KEEP_DAYS, args.dry_run, log)
    log(f"{len(removed)} file(s) {'would be ' if args.dry_run else ''}removed")
    return 0


COMMANDS = {
    "view": _view,
    "list": _list,
    "rm": _rm,
    "convert": _convert,
    "from-nano": _convert,
    "inspect": _inspect,
    "validate": _validate,
    "sync": _sync,
    "publish": _publish,
    "simulate": _simulate,
    "clean": _clean,
}


# Output


def _size(n):
    """A file size in words: kB below a megabyte, MB above."""
    return f"{n / 1e6:.0f} MB" if n >= 1e6 else f"{n / 1e3:.0f} kB"


class _Indented:
    """A file-like object for the converter's progress lines: each line is indented under the command's own."""

    def __init__(self, out):
        self._out = out

    def write(self, text):
        self._out.write("".join(f"  {line}" for line in text.splitlines(True)) if text.strip() else text)

    def flush(self):
        self._out.flush()


if __name__ == "__main__":
    sys.exit(main())
