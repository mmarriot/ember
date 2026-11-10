"""Command line: python3 -m evdtools {from-nano,inspect,validate,sync} ..."""
import argparse
import sys

import numpy as np

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


def main(argv=None):
    parser = argparse.ArgumentParser(prog="evdtools")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("from-nano", help="convert NanoAOD event-display tables to a bundle")
    p.add_argument("inputs", nargs="+")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--profile", default="hgcal", help="profile name or JSON path")
    p.add_argument("--max-events", type=int)
    p = sub.add_parser("inspect", help="summarise a bundle")
    p.add_argument("bundle")
    p = sub.add_parser("validate", help="check the structure of every event")
    p.add_argument("bundle")
    p = sub.add_parser("sync", help="convert new input files of the configured campaigns and update the site index")
    p.add_argument("--config", required=True, help="JSON: site, state, campaigns (see evdtools/service.py)")
    p.add_argument("--max-files", type=int, help="convert at most this many files in this run")
    p.add_argument("--dry-run", action="store_true", help="only list what would be converted")
    p = sub.add_parser("publish", help="add a finished bundle (e.g. a simulated sample) to a site and update its index")
    p.add_argument("bundle")
    p.add_argument("--site", required=True)
    p.add_argument("--campaign", required=True, help="folder and group in the data set list, e.g. simulation")
    p.add_argument("--title", required=True, help="title of the group, e.g. 'Simulation'")
    p.add_argument("--name", help="file name on the site (default: the bundle's)")
    p.add_argument("--file-title", help="title of this bundle in the list (default: group title and file name)")
    p = sub.add_parser("simulate", help="publish the events of a bundle a few at a time, as if new data were arriving")
    p.add_argument("source", help="bundle to take the events from")
    p.add_argument("--site", required=True, help="site directory (gets data/<campaign>/part_NNNN.evdb and index.json)")
    p.add_argument("--campaign", default="live_demo")
    p.add_argument("--title", default="Simulated live data")
    p.add_argument("--events", type=int, default=5, help="events per published file")
    p.add_argument("--interval", type=float, default=60, help="seconds between files")
    p.add_argument("--start", type=int, default=0, help="first event")
    args = parser.parse_args(argv)

    if args.command == "from-nano":
        from .nano import convert  # needs uproot; inspect/validate need only numpy
        n = convert(args.inputs, args.output, args.profile, args.max_events)
        print(f"wrote {n} events to {args.output}")
    elif args.command == "inspect":
        b = Bundle(args.bundle)
        h = b.header
        print(f"{args.bundle}: {len(b)} events, profile {h['profile']}, from {', '.join(h['source']['files'])}")
        print(f"  display: {', '.join(layer['label'] for layer in h['display'])}")
        relations = [f"{name} ({r['from']} -> {r['to']})" for name, r in h["relations"].items()]
        print(f"  relations: {', '.join(relations)}")
        sizes = [e["length"] for e in b.events]
        print(f"  record size: mean {np.mean(sizes) / 1024:.0f} KB, max {max(sizes) / 1024:.0f} KB (gzip)")
        for e in b.events[:5]:
            top = sorted(e["counts"].items(), key=lambda kv: -kv[1])[:4]
            print(f"  run {e['run']} event {e['event']}: " + ", ".join(f"{t} {n}" for t, n in top))
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
        publish(args.bundle, args.site, args.campaign, args.title, args.name, args.file_title)
    elif args.command == "simulate":
        from .service import simulate
        simulate(args.source, args.site, args.campaign, args.title, args.events, args.interval, args.start)
    elif args.command == "validate":
        problems = validate(args.bundle)
        print("\n".join(problems) if problems else "ok")
        return 1 if problems else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
