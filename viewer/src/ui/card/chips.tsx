// An object's name as a button, wherever the card names one. A click looks at it (the view shows it, the card stays:
// store/selection.ts look); a double click opens its card; pointing at it rings it in the view. For a kind the CMSSW
// associator matches, a dot says what it found: clean, impure or no match.
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { sameRef } from "../../model/event/relations";
import { length, REASON, vertexText } from "../../model/truth/graph";
import {
  anchor,
  chipText,
  describe,
  event,
  layerOf,
  look,
  matchOf,
  modes,
  nameOf,
  numberOf,
  openCard,
  selection,
  truthGraph,
  truthText,
} from "../../model/store";
import { rowHover } from "../viewport/Labels";
import { frameFocus } from "../../control/navigate";

const WORDS = { clean: "clean match", impure: "impure match", unmatched: "not matched", matched: "matched" };
const glide = () => frameFocus(800);

/** The chip of row `r` of table `t`, named as in a list of its kind ("AK4 CHS · pT 52.8 GeV"); `title`: more to say on
 *  hover. */
export const chip = (t: string, r: number, title = "") => <ObjChip table={t} row={r} title={title} />;
/** The chip of truth particle `r`, named as everywhere by pT and η ("μ⁺ · pT 96.6 · η 1.11"). */
export const truthChip = (t: string, r: number) => <ObjChip table={t} row={r} />;

export function ObjChip({
  table,
  row,
  text,
  title = "",
}: {
  table: string;
  row: number;
  text?: string;
  title?: string;
}) {
  const sel = selection.value,
    viewing = !!anchor.value && sel?.table === table && sel.row === row,
    q = matchOf(table, row),
    ref = { table, row };
  // A chip removed under the pointer (its card opened, the event changed) gets no mouseleave: its ring goes with it.
  useEffect(
    () => () => {
      if (sameRef(rowHover.peek(), ref)) rowHover.value = null;
    },
    [table, row],
  );
  return (
    <button
      class={`chip${q ? ` q-${q}` : ""}${viewing ? " viewing" : ""}`}
      aria-pressed={viewing}
      title={`${nameOf(ref, [], true)}${q ? ` · ${WORDS[q]}` : ""}${title && ` · ${title}`}\nClick: look at it · double click: open its card`}
      onClick={() => {
        look(ref);
        glide();
      }}
      onDblClick={() => {
        openCard(ref);
        glide();
      }}
      onMouseEnter={() => (rowHover.value = ref)}
      onMouseLeave={() => (rowHover.value = null)}
    >
      {text ?? ((table === truthGraph.value?.vertices && vertexLabel(row)) || chipText(table, row))}
    </button>
  );
}

/** An object's chip, named by its `describe` hint or category; a truth particle's or a truth vertex's as in ObjChip. */
export const namedChip = (t: string, r: number) => (
  <ObjChip
    table={t}
    row={r}
    text={
      t === modes.peek().roots.truth || t === truthGraph.peek()?.vertices
        ? undefined
        : describe(t, r) || named(t, r) || undefined
    }
  />
);
/** An object's name from its layer's categorical colouring (e.g. a truth vertex's reason: "decay 240"), for layers
 *  without a `describe` hint. */
export function named(t: string, r: number) {
  const c = layerOf(t)?.colourBy,
    v = typeof c === "object" && "category" in c ? event.value?.tables[t]?.columns[c.category]?.[r] : undefined,
    name = v === undefined ? undefined : categoryNames(t)[String(v)];
  return name ? `${name} ${numberOf(t, r)}` : "";
}

/** The generator's own steps (truth::VertexReason): primary, hard scatter, shower branching, hadronization. Their
 *  vertices are named by their collision, not by the parton that happens to come first into them. */
export const GENERATOR_STEPS = new Set<number>([1, 17, 18, REASON.hadronization]);

/** Truth vertex `v` in words, as the Truth tab's tree names it: what happened there ("B⁰ decay · 3 charged"); a
 *  generator step by its collision ("hard scatter · signal collision"); with `collision`, only the collision (what
 *  a primary vertex's match stands for): "signal collision", "pile-up collision at z -6.75 mm". "" without the graph. */
export function vertexLabel(v: number, collision = false): string {
  const tg = truthGraph.value;
  if (!tg?.vertices) return "";
  const g = tg.graph,
    first = layerOf(tg.particles)?.particle?.first,
    s = first ? event.value?.tables[tg.vertices]?.columns[first]?.[v] : undefined,
    pileup = s !== undefined && !Number(s),
    where =
      s === undefined ? "collision" : pileup ? `pile-up collision at z ${length(g.vcol("z", v))}` : "signal collision";
  if (collision) return where;
  const reasons = categoryNames(tg.vertices),
    reason = g.vcol("reason", v);
  if (GENERATOR_STEPS.has(reason) || g.into(v) < 0) return `${reasons[String(reason)] ?? "vertex"} · ${where}`;
  return `${vertexText(g, v, (r) => truthText(tg.particles, r).split(" · ")[0], reasons)}${pileup ? " · pile-up" : ""}`;
}

/** The names of a layer's categories (e.g. the truth vertices' reasons), from its categorical colouring. */
export function categoryNames(table: string | undefined): Record<string, string> {
  const c = table ? layerOf(table)?.colourBy : undefined;
  if (typeof c !== "object" || !("category" in c) || !c.names) return {};
  return Array.isArray(c.names) ? Object.fromEntries(c.names) : c.names;
}

/** Chips side by side, a space between them (so that their text reads as words when copied). */
export const spaced = (xs: ComponentChildren[]) =>
  xs.map((x, i) => (
    <>
      {i > 0 && " "}
      {x}
    </>
  ));
