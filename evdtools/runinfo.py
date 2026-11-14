"""Information about runs (type, setup, beam, dates, comments), stored in a bundle's index and shown by the viewer.

Sources:
  - a JSON file: {"<run>": {field: value}} or [{"Run": <run>, field: value}, ...]
  - a run registry table (MySQL), "registry:<database>.<table>", e.g. registry:RunRegistryP5.RunTable: one row per run
    with a "Run" column; read through the HGCal DPG run registry's read-only guest account by default. Needs the
    mysql-connector-python package; without it (or without network) no information is added and a warning is given.
"""

import datetime
import json
import sys

REGISTRY = {"host": "dbod-cms-hgcal-dpg-runtable.cern.ch", "port": 5501, "user": "guest", "password": ""}


def _clean(row):
    """JSON-friendly values; empty ones (None, "", "nan", "N/A", "[]") dropped."""
    out = {}
    for k, v in row.items():
        if isinstance(v, (datetime.datetime, datetime.date)):
            v = v.isoformat(sep=" ") if isinstance(v, datetime.datetime) else v.isoformat()
        elif isinstance(v, float) and v.is_integer():
            v = int(v)
        if v is None or (isinstance(v, str) and v.strip().lower() in ("", "nan", "n/a", "none", "[]", "{}")):
            continue
        out[str(k)] = v if isinstance(v, (int, float, str, bool)) else str(v)
    return out


def from_json(path, runs):
    with open(path) as f:
        data = json.load(f)
    by_run = (
        {int(k): v for k, v in data.items()}
        if isinstance(data, dict)
        else {int(r.get("Run", r.get("run"))): {k: v for k, v in r.items() if k not in ("Run", "run")} for r in data}
    )
    return {r: _clean(by_run[r]) for r in runs if r in by_run}


def from_registry(table, runs, connection=None, log=sys.stderr):
    """Rows of `table` ("database.table") for `runs`."""
    try:
        import mysql.connector
    except ImportError:
        print("run info: mysql-connector-python is not installed; no run information added", file=log)
        return {}
    database, _, name = table.partition(".")
    try:
        conn = mysql.connector.connect(**(connection or REGISTRY), connection_timeout=15)
        cur = conn.cursor(dictionary=True)
        marks = ", ".join(["%s"] * len(runs))
        cur.execute(f"SELECT * FROM `{database}`.`{name}` WHERE Run IN ({marks})", list(runs))
        rows = cur.fetchall()
        conn.close()
    except Exception as e:  # no network, no access: the bundle is still useful without it
        print(f"run info: could not read {table}: {e}", file=log)
        return {}
    return {int(r["Run"]): _clean({k: v for k, v in r.items() if k != "Run"}) for r in rows}


def load(source, runs, log=sys.stderr):
    """Run information for `runs` from a source spec ("registry:db.table" or a JSON path); {} if none."""
    if not source or not runs:
        return {}
    if source.startswith("registry:"):
        return from_registry(source[len("registry:") :], sorted(runs), log=log)
    return from_json(source, runs)
