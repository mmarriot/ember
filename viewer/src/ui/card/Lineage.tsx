// A truth particle's place in the truth graph, in one line under its name (truth/graph.ts crumbOf): the hard process
// above it, its nearest ancestors, then itself ("t → W⁻ → e⁻"). The Truth tab's tree shows the whole graph.
import { crumbOf } from "../../model/truth/graph";
import { layerOf, truthGraph, truthText } from "../../model/store";
import { ObjChip } from "./chips";

const HARD_BIT = 1; // truth level "hard process" (an outgoing leg of the hard scatter)

/** The crumb of truth particle `row`: its ancestors' names as chips (a click looks at one, a double click opens its
 *  card), "…" where some are left out, and its own name last. */
export function Crumb({ row }: { row: number }) {
  const tg = truthGraph.value,
    d = tg ? layerOf(tg.particles) : undefined;
  if (!tg || !d) return null;
  const g = tg.graph,
    flags = d.particle?.flags,
    name = (r: number) => truthText(tg.particles, r).split(" · ")[0];
  const steps = crumbOf(g, row, (r) => !!flags && ((g.col(flags, r) >>> HARD_BIT) & 1) === 1);
  return (
    <p class="crumb" title="Where it comes from in the truth graph (the Truth tab's tree shows all of it)">
      {steps.map((a) => (
        <>
          {a === null ? <span class="muted">…</span> : <ObjChip table={tg.particles} row={g.last[a]} text={name(a)} />}
          <span class="muted" aria-hidden="true">
            →
          </span>
        </>
      ))}
      <b>{name(row)}</b>
    </p>
  );
}
