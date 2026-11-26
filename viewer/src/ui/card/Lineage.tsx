// A truth particle's lineage in the card (docs/truth.md): where it sits in the truth graph, from the collision down to
// its daughters, with the levels each particle belongs to and the reco objects whose best match it is.
import { signal } from "@preact/signals";
import type { Header } from "../../io/format";
import { bestPartners } from "../../model/event/relations";
import { identities } from "../../model/colour/identities";
import { bundle, event, labelOf, layerOf, modes, truthGraph } from "../../model/store";
import { copiesBelow, foldCopies } from "../../model/truth/graph";
import { LEVELS } from "../../model/truth/levelFlags";
import { namedChip as chip, spaced } from "./chips";
import { Info } from "../common/Info";

const ANCESTORS = 4; // ancestors listed above the particle; higher ones fold into one line, unfolded on a click
/** The folded ancestors are shown (kept from one particle to the next). */
const unfolded = signal(false);
const CALO_BIT = 3; // truth level "entered the calorimeter"

/** The generator's internals: quarks, gluons, generator codes (81-100), diquarks (e.g. 2101). */
function isParton(pdgId: number) {
  const id = Math.abs(pdgId);
  return id <= 8 || id === 21 || (id >= 81 && id <= 100) || (id > 1000 && id < 6000 && Math.floor(id / 10) % 10 === 0);
}

/** Truth particle `row` in the truth graph: its ancestors (the highest folded), itself, and its daughters. A
 *  particle's generator copies are one entry, "μ⁺ ×4". `compact`: one line, under a reco object's match. */
export function Lineage({ row, compact = false }: { row: number; compact?: boolean }) {
  const b = bundle.value,
    ev = event.value,
    truth = modes.value.roots.truth,
    d = truth ? layerOf(truth) : undefined,
    tg = truthGraph.value;
  if (!b || !ev || !truth || !d || !ev.tables[truth] || !tg) return null;
  const t = ev.tables[truth],
    g = tg.graph,
    { parent } = identities(d, t, ev, b.header, 0),
    flags = d.particle ? t.columns[d.particle.flags] : undefined;
  const chain: number[] = [];
  for (let a = row, steps = 0; a >= 0 && steps < t.n; a = parent[a], steps++) chain.unshift(a);
  // The particle's copies below it belong to it: the lineage ends with the last one.
  const own = copiesBelow(g, row);
  chain.push(...own.slice(1));
  const groups = foldCopies(g, chain),
    rep = (grp: number[]) => (grp.includes(row) ? row : grp.at(-1)!),
    mine = groups.findIndex((grp) => grp.includes(row));
  // The generator's internals are folded: the lineage starts below the last one.
  const pdg = t.columns.pdgId,
    above = groups.slice(0, mine),
    lastParton = pdg ? above.map((grp) => isParton(Number(pdg[rep(grp)]))).lastIndexOf(true) : -1;
  const physical = groups.slice(lastParton + 1, mine + 1),
    shown = unfolded.value && !compact ? groups.slice(0, mine + 1) : physical.slice(-1 - ANCESTORS),
    folded = mine + 1 - shown.length;
  const children = g.children(own.at(-1)!);
  const levels = (r: number) => (flags ? LEVELS.filter(({ bit }) => (Number(flags[r]) >>> bit) & 1) : []);
  const tags = (r: number) =>
    levels(r).map(({ name, flag, what }) => (
      <>
        {" "}
        <span class="badge level" title={`${what} (${flag})`}>
          {name}
        </span>
      </>
    ));
  /** A group's entry: its particle's chip, "×N" for copies, and a note when the top has several parents. */
  const entry = (grp: number[]) => {
    const parents = g.parents(grp[0]).length;
    return (
      <>
        <span class={grp.includes(row) ? "here" : undefined}>{chip(truth, rep(grp))}</span>
        {grp.length > 1 && (
          <span
            class="muted"
            title={`The generator wrote this particle ${grp.length} times (statuses ${grp.map((r) => g.col("status", r)).join(" → ")}): one particle`}
          >
            ×{grp.length} (status {g.col("status", grp[0])}→{g.col("status", grp.at(-1)!)})
          </span>
        )}
        {parents > 1 && (
          <span
            class="muted"
            title="It has several parents (a string or cluster of partons): the line follows the first"
          >
            from {parents} partons
          </span>
        )}
      </>
    );
  };
  if (compact)
    return (
      <div
        class="lineage crumb"
        title="Where the match sits in the truth graph, from the collision down. Click a particle to go to it; X goes to the match"
      >
        <span class="badge truth">truth</span>
        <span class="muted">chain</span>
        {folded > 0 && (
          <span
            class="muted"
            title={`${folded} earlier step${folded > 1 ? "s" : ""} up to the collision${lastParton >= 0 ? " (quarks and gluons of the generator)" : ""}`}
          >
            … ›
          </span>
        )}
        {shown.map((grp, k) => (
          <>
            {k > 0 && (
              <span class="muted" aria-hidden="true">
                ›
              </span>
            )}
            {entry(grp)}
            {grp.includes(row) && tags(row)}
          </>
        ))}
        {children.length > 0 && (
          <span class="muted">
            › {children.length} daughter{children.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    );
  const claims = claimsOf(b.header, truth, new Set(chain.concat(children)));
  // The particle itself is named, with its levels and copies, at the top of its card: here it is only its place.
  const line = (grp: number[], depth: number) => (
    <li style={{ paddingLeft: `${depth * 10}px` }} class={grp.includes(row) ? "here" : undefined}>
      {depth > 0 && <span class="muted">└ </span>}
      {grp.includes(row) ? (
        <b>this particle</b>
      ) : (
        <>
          {entry(grp)}
          {tags(rep(grp))}
        </>
      )}
      {grp
        .flatMap((r) => claims.get(r) ?? [])
        .slice(0, 3)
        .map(([tab, o]) => (
          <span class="muted">
            {" "}
            · {labelOf(tab).split(" · ")[0].toLowerCase()} {chip(tab, o)}
          </span>
        ))}
    </li>
  );
  const entered = flags ? children.filter((c) => (Number(flags[c]) >>> CALO_BIT) & 1).length : 0;
  return (
    <div
      class="lineage"
      title="Where it sits in the truth graph: its ancestors, itself and its daughters; the reco objects whose best match a particle is (associator)"
    >
      <p class="truthline">
        <span class="badge truth">truth</span> lineage{" "}
        <Info title="Lineage">
          <p>Where the particle sits in the truth graph: its ancestors, itself, its daughters.</p>
          <p>
            The generator writes a particle again at each of its steps (status 23, 51, …, 1): those copies are one
            entry, "×4". A particle made from several partons (a string) follows the first of them.
          </p>
          <p>
            The tags are the levels a particle belongs to; the objects named beside a particle are the reco objects
            whose best match it is (CMSSW's associator).
          </p>
        </Info>
      </p>
      <ul class="matches">
        {folded > 0 && (
          <li class="muted">
            <button
              class="link"
              title={`Show them, up to the collision${lastParton >= 0 ? " (with the generator's quarks and gluons)" : ""}`}
              onClick={() => (unfolded.value = true)}
            >
              … {folded} earlier step{folded > 1 ? "s" : ""}
            </button>
          </li>
        )}
        {unfolded.value && mine + 1 > physical.slice(-1 - ANCESTORS).length && (
          <li class="muted">
            <button class="link" onClick={() => (unfolded.value = false)}>
              fold the earlier steps
            </button>
          </li>
        )}
        {shown.map((grp, k) => line(grp, k))}
        {children.length > 0 && (
          <li class="muted" style={{ paddingLeft: `${shown.length * 10}px` }}>
            └ {children.length} daughter{children.length > 1 ? "s" : ""}
            {entered > 0 && `, ${entered} entered the calorimeter`}{" "}
            {spaced(children.slice(0, 4).map((c) => chip(truth, c)))}
            {children.length > 4 && " …"}
          </li>
        )}
      </ul>
    </div>
  );
}

/** For each of `rows`, the reco objects whose best match it is (through every reco -> truth association). */
function claimsOf(header: Header, truth: string, rows: Set<number>) {
  const ev = event.value!,
    out = new Map<number, [string, number][]>();
  for (const [name, info] of Object.entries(header.relations)) {
    const rel = ev.relations[name];
    if (!rel || !info.association || info.to !== truth || info.from === truth) continue;
    const { partner } = bestPartners(rel, info, true, ev.tables[info.from]?.n ?? 0);
    for (let o = 0; o < partner.length; o++)
      if (rows.has(partner[o])) out.set(partner[o], [...(out.get(partner[o]) ?? []), [info.from, o]]);
  }
  return out;
}
