"""Display layers: the profile's `display` entries resolved against the tables of a file, as the bundle header lists
them for the viewer (docs/profiles.md: "display", "kinds", "prefer", "stages"; docs/format.md: the display hints).
"""


def display_layers(profile, tables, relations):
    """The display layers of the tables present in `tables`, in the order the viewer lists them.

    A layer with a `kind` takes that kind's style from the profile's `kinds` (the layer's own keys win, and `cut` is
    merged key by key) and is grouped under the kind's label; kinds are listed in profile order, then the layers
    without a kind.

    Within a kind, layers whose `source` ranks below the best source present (profile `prefer`, first is best) start
    hidden and are marked `alternative`, so that a file with both SoA and legacy objects shows one of them.

    Profile `stages` lists kinds in reconstruction order (e.g. trackster, linked trackster, candidate). The preferred
    layers of the stage kinds present get `stage` 0, 1, ...; all but the last stage start hidden, so that the default
    view shows the final objects. `"colourBy": "stage"` becomes the relation from the latest stage that reaches the
    layer's table, or is dropped if none does. `relations` are the profile relations present, by name.
    """
    kinds, prefer = profile.get("kinds", {}), profile.get("prefer", [])

    def rank(layer):
        return prefer.index(layer["source"]) if layer.get("source") in prefer else len(prefer)

    layers = [_styled(layer, kinds) for layer in profile.get("display", []) if layer["table"] in tables]
    preferred = _hide_alternatives(layers, rank, len(prefer))
    stages = _assign_stages(preferred, profile.get("stages", []))
    for layer in layers:
        layer.pop("stageOf", None)  # a profile key, not a display hint
        if layer.get("colourBy") == "stage":
            _colour_by_stage(layer, preferred, stages, relations)

    order = list(kinds)
    return sorted(layers, key=lambda layer: order.index(layer["kind"]) if layer.get("kind") in kinds else len(order))


def _styled(layer, kinds):
    """A copy of the layer with its kind's style, if it has a kind the profile describes."""
    kind = kinds.get(layer.get("kind"))
    if kind is not None:
        style = {k: v for k, v in kind.items() if k != "label"}
        cut = {**style.get("cut", {}), **layer.get("cut", {})} if "cut" in style or "cut" in layer else None
        layer = {**style, "group": kind["label"], **layer, **({"cut": cut} if cut else {})}
    return dict(layer)


def _hide_alternatives(layers, rank, worst):
    """Hide the layers of each kind that come from a less preferred source than the best one present, and mark them
    `alternative`. Returns the preferred layers that have a kind."""
    best = {}
    for layer in layers:
        if layer.get("kind"):
            best[layer["kind"]] = min(best.get(layer["kind"], worst), rank(layer))
    for layer in layers:
        if layer.get("kind") and rank(layer) > best[layer["kind"]]:
            layer["visible"] = False
            layer["alternative"] = True
    return [layer for layer in layers if layer.get("kind") and rank(layer) == best[layer["kind"]]]


def _assign_stages(preferred, stage_kinds):
    """Number the preferred layers by their reconstruction stage and hide all but the last stage. A layer with
    `stageOf` takes the stage of that kind (e.g. tracks shown with the candidates that use them). Returns the stage
    kinds present, in order."""
    stages = [k for k in stage_kinds if any(layer["kind"] == k for layer in preferred)]
    for layer in preferred:
        kind = layer.get("stageOf", layer["kind"])
        if kind in stages:
            layer["stage"] = stages.index(kind)
            if layer["stage"] < len(stages) - 1:
                layer["visible"] = False
    return stages


def _colour_by_stage(layer, preferred, stages, relations):
    """Replace `"colourBy": "stage"` by the relation that reaches the layer's table from the latest stage that has
    one, or drop it if no stage does."""
    del layer["colourBy"]
    for k in reversed(range(len(stages))):
        sources = {x["table"] for x in preferred if x.get("stage") == k}
        name = next((n for n, r in relations.items() if r["from"] in sources and r["to"] == layer["table"]), None)
        if name:
            layer["colourBy"] = {"relation": name}
            return


def named_columns(layer):
    """The columns of its table that a display layer names (some of them None, for hints the layer does not set).

    A hint that names a column is a string, or {"column": ...} for a scaled column; numbers are constants."""

    def column(value):
        if isinstance(value, str):
            return value
        return value.get("column") if isinstance(value, dict) else None

    cut = layer.get("cut") or {}
    cell, listing = layer.get("cell") or {}, layer.get("list") or {}
    return [
        *layer["position"],
        *layer.get("end", []),
        *layer.get("axis", []),
        *layer.get("extent", []),
        *layer.get("momentum", []),
        *(layer.get(k) for k in ("colour", "size", "time", "charge")),
        cut.get("column"),
        *layer.get("direction", []),
        column(layer.get("radius")),
        column(layer.get("length")),
        *(column(cell.get(k)) for k in ("dEta", "dPhi", "depth")),
        *cell.get("u", []),
        *cell.get("v", []),
        *(map(column, cell["size"]) if isinstance(cell.get("size"), list) else ()),
        *listing.get("columns", []),
        listing.get("sort"),
        *layer.get("inspect", []),
        *layer.get("fractions", {}),
    ]
