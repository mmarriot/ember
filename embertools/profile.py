"""Display profiles: what to read from a file, how its tables relate, what to cut and how to draw it.

A profile is a JSON file (the built-in ones are in embertools/profiles/; docs/profiles.md describes every key). It can
`include` other profiles, which load_profile() merges in.
"""

import importlib.resources
import json
import os

from . import Problem

# The built-in profiles, read as package data so that they are also found when embertools runs from a zip file. The
# package is named, not taken from __package__: under Python 3.9 a module loaded from a zip has no __package__ yet when
# this line runs.
BUILTIN = importlib.resources.files("embertools").joinpath("profiles")


def load_profile(name_or_path, _within=()):
    """The profile `name_or_path` (a JSON file, or the name of a built-in profile) with its `include`s merged in.

    An included profile is looked up beside the profile that includes it, then among the built-in ones. The included
    profiles are merged in order, and the profile's own keys over them (see _merge), except that its own `order`
    replaces theirs; an included profile's `name` is not inherited. `_within` is the chain of profiles being loaded,
    to catch a profile that includes itself.
    """
    path = _find_file(name_or_path, _within)
    builtin = BUILTIN.joinpath(f"{name_or_path}.json")
    if path is None and not builtin.is_file():
        known = sorted(p.name[:-5] for p in BUILTIN.iterdir() if p.name.endswith(".json"))
        raise Problem(
            f"no profile {name_or_path}: neither a file nor one of the built-in profiles ({', '.join(known)})"
        )

    # A profile is known by its real path, or as "builtin:<name>".
    key = path or f"builtin:{name_or_path}"
    if key in _within:
        raise ValueError(f"profile {key} includes itself (through {' -> '.join(_within)})")
    if path is None:
        profile = json.loads(builtin.read_text())
    else:
        with open(path) as f:
            profile = json.load(f)

    merged = {}
    for name in profile.pop("include", []):
        included = load_profile(name, (*_within, key))
        included.pop("name", None)
        merged = _merge(merged, included)
    merged = _merge(merged, profile)
    if "order" in profile:  # the profile's own order of kinds, not joined to those of its includes
        merged["order"] = profile["order"]
    if not _within:  # once, on the whole profile: an included one may leave keys to the profile that includes it
        check_shape(merged, name_or_path)
    return merged


# The keys an entry of each list must have; the converter reads them without asking (docs/profiles.md).
REQUIRED = {
    "relations": ("name", "kind"),
    "display": ("table", "label", "position"),
    "derive": ("table",),
    "select": ("table",),
}


def check_shape(profile, where):
    """A Problem that says what is missing where, for a profile whose lists and cuts are not shaped as
    docs/profiles.md says; without it, a missing key would surface as a traceback deep in the converter."""
    kinds = profile.get("kinds", {})
    for section, keys in REQUIRED.items():
        entries = profile.get(section, [])
        if not isinstance(entries, list):
            raise Problem(f"profile {where}: {section} must be a list")
        for k, entry in enumerate(entries):
            if not isinstance(entry, dict):
                raise Problem(f"profile {where}: {section}[{k}] must be an object")
            if section == "display":  # a layer takes the keys of its kind (display.py)
                entry = {**kinds.get(entry.get("kind"), {}), **entry}
            label = f"{section}[{k}]" + (f" ({entry['name']})" if "name" in entry else "")
            needed = (
                [*keys, *(("via",) if entry.get("kind") == "compose" else ("from", "to"))]
                if section == "relations"
                else keys
            )
            missing = [key for key in needed if key not in entry]
            if missing:
                raise Problem(f"profile {where}: {label} has no {', '.join(repr(m) for m in missing)}")
    cuts = profile.get("cuts", {})
    if not isinstance(cuts, dict):
        raise Problem(f"profile {where}: cuts must be an object of table: [conditions]")
    for table, conds in cuts.items():
        if not isinstance(conds, list) or not all(
            isinstance(c, dict) or (isinstance(c, list) and len(c) == 3) for c in conds
        ):
            raise Problem(
                f"profile {where}: cuts of {table} must be a list of conditions, each [column, operator, number]"
                " or an object"
            )
    order = profile.get("order", [])
    if not isinstance(order, list) or not all(isinstance(k, str) for k in order):
        raise Problem(f"profile {where}: order must be a list of kinds")


def _find_file(name_or_path, within):
    """The real path of the profile file that `name_or_path` names, or None if it names no file."""
    if not within:  # asked for by the user: a path as given
        candidates = [name_or_path]
    elif within[-1].startswith("builtin:"):  # included by a built-in profile, which has no folder to look in
        candidates = []
    else:  # included by a profile file: the file beside it, with or without the .json
        here = os.path.dirname(within[-1])
        candidates = [os.path.join(here, name_or_path), os.path.join(here, f"{name_or_path}.json")]
    return next((os.path.realpath(c) for c in candidates if os.path.isfile(c)), None)


def _merge(a, b):
    """`b` merged over `a`: dicts are merged key by key (recursively), lists are concatenated, and any other value of
    `b` replaces that of `a`."""
    if isinstance(a, dict) and isinstance(b, dict):
        return {**a, **{k: _merge(a[k], v) if k in a else v for k, v in b.items()}}
    if isinstance(a, list) and isinstance(b, list):
        return a + b
    return b


def table_column(spec):
    """The (table, column) of a "Table.column" reference in a profile."""
    table, _, column = spec.partition(".")
    return table, column
