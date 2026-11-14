"""Command line: evd FILE.root, or evd {view,list,rm,convert,inspect,validate,sync,publish,simulate,clean} ...

`evd` is this module (python3 -m evdtools ...): installed as a script by pip, or the single file built by
tools/build_zipapp.py.
"""
import argparse
import os
import re
import shutil
import sys
import tempfile
import time

import numpy as np

from . import Problem, __version__
from .bundle import Bundle


def validate(path):
    """Structural checks of every event; returns a list of problems."""
    bundle, problems = Bundle(path), []
    rels = bundle.header["relations"]
    per_run = [t for t, m in bundle.header["tables"].items() if m.get("scope") == "run"]
    for entry in bundle.runs:
        for t, (n, cols) in bundle.run(entry["run"]).items():
            problems += [f"run {entry['run']}: {t}.{c} has {len(a)} rows, expected {n}" for c, a in cols.items() if len(a) != n]
    if per_run:
        missing = {e["run"] for e in bundle.events} - {r["run"] for r in bundle.runs}
        problems += [f"run {r}: no record of the per-run tables {', '.join(per_run)}" for r in sorted(missing)]
    for i in range(len(bundle)):
        ev = bundle.event(i)
        for t, (n, cols) in ev["tables"].items():
            problems += [f"event {i}: {t}.{c} has {len(a)} rows, expected {n}" for c, a in cols.items() if len(a) != n]
        for r, rel in ev["relations"].items():
            n_from = ev["tables"].get(rels[r]["from"], (0, {}))[0]
            n_to = ev["tables"].get(rels[r]["to"], (0, {}))[0]
            off, idx = rel["offsets"], rel["indices"]
            if len(off) != n_from + 1 or off[0] != 0 or off[-1] != len(idx) or np.any(np.diff(off.astype(np.int64)) < 0):
                problems.append(f"event {i}: relation {r} has bad offsets")
            if len(idx) and idx.max() >= n_to:
                problems.append(f"event {i}: relation {r} points past {rels[r]['to']} ({n_to} rows)")
            problems += [f"event {i}: relation {r} weight {w} has {len(a)} entries, expected {len(idx)}"
                         for w, a in rel["weights"].items() if len(a) != len(idx)]
    return problems


def _size(n):
    return f"{n / 1e6:.0f} MB" if n >= 1e6 else f"{n / 1e3:.0f} kB"


def _site_options(p):
    p.add_argument("--site", help="the site's directory (default: $EVD_SITE_DIR, else the CMS site)")
    p.add_argument("--url", help="the site's address (default: $EVD_SITE_URL, else the CMS site)")
    p.add_argument("--user", help="whose area on the site (default: $EVD_USER, else your login)")


def _number(least):
    """argparse type: a whole number, at least `least`."""
    def number(text):
        if not re.fullmatch(r"\d+", text) or int(text) < least:
            raise argparse.ArgumentTypeError(f"'{text}' is not a whole number of {least} or more")
        return int(text)
    return number


def _event_numbers(text):
    """argparse type: event numbers and ranges, kept as text for nano.parse_events."""
    if not re.fullmatch(r"\s*\d+(-\d+)?(\s*,\s*\d+(-\d+)?)*\s*", text):
        raise argparse.ArgumentTypeError(f"'{text}' is not a list of event numbers such as 416622,416630-416640")
    return text


def _convert_options(p, profile, max_events=None):
    p.add_argument("--profile", default=profile, help=f"profile name or JSON path (default: {profile})")
    p.add_argument("--max-events", type=_number(0), metavar="N",
                   help="convert at most N events" + (f" (default: {max_events})" if max_events else ""))
    p.add_argument("--events", type=_event_numbers,
                   help="only these event numbers, e.g. 416622,416630-416640 (the profile's selection still "
                        "applies; a reconstruction file is exported in full to find them)")
    p.add_argument("-j", "--threads", type=_number(1), help="threads to read and compress with (default: up to 4)")


def parser():
    """(the argument parser, the names of its commands)."""
    top = argparse.ArgumentParser(
        prog="evd", description="Turn CMS events into event-display bundles and publish them on the event-display "
        "site. `evd FILE.root` is `evd view FILE.root`: convert, publish to your area, print the link.")
    top.add_argument("--version", action="version", version=f"evd {__version__}")
    sub = top.add_subparsers(dest="command", required=True, metavar="command")

    p = sub.add_parser("view", help="convert NanoAOD (or CMSSW reconstruction) files, publish the bundle, print its link",
                       description="Convert event-display NanoAOD files (written with NANO:@EVD), or CMSSW "
                       "reconstruction files (step3: the NanoAOD is made first, which needs cmsenv), to one bundle, "
                       "publish it to your area of the event-display site and print the link to share.")
    p.add_argument("inputs", nargs="+", metavar="FILE.root")
    p.add_argument("-o", "--output", metavar="FILE.evdb", help="write the bundle to this file and do not publish it")
    p.add_argument("--no-publish", action="store_true", help="write <name>.evdb here and do not publish it")
    p.add_argument("--name", help="the bundle's name on the site (default: the first input's name)")
    p.add_argument("--title", help="its title in the viewer's list (default: its name)")
    _convert_options(p, "cms", "10, or all of those given with --events; 0: all")
    _site_options(p)
    edm = p.add_argument_group("for CMSSW reconstruction files (default: what the file records, and the release's "
                               "defaults for its geometry)")
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

    p = sub.add_parser("convert", aliases=["from-nano"], help="convert NanoAOD event-display tables to a bundle file")
    p.add_argument("inputs", nargs="+")
    p.add_argument("-o", "--output", required=True)
    _convert_options(p, "hgcal")
    p.add_argument("--sorted", action="store_true", help="list the events in (run, lumi, event) order, as a "
                   "multi-threaded export does not write them (index only, no extra reading)")
    p.add_argument("--run-tables", help="NanoAOD file with the per-run tables (Runs tree, e.g. the channel table) "
                   "of the same runs, for inputs made without them")
    p.add_argument("--run-info", help="information about the runs: a JSON file, or registry:<database>.<table> "
                   "(e.g. registry:RunRegistryP5.RunTable)")
    p = sub.add_parser("inspect", help="summarise a bundle")
    p.add_argument("bundle")
    p = sub.add_parser("validate", help="check the structure of every event of a bundle")
    p.add_argument("bundle")

    p = sub.add_parser("sync", help="site: convert new input files of the configured campaigns and update the index")
    p.add_argument("--config", required=True, help="JSON: campaigns (see evdtools/service.py)")
    p.add_argument("--max-files", type=int, help="convert at most this many files in this run")
    p.add_argument("--dry-run", action="store_true", help="only list what would be converted")
    p = sub.add_parser("publish", help="site: add a finished bundle to a campaign of the site's list")
    p.add_argument("bundle")
    p.add_argument("--site", help="the site's directory (default: $EVD_SITE_DIR, else the CMS site)")
    p.add_argument("--campaign", required=True, help="folder and group in the data set list, e.g. simulation")
    p.add_argument("--title", required=True, help="title of the group, e.g. 'Simulation'")
    p.add_argument("--name", help="file name on the site (default: the bundle's)")
    p.add_argument("--file-title", help="title of this bundle in the list (default: group title and file name)")
    p = sub.add_parser("simulate", help="site: publish the events of a bundle a few at a time, as if data were arriving")
    p.add_argument("source", help="bundle to take the events from")
    p.add_argument("--site", help="site directory (gets data/<campaign>/part_NNNN.evdb and index.json)")
    p.add_argument("--campaign", default="live_demo")
    p.add_argument("--title", default="Simulated live data")
    p.add_argument("--events", type=int, default=5, help="events per published file")
    p.add_argument("--interval", type=float, default=60, help="seconds between files")
    p.add_argument("--start", type=int, default=0, help="first event")
    p = sub.add_parser("clean", help="site: remove the users' bundles that have expired (for cron)")
    p.add_argument("--site", help="the site's directory (default: $EVD_SITE_DIR, else the CMS site)")
    p.add_argument("--days", type=_number(1), help="keep a bundle this many days after it was published (default: 30)")
    p.add_argument("--dry-run", action="store_true", help="only list what would be removed")
    return top, set(sub.choices)


def view(args):
    """Convert the inputs to one bundle and, unless told otherwise, publish it and print its link."""
    from . import export, site
    from .nano import convert, parse_events

    publish = not (args.output or args.no_publish)
    name = args.name or os.path.splitext(os.path.basename(args.inputs[0]))[0]
    if not args.output:  # the name is the file's on the site, or here
        site.check_name(name)
    kinds, entries, releases = zip(*map(export.describe, args.inputs))
    if len(set(kinds)) > 1:
        raise Problem("the inputs mix NanoAOD and CMSSW reconstruction files: give one kind at a time")
    if publish:  # before any work (an export takes minutes): the site must be there, and the user's area writable
        user, files = site.login(args.user), site.store(site.site_dir(args.site))
        files.check(f"{site.USERS}/{user}")
    unused = [f"--{o}" for o in ("geometry", "era", "conditions", "nano") if getattr(args, o)] if kinds[0] == "nano" else []
    if unused:
        print(f"evd: {', '.join(unused)} ignored: for CMSSW reconstruction files, and the input is NanoAOD", file=sys.stderr)
    # At most 10 events unless told otherwise; events asked for by number are all converted.
    limit = (None if args.events else 10) if args.max_events is None else args.max_events or None
    with tempfile.TemporaryDirectory(prefix="evd-") as work:
        inputs = args.inputs
        made = f" from {' and '.join(dict.fromkeys(filter(None, releases)))}" if any(releases) else ""
        print(f"{', '.join(map(os.path.basename, inputs))}: "
              f"{'NanoAOD' if kinds[0] == 'nano' else 'CMSSW reconstruction'}{made}, {sum(entries)} events")
        if kinds[0] == "edm":
            print("making the event-display NanoAOD of "
                  f"{'all of them' if not limit or limit >= sum(entries) else f'the first {limit}'} with cmsRun")
            started = time.time()
            inputs = [export.export(inputs, work, limit, args.geometry, args.era, args.conditions,
                                    threads=args.threads or 4, log=_Indented(sys.stdout))]
            print(f"  NanoAOD made in {time.time() - started:.0f} s")
            if args.nano:
                shutil.copyfile(inputs[0], args.nano)
        target = args.output or (os.path.join(work, f"{name}.evdb") if publish else f"{name}.evdb")
        started = time.time()
        written = convert(inputs, target, args.profile, limit, log=_Indented(sys.stdout),
                          events=parse_events(args.events) if args.events else None, threads=args.threads)
        total = sum(entries)
        cut = f" of {total} (--max-events 0 for all)" if kinds[0] == "nano" and limit and written == limit < total else ""
        print(f"  {written} events{cut}, {_size(os.path.getsize(target))}, {time.time() - started:.0f} s")
        if not written:
            os.remove(target)
            raise Problem("no event was converted" + (": none of the events asked for is in the input" if args.events
                                                      else ", so there is no bundle"))
        if not publish:
            print(f"wrote {target}")
            return 0
        entry, replaced = site.publish(target, site.site_dir(args.site), user, name, args.title)
    print(f"{'replaced' if replaced else 'published'} {name}: kept until {entry['expires'][:10]} "
          f"(evd list, evd rm {name})\n")
    print(site.link(site.site_url(args.url), user, name))
    return 0


class _Indented:
    """A file for the converter's progress lines, each indented under the command's own line."""

    def __init__(self, out):
        self._out = out

    def write(self, text):
        self._out.write("".join(f"  {line}" for line in text.splitlines(True)) if text.strip() else text)

    def flush(self):
        self._out.flush()


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    top, commands = parser()
    if argv and argv[0] not in commands | {"-h", "--help", "--version"}:
        argv.insert(0, "view")  # evd FILE.root ..., evd -o out.evdb FILE.root
    args = top.parse_args(argv)
    try:
        return run(args)
    except (Problem, ValueError, OSError) as e:
        # Messages written to be read: a ValueError of the converter says what in the profile or the file is wrong,
        # an OSError which file could not be read or written. EVD_DEBUG=1 shows where it came from.
        if os.environ.get("EVD_DEBUG"):
            raise
        print(f"evd: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


def run(args):
    if args.command == "view":
        return view(args)
    if args.command == "list":
        from . import site
        user, url = site.login(args.user), site.site_url(args.url)
        entries = site.listing(site.site_dir(args.site), user)
        if not entries:
            print(f"{user} has no published bundle (evd FILE.root publishes one)")
            return 0
        rows = [(os.path.basename(e["file"])[:-5], str(e.get("events", "")), _size(e.get("size") or 0),
                 str(e.get("expires") or "")[:10], str(e.get("title") or "")) for e in entries]
        widths = [max(len(r[k]) for r in [("NAME", "EVENTS", "SIZE", "EXPIRES"), *rows]) for k in range(4)]
        for row in [("NAME", "EVENTS", "SIZE", "EXPIRES", "TITLE"), *rows]:
            print("  ".join([*(cell.ljust(w) for cell, w in zip(row, widths)), row[4]]).rstrip())
            if args.links and row[0] != "NAME":
                print(f"    {site.link(url, user, row[0])}")
    elif args.command == "rm":
        from . import site
        user, missing = site.login(args.user), []
        for name in (n[:-5] if n.endswith(".evdb") else n for n in args.names):
            if site.remove(site.site_dir(args.site), user, name):
                print(f"removed {name}")
            else:
                missing.append(name)
        if missing:
            raise Problem(f"{user} has no bundle named {', '.join(missing)} (evd list)")
    elif args.command in ("convert", "from-nano"):
        from .export import describe
        from .nano import convert, parse_events  # needs uproot; inspect/validate need only numpy
        for path in args.inputs:
            if describe(path)[0] != "nano":
                raise Problem(f"{path} is a CMSSW reconstruction file, not NanoAOD: `evd view` makes its NanoAOD first")
        n = convert(args.inputs, args.output, args.profile, args.max_events or None, run_info=args.run_info,
                    events=parse_events(args.events) if args.events else None, run_tables=args.run_tables,
                    sort=args.sorted, threads=args.threads)
        print(f"wrote {n} events to {args.output}")
    elif args.command == "inspect":
        b = Bundle(args.bundle)
        h = b.header
        source = h["source"]
        print(f"{args.bundle}: {len(b)} events, profile {h['profile']}, from {', '.join(source['files'])}"
              + (f" ({source['cmssw']})" if source.get("cmssw") else "") + f", by {source.get('converter', '?')}")
        print(f"  display: {', '.join(layer['label'] for layer in h['display'])}")
        relations = [f"{name} ({r['from']} -> {r['to']})" for name, r in h["relations"].items()]
        print(f"  relations: {', '.join(relations)}")
        sizes = [e["length"] for e in b.events]
        print(f"  record size: mean {np.mean(sizes) / 1024:.0f} KB, max {max(sizes) / 1024:.0f} KB (gzip)")
        for r in b.runs:
            if r.get("info"):
                print(f"  run {r['run']}: " + ", ".join(f"{k} {v}" for k, v in r["info"].items()))
        for e in b.events[:5]:
            top = sorted(e["counts"].items(), key=lambda kv: -kv[1])[:4]
            print(f"  run {e['run']} event {e['event']}: " + ", ".join(f"{t} {n}" for t, n in top))
    elif args.command == "validate":
        problems = validate(args.bundle)
        print("\n".join(problems) if problems else "ok")
        return 1 if problems else 0
    elif args.command == "sync":
        import json
        import signal

        from .service import sync
        # cron or a batch system stops jobs with SIGTERM: exit through the cleanup (partial bundle, lock)
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
        with open(args.config) as f:
            sync(json.load(f), args.max_files, args.dry_run)
    elif args.command == "publish":
        from .service import publish
        from .site import site_dir
        publish(args.bundle, site_dir(args.site), args.campaign, args.title, args.name, args.file_title)
    elif args.command == "simulate":
        from .service import simulate
        from .site import site_dir
        simulate(args.source, site_dir(args.site), args.campaign, args.title, args.events, args.interval, args.start)
    elif args.command == "clean":
        from .service import log
        from .site import KEEP_DAYS, clean, site_dir
        site = site_dir(args.site)
        if not os.path.isdir(site):
            raise Problem(f"the site directory {site} is not mounted here: clean runs where the site is a directory")
        removed = clean(site, args.days or KEEP_DAYS, args.dry_run, log)
        log(f"{len(removed)} file(s) {'would be ' if args.dry_run else ''}removed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
