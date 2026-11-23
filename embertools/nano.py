"""NanoAOD -> .ember: read the tables of NanoAOD files and write their events to a bundle.

convert() is the whole conversion. It loads the profile (profile.py), builds a Converter (converter.py) from the
tables the file describes, then reads the events chunk by chunk (or one by one), converts each and hands the records
to a BundleWriter (bundle.py).
"""

import contextlib
import copy
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
    profile_name="auto",
    max_events=None,
    log=None,
    data_time=None,
    run_info=None,
    events=None,
    run_tables=None,
    sort=False,
    threads=None,
):
    """Write the events of the NanoAOD `files` that pass the profile's selection to the bundle `output`; returns how
    many were written. Progress and what was found go to `log` (default: standard error).

    max_events  write at most this many events (None: all)
    data_time   when the input data was taken or produced (a datetime), recorded in the header
    run_info    where to find information about the runs (see runinfo.load)
    events      only these events (event number ranges and run:lumi:event, see parse_events)
    run_tables  a NanoAOD file whose Runs tree has the per-run tables (e.g. the channel table) of the same runs, for
                inputs made without them
    sort        list the events in (run, lumi, event) order (only the index is sorted)
    threads     threads that decompress the input and compress the records (default: threads_available())
    """
    log = log or sys.stderr  # the stream of the moment, not the one there was when this module was imported
    profile = None if profile_name == "auto" else load_profile(profile_name)
    if run_info and not run_info.startswith("registry:") and not os.path.isfile(run_info):
        raise Problem(f"no run information file {run_info}")  # now, not after converting every event
    missing = [f for f in files if not f.startswith("root://") and not os.path.exists(f)]
    if missing:
        raise Problem(f"{missing[0]}: no such file")
    first = open_file(files[0])  # stays open to read its events
    try:
        _check_nanoaod(first, files[0])
        with open_file(run_tables) if run_tables else contextlib.nullcontext(first) as r:
            tables, per_run = discover(first["Events"]), discover(r["Runs"]) if "Runs" in r else None
            if profile is None:
                profile_name, profile = choose_profile(tables, per_run, files[0])
                print(f"profile {profile_name} (chosen for the tables of {os.path.basename(files[0])})", file=log)
            conv = Converter(tables, profile, per_run)
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
                f"draws (it has: {has or 'no table'}); another kind of file needs its own --profile"
            )

        header = conv.header(files, profile.get("name", profile_name), written_by(first))
        if data_time:
            header["source"]["data_time"] = data_time.isoformat(timespec="seconds")
        written, runs_written = 0, set()
        with BundleWriter(output, header, sort=sort, threads=threads or threads_available()) as out:
            records = _records(conv, files, log, events, runs, first, out.pool, max_events)
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


# The profiles that `--profile auto` chooses from: the kinds of NanoAOD files CMS makes (docs/profiles.md).
AUTO = ["phase2", "run3", "nano", "hgcal", "cms"]


def choose_profile(tables, run_tables, path):
    """(name, profile) of the AUTO profile that draws the most of the file's tables; of those that draw as many, the
    one with the fewest layers in all (the most specific: a standard NanoAOD is drawn by nano, not by the profiles
    that include it). A Problem if none draws anything."""
    best = None
    for name in AUTO:
        profile = load_profile(name)
        try:
            drawn = len(Converter(copy.deepcopy(tables), profile, copy.deepcopy(run_tables)).display)
        except ValueError:  # a table of the same name with other columns: not this kind of file
            continue
        rank = (drawn, -len(profile.get("display", [])))
        if drawn and (best is None or rank > best[0]):
            best = (rank, name, profile)
    if best is None:
        has = ", ".join(sorted(tables)[:12]) + (", ..." if len(tables) > 12 else "")
        raise Problem(
            f"{path}: none of the profiles {', '.join(AUTO)} draws its tables (it has: {has or 'no table'}). Ember "
            "reads standard NanoAOD, NANO:@HGCAL and its own NanoAOD of reconstruction files; give --profile for "
            "another kind"
        )
    return best[1], best[2]


def _check_nanoaod(f, path):
    """A Problem for an input that is a CMSSW reconstruction file (checked here, on the file the conversion reads,
    rather than by opening each file once more beforehand: reading the description of 1000 branches takes 0.4 s)."""
    if "Events" in f and "EventAuxiliary" in f["Events"]:
        raise Problem(f"{path} is a CMSSW reconstruction file, not NanoAOD: `ember view` makes its NanoAOD first")


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
    """The tables of a NanoAOD tree, from its branches, with the columns in the order the producers wrote them:
    {table: {"doc": str, "columns": {column: (dtype, doc)}}}. A collection table has a counter n<T> and branches
    <T>_<column>; branches <T>_<column> without a counter make a singleton table (one row per event, e.g. MET),
    marked "singleton": True."""
    branches = tree.keys()
    keys = set(branches)
    columns, singletons = defaultdict(dict), defaultdict(dict)
    for branch in branches:
        table, sep, column = branch.partition("_")
        if not sep:
            continue
        interpretation = getattr(tree[branch].interpretation, "content", tree[branch].interpretation)
        dtype = getattr(interpretation, "from_dtype", None)
        if f"n{table}" in keys:
            columns[table][column] = (dtype, tree[branch].title)
        elif dtype is not None and dtype.shape == ():
            singletons[table][column] = (dtype, tree[branch].title)
    out = {t: {"doc": tree[f"n{t}"].title, "columns": cols} for t, cols in columns.items()}
    out.update({t: {"doc": t, "columns": cols, "singleton": True} for t, cols in singletons.items()})
    return out


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
    """The events in "416622,416630-416640,1:5:416650": (first, last) ranges of event numbers that include both ends,
    and (run, lumi, event) triples. Ranges are kept as ranges, not expanded: CMS event numbers reach 10^9, and a set of
    a range that wide would not fit in memory."""
    out = []
    for part in filter(None, (p.strip() for p in spec.split(","))):
        if ":" in part:
            out.append(tuple(int(x) for x in part.split(":")))
        else:
            lo, _, hi = part.partition("-")
            out.append((int(lo), int(hi or lo)))
    return out


def chosen_events(numbers, events, runs=None, lumis=None):
    """A mask of the entries whose event `numbers` are in the ranges of `events` (parse_events), or whose (runs, lumis,
    numbers) are one of its triples: one vectorised comparison per range, and one sorted lookup (np.isin) for all the
    triples, so an analyst's list of thousands costs about as much as one."""
    mask = np.zeros(len(numbers), bool)
    for e in events:
        if len(e) == 2:
            mask |= (numbers >= e[0]) & (numbers <= e[1])
    triples = [e for e in events if len(e) == 3]
    if triples:
        mask |= np.isin(_id_keys(runs, lumis, numbers), _id_keys(*zip(*triples)))
    return mask


def _id_keys(runs, lumis, events):
    """One comparable key per (run, lumi, event): the three as 24 bytes (an event number can use all 64 bits, so they
    cannot be packed into one integer)."""
    ids = np.stack([np.asarray(x, np.uint64) for x in (runs, lumis, events)], -1)
    return np.ascontiguousarray(ids).view(np.dtype((np.void, 24))).ravel()


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


def _records(conv, files, log, events=None, runs=None, first=None, pool=None, max_events=None):
    """Yield (record, run tables) for each converted event of `files`, in order.

    events  only these event numbers
    runs    per-run tables to use instead of each file's own
    first   the first file, already open (reading the description of a tree of 2000 branches takes 0.3 s)
    pool    see _entries
    max_events  at most this many are needed: without an event selection, no more entries are read
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
            _check_nanoaod(f, path)
            file_runs = _run_tables(conv, f) if runs is None else runs
            stop = max_events if max_events and not conv.select else None
            for arrays, i in _entries(f["Events"], conv, events, progress, pool, stop):
                run_tables = file_runs.get(int(arrays["run"][i]))
                record = conv.event(arrays, i, run_tables)
                if record is not None:
                    selected += 1
                    yield record, run_tables


def _entries(tree, conv, events, progress, pool=None, stop=None):
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
        lumis = tree["luminosityBlock"].array(library="np") if any(len(e) == 3 for e in events) else None
        chosen = np.flatnonzero(chosen_events(numbers, events, runs, lumis))
        progress(len(chosen))
        for e in chosen[np.lexsort((numbers[chosen], runs[chosen]))]:
            yield read_entry(e), 0
        return

    pre = conv.selection_branches()
    # "100 MB" is one PU200 event per chunk (two with "200 MB"). The memory at its peak follows the chunk: about 2.6
    # times its arrays, as the compressed baskets, the decompressed baskets and the arrays are alive together.
    # `stop`: the entries after it are not read (a chunk of small events, e.g. standard NanoAOD, is thousands of them)
    chunks = tree.iterate(pre or full, step_size="100 MB", entry_stop=stop, library="np", report=True, **threaded)
    for arrays, report in chunks:
        for i in range(report.tree_entry_stop - report.tree_entry_start):
            if pre is None:
                yield arrays, i
            elif conv.passes(arrays, i):
                yield read_entry(report.tree_entry_start + i), 0
        progress(report.tree_entry_stop)
