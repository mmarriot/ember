// How the card's object relates to others, from the file's own relations and associations, never matched in Ember:
// - where its particle went among the objects of its kind, and the other particles whose best object it is
//   (model/statement.ts whereItWent): a split and a merge, under its match in the truth block (TruthBlock.tsx);
// - the objects of other kinds with exactly its parts (model/physics.ts sharedParts): "same supercluster as Photon 1",
//   in the physics block (Physics.tsx).
import { inText, singular } from "../model/describe";
import { percent } from "../model/match";
import { sharedParts } from "../model/physics";
import { bestPartners } from "../model/relations";
import { whereItWent } from "../model/statement";
import { bundle, event, kindOf, ladder, layerOf, nameOf } from "../model/store";
import { chip, namedChip, ObjChip, truthChip } from "./chips";

/** Where the object's particle went among the objects of its kind, and the other particles whose best object it is
 *  (model/statement.ts whereItWent): a split and a merge, in the associator's own answers. Shown when there is more
 *  than this object to say. */
export function WentTo({ table, row, relation }: { table: string; row: number; relation: string }) {
  const b = bundle.value!,
    ev = event.value!,
    info = b.header.relations[relation],
    rel = ev.relations[relation];
  if (!info || !rel) return null;
  const p = bestPartners(rel, info, true, ev.tables[table]?.n ?? 0).partner[row];
  if (p === undefined || p < 0) return null;
  const { objects, merges } = whereItWent(ev, b.header, info.to, p, table, row),
    others = objects.filter((o) => o.row !== row);
  if (!others.length && !merges.length) return null;
  const SHOWN = 4;
  return (
    <div class="went">
      {others.length > 0 && (
        <p class="physline">
          <span class="rkind">
            Where {layerOf(info.to)?.particle ? truthChip(info.to, p, info.match?.measure) : namedChip(info.to, p)} went
          </span>
          {objects.slice(0, SHOWN).map((o, i) => (
            <span>
              {i > 0 && " · "}
              {o.row === row ? <b>this one</b> : chip(table, o.row)}{" "}
              {o.completeness !== undefined && (
                <span class="q" title="completeness: the share of the particle this object holds (associator)">
                  completeness {percent(o.completeness)}
                </span>
              )}
              {o.best && (
                <span class="ok" title="The particle is this object's own best match (associator)">
                  {" "}
                  ★ its best
                </span>
              )}
            </span>
          ))}
          {objects.length > SHOWN && <span class="muted"> +{objects.length - SHOWN}</span>}
        </p>
      )}
      {merges.length > 0 && (
        <p class="physline" title="Other particles whose best object of this kind is this one (associator): a merge">
          <span class="rkind">also best match of</span>
          {merges.slice(0, 3).map((q, i) => (
            <>
              {i > 0 && " · "}
              {namedChip(info.to, q)}
            </>
          ))}
          {merges.length > 3 && <span class="muted"> +{merges.length - 3}</span>}
        </p>
      )}
    </div>
  );
}

/** The objects of other kinds with exactly its parts, or all of them and more (a tau's PF candidates in a jet): the
 *  relations name the same rows. Not those the chain shows it is part of. */
export function Shares({ table, row }: { table: string; row: number }) {
  const b = bundle.value!,
    ev = event.value!,
    above = new Set(ladder.value?.above.flatMap((r) => r.groups.map((g) => g.table)) ?? []);
  // one line per wording, listing its objects: "same layer clusters as Trackster 4 · Candidate trackster 1"
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
