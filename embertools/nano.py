"""NanoAOD -> .ember: read the event-display tables of NanoAOD files and write their events to a bundle.

convert() is the whole conversion. It loads the profile (profile.py), builds a Converter (converter.py) from the
tables the file describes, then reads the events chunk by chunk (or one by one), converts each and hands the records
to a BundleWriter (bundle.py).
"""

import contextlib
import itertools
import os
import re
import sys
from collections import defaultdict

import numpy as np
import uproot

from . import Problem
from .bundle import BundleWriter
from .converter import Converter
from .profile import load_profile


def convert(
    files,
    output,
    profile_name="hgcal",
    max_events=None,
    log=sys.stderr,
    data_time=None,
    run_info=None,
    events=None,
    run_tables=None,
    sort=False,
    threads=None,
):
    """Write the events of the NanoAOD `files` that pass the profile's selection to the bundle `output`; returns how
    many were written. Progress and what was found go to `log`.

    max_events  write at most this many events (None: all)
    data_time   when the input data was taken or produced (a datetime), recorded in the header
    run_info    where to find information about the runs (see runinfo.load)
    events      only these event numbers (a set)
    run_tables  a NanoAOD file whose Runs tree has the per-run tables (e.g. the channel table) of the same runs, for
                inputs made without them
    sort        list the events in (run, lumi, event) order (only the index is sorted)
    threads     threads that decompress the input and compress the records (default: threads_available())
    """
    profile = load_profile(profile_name)
    first = open_file(files[0])  # stays open to read its events
    try:
        with open_file(run_tables) if run_tables else contextlib.nullcontext(first) as r:
            conv = Converter(discover(first["Events"]), profile, discover(r["Runs"]) if "Runs" in r else None)
            runs = _run_tables(conv, r) if run_tables else None
        if run_tables:
            print(f"per-run tables of run(s) {sorted(runs)} from {os.path.basename(run_tables)}", file=log)
        print(
            f"{len(conv.written())} tables, {len(conv.relations)} relations, {len(conv.display)} display layers",
            file=log,
        )
        if not conv.display:  # e.g. a physics NanoAOD: nothing of it would be drawn
            has = ", ".join(sorted(conv.tables)[:12]) + (", ..." if len(conv.tables) > 12 else "")
            raise Problem(
                f"{files[0]} has none of the tables that the profile {profile.get('name', profile_name)} "
                f"draws (it has: {has or 'no table'}). Event-display NanoAOD is written by CMSSW with "
                "NANO:@EVD; another kind of file needs its own --profile"
            )

        header = conv.header(files, profile.get("name", profile_name), written_by(first))
        if data_time:
            header["source"]["data_time"] = data_time.isoformat(timespec="seconds")
        written, runs_written = 0, set()
        with BundleWriter(output, header, sort=sort, threads=threads or threads_available()) as out:
            records = _records(conv, files, log, events, runs, first, out.pool)
            for record, per_run in itertools.islice(records, max_events):
                run = int(record[0][0])
                if per_run and run not in runs_written:  # a run's tables go in before its first event
                    out.add_run(*conv.run_record(run, per_run))
                    runs_written.add(run)
                out.add(*record)
                written += 1
            records.close()  # if it stopped at max_events: close the file that was being read
            if run_info:
                from .runinfo import load

                info = load(run_info, out.runs(), log=log)
                print(f"run info for {len(info)} run(s) from {run_info}", file=log)
                out.set_run_info(info)
        return written
    finally:
        first.close()


def open_file(path):
    """The ROOT file at `path` (a local path or a root:// URL), opened with uproot for reading tables.

    Nothing is cached: entries read one at a time (--events) would otherwise keep every decompressed basket (about
    230 MB per PU200 event), and chunked reading does not reuse them. A local file is read with plain seek and read:
    uproot's default (fsspec) source first merges the byte ranges of the baskets it is asked for, which for the
    thousands of baskets of a chunk costs more than reading them. A root:// URL goes through the XRootD bindings
    directly, as CMSSW has no fsspec-xrootd.
    """
    handler = uproot.source.xrootd.XRootDSource if path.startswith("root://") else uproot.MultithreadedFileSource
    return uproot.open(path, handler=handler, object_cache=None, array_cache=None)


def discover(tree):
    """The collection tables of a NanoAOD tree, from its branches (n<T> and <T>_<column>), with the columns in the
    order the producers wrote them: {table: {"doc": str, "columns": {column: (dtype, doc)}}}."""
    branches = tree.keys()
    keys = set(branches)
    columns = defaultdict(dict)
    for branch in branches:
        table, sep, column = branch.partition("_")
        if sep and f"n{table}" in keys:
            columns[table][column] = (tree[branch].interpretation.content.from_dtype, tree[branch].title)
    return {t: {"doc": tree[f"n{t}"].title, "columns": cols} for t, cols in columns.items()}


def branch_bytes(branch):
    """The raw bytes of every basket of a branch, joined (for branches uproot cannot interpret, such as the
    serialised parameter sets and process history of a CMSSW file)."""
    return b"".join(bytes(branch.basket(i).data) for i in range(branch.num_baskets))


def written_by(f):
    """The CMSSW release that wrote an open NanoAOD (or EDM) file: that of the last process of its history, or None."""
    try:
        history = branch_bytes(f["MetaData/ProcessHistory"])
    except Exception:  # noqa: BLE001
        # No such tree (e.g. a NanoAOD-like file from elsewhere): the release is not recorded.
        return None
    releases = re.findall(rb"CMSSW_\d+_\d+_[\w-]+", history)
    return releases[-1].decode() if releases else None


def parse_events(spec):
    """The set of event numbers in "416622,416630-416640" (ranges include both ends)."""
    out = set()
    for part in filter(None, (p.strip() for p in spec.split(","))):
        lo, _, hi = part.partition("-")
        out.update(range(int(lo), int(hi or lo) + 1))
    return out


def threads_available(limit=4):
    """Threads to use by default: as many as the CPUs this process may run on, at most `limit` (the machine is often
    shared)."""
    if hasattr(os, "sched_getaffinity"):
        cpus = len(os.sched_getaffinity(0))
    else:  # not on Linux
        cpus = os.cpu_count() or 1
    return max(1, min(limit, cpus))


def _run_tables(conv, f):
    """{run: per-run tables} of an open file (empty if the profile uses no per-run table or the file has none)."""
    if not conv.run_scope or "Runs" not in f:
        return {}
    runs = f["Runs"]
    present = set(runs.keys())
    arrays = runs.arrays([b for b in conv.branches("run") if b in present], library="np")
    return {int(arrays["run"][i]): conv.run_tables(arrays, i) for i in range(len(arrays["run"]))}


def _records(conv, files, log, events=None, runs=None, first=None, pool=None):
    """Yield (record, run tables) for each converted event of `files`, in order.

    events  only these event numbers
    runs    per-run tables to use instead of each file's own
    first   the first file, already open (reading the description of a tree of 2000 branches takes 0.3 s)
    pool    see _entries
    """

    def progress(n):  # how far the file being read (`name`, below) has got
        if events is not None:
            print(f"{name}: {n} of the requested events", file=log)
        elif conv.select:
            print(f"{name}: scanned {n}, selected {selected}", file=log)

    for path in files:
        name, selected = os.path.basename(path), 0
        with first if first is not None and path == files[0] else open_file(path) as f:
            first = None  # used once, even if the same file is listed again
            file_runs = _run_tables(conv, f) if runs is None else runs
            for arrays, i in _entries(f["Events"], conv, events, progress, pool):
                run_tables = file_runs.get(int(arrays["run"][i]))
                record = conv.event(arrays, i, run_tables)
                if record is not None:
                    selected += 1
                    yield record, run_tables


def _entries(tree, conv, events, progress, pool=None):
    """Yield (arrays, i) for each entry of an Events tree to convert: entry i of the chunk `arrays`.

    With `events`, only the entries of these event numbers: they are found from the event branch alone, then read one
    at a time in (run, event) order (the file is opened without caches, so memory stays flat). Otherwise the tree is
    read in chunks; with an event selection on plain columns, a first pass reads only the branches that decide it,
    and an entry is read in full only if it passes. progress(entries scanned) is called after each chunk.

    `pool`: threads that decompress the baskets (zlib releases the interpreter lock); decompressing is two thirds of
    the time it takes to read a PU200 event.
    """
    full = conv.branches()
    threaded = {"decompression_executor": pool} if pool else {}

    def read_entry(e):
        return tree.arrays(full, entry_start=e, entry_stop=e + 1, library="np", **threaded)

    if events is not None:
        numbers, runs = tree["event"].array(library="np"), tree["run"].array(library="np")
        chosen = np.flatnonzero(np.isin(numbers, list(events)))
        progress(len(chosen))
        for e in chosen[np.lexsort((numbers[chosen], runs[chosen]))]:
            yield read_entry(e), 0
        return

    pre = conv.selection_branches()
    # "100 MB" is one PU200 event per chunk (two with "200 MB"). The memory at its peak follows the chunk: about 2.6
    # times its arrays, as the compressed baskets, the decompressed baskets and the arrays are alive together.
    for arrays, report in tree.iterate(pre or full, step_size="100 MB", library="np", report=True, **threaded):
        for i in range(report.tree_entry_stop - report.tree_entry_start):
            if pre is None:
                yield arrays, i
            elif conv.passes(arrays, i):
                yield read_entry(report.tree_entry_start + i), 0
        progress(report.tree_entry_stop)
