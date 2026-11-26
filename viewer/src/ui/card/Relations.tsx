// How the card's object relates to others, from the file's own relations and associations, never matched in Ember:
// where the rest of its particle went and the particles it merges, under its truth match (WentTo), and the objects
// with exactly its parts, under More (Shares).
import { inText, singular } from "../../model/event/describe";
import { percent } from "../../model/truth/match";
import { sharedParts } from "../../model/event/physics";
import { bestPartners } from "../../model/event/relations";
import { sameLine } from "../../model/truth/graph";
import { whereItWent } from "../../model/truth/statement";
import { bundle, event, kindOf, ladder, nameOf, truthGraph, truthText } from "../../model/store";
import { chip, namedChip, ObjChip } from "./chips";

const SHOWN = 2; // the other objects named; the rest counted
const SOME = 0.05; // an other object named holds at least this much of the particle

/** Under a reco object's match: the other objects of its kind that hold a good part of its particle ("Rest of π⁻",
 *  a split), and the other particles whose own best object it is ("Merged in"), but its particle's own ancestors and
 *  descendants, which share its best object by the associator's design (it matches a particle with all below it). */
export function WentTo({ table, row, relation }: { table: string; row: number; relation: string }) {
  const b = bundle.value!,
    ev = event.value!,
    info = b.header.relations[relation],
    rel = ev.relations[relation],
    tg = truthGraph.value;
  if (!info || !rel) return null;
  const p = bestPartners(rel, info, true, ev.tables[table]?.n ?? 0).partner[row];
  if (p === undefined || p < 0) return null;
  const particles = tg?.particles === info.to,
    kin = particles && tg ? (q: number) => sameLine(tg.graph, p, q) : undefined;
  const { objects, merges } = whereItWent(ev, b.header, info.to, p, table, row, kin),
    others = objects.filter((o) => o.row !== row && (o.completeness ?? 0) >= SOME);
  if (!others.length && !merges.length) return null;
  const name = particles ? truthText(info.to, p).split(" · ")[0] : "it";
  return (
    <div class="went">
      {others.length > 0 && (
        <p class="physline" title="Other objects of its kind holding part of its match (associator): a split">
          <span class="muted">Rest of {name}:</span>{" "}
          {others.slice(0, SHOWN).map((o, i) => (
            <>
              {i > 0 && " "}
              {chip(table, o.row)}
              <span class="pct">{percent(o.completeness)}</span>
            </>
          ))}
          {others.length > SHOWN && <span class="muted"> +{others.length - SHOWN}</span>}
        </p>
      )}
      {merges.length > 0 && (
        <p
          class="physline"
          title="Other particles whose own best object of this kind is this one (associator): a merge"
        >
          <span class="muted">Merged in:</span>{" "}
          {merges.slice(0, SHOWN).map((q, i) => (
            <>
              {i > 0 && " "}
              {namedChip(info.to, q)}
            </>
          ))}
          {merges.length > SHOWN && <span class="muted"> +{merges.length - SHOWN}</span>}
        </p>
      )}
    </div>
  );
}

/** The objects of other kinds with exactly its parts, or all of them and more (a tau's PF candidates in a jet;
 *  model/event/physics.ts sharedParts). Not those the chain shows it is part of. */
export function Shares({ table, row }: { table: string; row: number }) {
  const b = bundle.value!,
    ev = event.value!,
    above = new Set(ladder.value?.above.flatMap((r) => r.groups.map((g) => g.table)) ?? []);
  // One line per wording: "same layer clusters as Trackster 4 · Candidate trackster 1".
  const lines = new Map<string, { table: string; row: number }[]>();
  for (const x of sharedParts(ev, b.header, table, row, above).slice(0, 4)) {
    const what = inText(kindOf(x.parts)),
      words = x.same ? `same ${x.n === 1 ? inText(singular(kindOf(x.parts))) : what} as` : `all its ${what} are in`;
    lines.set(words, [...(lines.get(words) ?? []), x]);
  }
  return (
    <>
      {[...lines].map(([words, xs]) => (
        <p class="physline" title="Exact: the relations in the file name the same parts (no matching in Ember)">
          {words}{" "}
          {xs.map((x, i) => (
            <>
              {i > 0 && " · "}
              <ObjChip table={x.table} row={x.row} text={nameOf(x)} />
            </>
          ))}
        </p>
      ))}
    </>
  );
}
