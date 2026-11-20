// The collections of one side-panel tab (a part of the detector, or the truth): grouped by kind of object. A kind's
// heading carries its cut as a chip ("pT ≥ 30 GeV": a click
// opens its slider, Cuts.tsx) and "only". A collection is one line: tick, name, its state as chips (a filter, drawn
// for the selection only, hidden while something is selected), its count (a click lists its largest objects,
// ObjectRows.tsx) and ⋯ (colour, filter, new columns: LayerOptions.tsx). Under it only its colour scale, when the
// colour key does not explain it.
import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import type { DisplayLayer } from "../io/format";
import { filters, removeFilter } from "../model/custom";
import {
  activeMode,
  bundle,
  event,
  focusHidden,
  focusLayers,
  focusLevel,
  layerKey,
  legends,
  levels,
  noTruth,
  showAll,
  shown,
  sizeColumn,
  lookAlone,
  solo,
  soloKey,
  truthStatuses,
  visible,
} from "../model/store";
import { CutChip } from "./Cuts";
import { Info, popover, togglePopover } from "./Info";
import { explainedByKey, Options, Scale } from "./LayerOptions";
import { Headline, ObjectRows } from "./ObjectRows";

/** The tab a layer is listed in: its `domain`, or "Objects" for bundles made before layers had one. */
export const tabOf = (d: DisplayLayer) => d.domain ?? "Objects";

/** Kinds folded to their heading (by their first layer), for this page's life: a long tab (e.g. Physics) gets short. */
const folded = signal(new Set<string>());
const fold = (id: string) => {
  const f = new Set(folded.peek());
  if (!f.delete(id)) f.add(id);
  folded.value = f;
};

export function Collections({ layers }: { layers: DisplayLayer[] }) {
  const groups = new Map<string, DisplayLayer[]>();
  for (const d of layers) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  // A kind whose collections share one cut carries it on its heading; otherwise (one per calorimeter; particles cut,
  // vertices not) each cut is on the first row it applies to.
  const cutsOf = (ls: DisplayLayer[]) => [...new Set(ls.flatMap((d) => (d.cut ? [d.cut.group] : [])))];
  const onHeading = (ls: DisplayLayer[]) => cutsOf(ls).length === 1 && ls.every((d) => d.cut);
  const rowCut = (d: DisplayLayer, ls: DisplayLayer[]) =>
    d.cut && !onHeading(ls) && ls.find((x) => x.cut?.group === d.cut!.group) === d ? d.cut.group : undefined;
  return (
    <>
      <Headline layers={layers} />
      {[...groups].map(([group, ls]) => {
        const id = layerKey(ls[0]),
          shut = folded.value.has(id),
          drawn = ls.filter((d) => visible.value[layerKey(d)]).length;
        const key = soloKey(ls[0]),
          alone = solo.value === key;
        return (
          <section class={shut ? "kind folded" : "kind"} key={group}>
            <h3>
              {ls.length > 1 && <TickAll layers={ls} name={group.toLowerCase()} />}
              <button
                class="fold"
                aria-expanded={!shut}
                title={shut ? "Show this kind's collections" : "Fold this kind"}
                onClick={() => fold(id)}
              >
                {group}
              </button>
              {ls[0].doc && (
                <Info title={group}>
                  <p>{ls[0].doc}</p>
                </Info>
              )}
              {sameTruth(ls) && <TruthWord table={ls[0].table} />}
              {shut && (
                <span class="count">
                  {" "}
                  {drawn} of {ls.length} drawn
                </span>
              )}
              {!shut && onHeading(ls) && <CutChip name={cutsOf(ls)[0]} here={ls} />}
              <button
                class={alone ? "only on" : "only"}
                aria-pressed={alone}
                title={
                  alone
                    ? "Back to everything ticked"
                    : `Look at only the ${group.toLowerCase()}: nothing else is drawn until you select one, which brings its parts and its truth`
                }
                onClick={() => lookAlone(alone ? null : key)}
              >
                only
              </button>
            </h3>
            {!shut && ls.map((d) => <LayerRow key={layerKey(d)} d={d} cut={rowCut(d, ls)} here={ls} />)}
          </section>
        );
      })}
    </>
  );
}

/** One tick for several collections (a kind's, a part of the detector's): ticked when all are, half when some are; a
 *  click ticks them all, or unticks them all when all are ticked. */
export function TickAll({ layers, name }: { layers: DisplayLayer[]; name: string }) {
  const keys = layers.map(layerKey),
    on = keys.filter((k) => visible.value[k]).length,
    all = on === keys.length;
  return (
    <input
      type="checkbox"
      class="tickall"
      checked={all}
      indeterminate={on > 0 && !all}
      title={all ? `Untick all the ${name}` : `Tick all the ${name}`}
      aria-label={`All the ${name}`}
      onClick={(e) => e.stopPropagation()} // in a part's heading, a click would also fold it
      onChange={() => (visible.value = { ...visible.value, ...Object.fromEntries(keys.map((k) => [k, !all])) })}
    />
  );
}

/** In the truth colours: what the truth graph says about a kind (docs/truth.md, model/match.ts truthStatus), in one
 *  word on its heading, the reason on hover; on each row instead where its layers differ (e.g. ECAL PF clusters are
 *  matched, HF ones have none). Nothing in the reco colours. */
const WORDS = {
  match: ["match", "matched by CMSSW's associator"],
  fact: ["fact", "a simulation fact: simulated energy per particle in each hit"],
  none: ["no truth", ""],
} as const;
function TruthWord({ table }: { table: string }) {
  const s = truthStatuses.value.get(table);
  if (activeMode.value !== "truth" || !s || s.kind === "container") return null;
  const [word, what] = WORDS[s.kind],
    why = "reason" in s ? `${s.reason}${s.gap !== undefined ? ` (truth-graph.md gap ${s.gap})` : ""}` : what;
  return (
    <span class={`truthword ${s.kind}`} title={why}>
      {word}
    </span>
  );
}
/** The layers of a kind (its heading's group) in the current bundle. */
const kindLayers = (d: DisplayLayer) => (bundle.value?.header.display ?? []).filter((l) => l.group === d.group);
/** Whether the layers have one truth status (so one word on their heading). */
const sameTruth = (ls: DisplayLayer[]) => new Set(ls.map((l) => truthStatuses.value.get(l.table)?.kind)).size <= 1;

/** A symbol for how a layer is drawn, shown before its name. */
const glyph = (d: DisplayLayer) =>
  d.repr === "cells"
    ? "⬢"
    : d.repr === "markers"
      ? "•"
      : d.repr === "segments"
        ? d.truth
          ? "┄"
          : "─"
        : d.repr === "helix"
          ? d.truth
            ? "┄"
            : "∿"
          : d.repr === "polyline"
            ? "⟋"
            : d.repr === "cones"
              ? "◺"
              : d.shape === "shell"
                ? "◯"
                : d.shape === "cage"
                  ? "⊕"
                  : d.shape === "core"
                    ? "●"
                    : "⬮";

/** A layer's filter (in the pop-up of its chip): the expression, and its removal. */
function FilterPop({ table }: { table: string }) {
  const filter = filters.value[table];
  return filter ? (
    <div class="filterpop">
      <p>Only the rows where this holds are drawn:</p>
      <code>{filter}</code>
      <button
        class="remove"
        onClick={() => {
          removeFilter(table);
          popover.value = null;
        }}
      >
        Remove the filter
      </button>
    </div>
  ) : (
    <p>No filter.</p>
  );
}

/** One collection's row; under it its colour scale or, behind ⋯, its options, and its largest objects when listed. */
function LayerRow({ d, cut, here }: { d: DisplayLayer; cut?: string; here: DisplayLayer[] }) {
  const b = bundle.value!,
    key = layerKey(d),
    n = event.value?.tables[d.table]?.n ?? 0,
    legend = legends.value[key];
  const on = !!visible.value[key],
    s = shown.value[key],
    filter = filters.value[d.table];
  const [open, setOpen] = useState(false),
    [listed, setListed] = useState(false);
  // Its largest objects can be listed (those with a `list` hint always are); not hits, which lead nowhere.
  const t = event.value?.tables[d.table],
    canList = !d.list && !d.context && d.repr !== "cells" && n > 0 && !!t;
  const count = `${on && s !== undefined && s !== n ? `${s.toLocaleString()} / ` : ""}${n.toLocaleString()}`;
  // A layer of one of the focus's levels: ticking it (or its "show") draws that level.
  const level = levels.value.find((l) => l.layers.includes(d))?.name,
    showLevel = () => level && (focusLevel.value = level);
  return (
    <div
      class={`layer${on || focusLayers.value.has(key) ? "" : " off"}${activeMode.value === "truth" && noTruth(d.table) ? " faint" : ""}`}
    >
      <div class="row">
        <label title={`${d.table}${b.header.tables[d.table]?.doc ? `: ${b.header.tables[d.table].doc}` : ""}`}>
          <input
            type="checkbox"
            checked={on}
            disabled={!n}
            onChange={() => {
              visible.value = { ...visible.value, [key]: !on };
              if (!on) showLevel();
            }}
          />
          <span class="glyph" aria-hidden="true">
            {glyph(d)}
          </span>
          <span class="name">{d.label}</span>
          {d.source && (
            <span class="tag" title="Reconstruction path">
              {d.source}
            </span>
          )}
          {!sameTruth(kindLayers(d)) && <TruthWord table={d.table} />}
        </label>
        {filter && (
          <button
            class="rowchip on filter"
            title={`Filtered: ${filter}. Click to see or remove the filter`}
            onClick={(e) => togglePopover(e, () => <FilterPop table={d.table} />, "Filter")}
          >
            filter
          </button>
        )}
        {on && d.onSelection && (
          <button
            class={showAll.value[key] ? "rowchip" : "rowchip on"}
            aria-pressed={!showAll.value[key]}
            title={
              showAll.value[key]
                ? "All of them are drawn. Click to draw only those of the selected object"
                : "Drawn only for the selected object. Click to draw all of them"
            }
            onClick={() => (showAll.value = { ...showAll.value, [key]: !showAll.value[key] })}
          >
            {showAll.value[key] ? "all" : "with selection"}
          </button>
        )}
        {!on && focusLayers.value.has(key) && (
          <span class="rowchip on" title="Not ticked, but drawn now: it holds objects of the selection">
            shown
          </span>
        )}
        {on && focusHidden.value.has(key) && (
          <button
            class="rowchip"
            title="Hidden while an object is selected: one of its levels is drawn at a time. Click to draw this one"
            onClick={showLevel}
          >
            show
          </button>
        )}
        {cut && <CutChip name={cut} here={here} row={d.label} />}
        {canList ? (
          <button
            class="count listbtn"
            aria-expanded={listed}
            title="List its largest objects: click one to select it (N steps through them)"
            onClick={() => setListed(!listed)}
          >
            {count} {listed ? "▾" : "▸"}
          </button>
        ) : (
          <span class="count">{count}</span>
        )}
        <button
          class={open ? "more on" : "more"}
          aria-expanded={open}
          title="Colour, filter and new columns"
          onClick={() => setOpen(!open)}
        >
          ⋯
        </button>
      </div>
      {open ? (
        <Options d={d} legend={on ? legend : undefined} />
      ) : (
        on &&
        legend &&
        !explainedByKey(d) && (
          <div class="legend">
            <Scale d={d} legend={legend} />
          </div>
        )
      )}
      {on && d.list && <ObjectRows d={d} />}
      {listed && canList && (
        <ObjectRows d={d} list={{ columns: [sizeColumn(d.table, t!)].filter((c): c is string => !!c), max: 8 }} />
      )}
    </div>
  );
}
