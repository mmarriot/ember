// The Truth tab of the side panel: the event's reco <-> truth scorecard, the truth coverage of each kind, the truth
// collections, what became of each object that left hits (e.g. each truth-graph particle), and the trees of objects
// linked to objects of the same table (Tree.tsx). A bundle with such trees but no truth calls the tab "Tree".
import { signal } from "@preact/signals";
import { filterMask, filters } from "../model/custom";
import { matchTally } from "../model/chain";
import { factIn, facts } from "../model/facts";
import { particlesInView, topCopy, type ViewRow } from "../model/truth";
import { percent, TARGETS, type TruthStatus } from "../model/match";
import { bestPartners, cached } from "../model/relations";
import {
  bundle,
  describe,
  domain,
  event,
  isHitLayer,
  largestFirst,
  layerOf,
  modes,
  selection,
  short,
  stepName,
  truthGraph,
  truthName,
  truthStatuses,
  truthText,
} from "../model/store";
import { Info } from "./Info";
import { Collections } from "./Layers";
import { jump } from "../control/navigate";
import { passing } from "./ObjectRows";
import { Tree, treeRelations } from "./Tree";

const go = (table: string, row: number) => jump({ table, row });
const LISTED = 100; // objects listed under "what became of each one"; the rest are counted

/** The tab's content. The tabs (widgets.tsx) call it as a plain function, not as a component: it must not use hooks. */
export function TruthTab() {
  const trees = treeRelations(),
    truth = bundle.value?.header.display.filter((d) => d.truth) ?? [];
  return (
    <div>
      {truth.length > 0 && <HardProcess />}
      {trees.map(([, table]) => (
        <Outcome table={table} />
      ))}
      {truth.length > 0 && <Scorecard />}
      {truth.length > 0 && <Coverage />}
      {truth.length > 0 && <Collections layers={truth} />}
      {trees.map(([name, table]) => (
        <Tree name={name} table={table} />
      ))}
    </div>
  );
}

/** The hard process (docs/viewer.md "Truth tab"): the outgoing legs of the hard scatter (truth level HardProcess, bit
 *  1), each once (its generator copies folded), under the particle they came from (t -> b W⁺; W⁺ -> μ⁺ ν). A leg
 *  that is a parton jet (bit 7) says so. Each is a button. */
function HardProcess() {
  const tg = truthGraph.value,
    d = tg ? layerOf(tg.particles) : undefined,
    sel = selection.value;
  if (!tg || !d?.particle) return null;
  const g = tg.graph,
    flag = d.particle.flags,
    first = d.particle.first,
    bit = (r: number, b: number) => (g.col(flag, r) >>> b) & 1;
  const legs: number[] = [];
  for (let r = 0; r < g.n; r++)
    if (bit(r, 1) && (!first || g.col(first, r))) {
      const top = topCopy(g, r);
      if (!legs.includes(top)) legs.push(top);
    }
  if (!legs.length) return null;
  const from = new Map<number, number[]>(); // the leg's parent (its top copy), -1 for none -> its legs
  for (const r of legs) {
    const p = g.parents(r)[0],
      k = p === undefined ? -1 : topCopy(g, p);
    from.set(k, [...(from.get(k) ?? []), r]);
  }
  const chip = (r: number, note = "") => (
    <button
      class={sel?.table === tg.particles && g.top[sel.row] === g.top[r] ? "chip selected" : "chip"}
      title={note}
      onClick={() => go(tg.particles, g.last[r])}
    >
      {truthText(tg.particles, r).split(" · ")[0]}
      {bit(r, 7) ? <span class="muted"> jet</span> : null}
    </button>
  );
  return (
    <section class="hardprocess">
      <h3>
        Hard process{" "}
        <Info title="Hard process">
          <p>
            The outgoing legs of the hard scatter (truth level HardProcess, bit 1), under the particle they came from.
            "jet" marks a leg that stands for a parton jet (bit 7): everything below it in the graph.
          </p>
          <p>Each is one particle, though the generator writes it several times. Click one to select it.</p>
        </Info>
      </h3>
      <ul class="hard">
        {[...from].map(([p, rs]) => (
          <li>
            {p >= 0 ? chip(p) : <span class="muted">collision</span>} →{" "}
            {rs.map((r) => chip(r, truthText(tg.particles, r)))}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The count unfolded in the scorecard: "<table>|<class>". */
const opened = signal<string | null>(null);
const CLASSES = [
  ["clean", "q-clean", "a best match with purity at or above the kind's threshold"],
  ["impure", "q-impure", "a best match below the threshold: merged with, or mostly from, something else"],
  [
    "unmatched",
    "q-unmatched",
    "no match from the associator: a fake, or an object the associator does not consider (e.g. a candidate without calorimeter energy)",
  ],
] as const;

/** The Truth tab's scorecard: for each reco kind the CMSSW associator matches, how many of the objects that pass their
 *  cuts and filters are a clean match, an impure one, or unmatched (model/chain.ts matchTally). A count unfolds to its
 *  objects, largest first: the event's fakes and merges, one click away. */
function Scorecard() {
  const b = bundle.value,
    ev = event.value,
    statuses = truthStatuses.value;
  if (!b || !ev || !modes.value.roots.truth) return null;
  const rows = b.header.display
    .filter((d, i, all) => !d.truth && !d.context && all.findIndex((x) => x.table === d.table) === i)
    .flatMap((d) => {
      const s = statuses.get(d.table),
        p = s?.kind === "match" ? passing(d) : null,
        tally = s?.kind === "match" && p ? matchTally(ev, b.header, s.relation, p.pass) : null;
      return tally && s?.kind === "match" ? [{ d, tally, match: s.match }] : [];
    });
  if (!rows.length) return null;
  return (
    <section class="scorecard">
      <h3>
        Reco ↔ truth in this event{" "}
        <Info title="Reco ↔ truth in this event">
          <p>
            For each kind of reco object that CMSSW's associator matches to the truth: how many of the objects drawn
            (passing their cuts and filters) are a clean match, an impure one, or have none.
          </p>
          <p>Click a number to list those objects, largest first; click one to select it.</p>
          <p>Kinds without an associator are under Truth coverage.</p>
        </Info>
      </h3>
      <table class="score">
        <thead>
          <tr>
            <th />
            {CLASSES.map(([name, , what]) => (
              <th title={what}>{name === "unmatched" ? "no match" : name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ d, tally, match }) => {
            const open = CLASSES.find(([name]) => opened.value === `${d.table}|${name}`)?.[0],
              list = open ? largestFirst(d.table, tally[open]) : [];
            return (
              <>
                <tr>
                  <td
                    title={`${match.target ? `They reconstruct ${TARGETS[match.target]}. ` : ""}${tally.good !== undefined ? `Clean: at least ${percent(tally.good)} of its ${match.measure === "hits" ? "hits" : match.measure === "pt2" ? "tracks' pT²" : "energy"} from its match.` : ""}`}
                  >
                    {stepName(d.table)}
                  </td>
                  {CLASSES.map(([name, cls]) => {
                    const k = `${d.table}|${name}`,
                      n = tally[name].length;
                    return (
                      <td>
                        <button
                          class={`num ${n ? cls : "zero"}`}
                          disabled={!n}
                          aria-expanded={opened.value === k}
                          title={n ? "List them" : undefined}
                          onClick={() => (opened.value = opened.value === k ? null : k)}
                        >
                          {n.toLocaleString()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
                {open && (
                  <tr class="list">
                    <td colSpan={4}>
                      {list.slice(0, 40).map((r) => (
                        <button class={`chip q-${open}`} onClick={() => jump({ table: d.table, row: r })}>
                          {describe(d.table, r) || `#${r}`}
                        </button>
                      ))}
                      {list.length > 40 && <span class="muted"> … {list.length - 40} more</span>}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The Truth tab's first section: what the truth graph says about each kind drawn from this bundle (docs/truth.md
 *  "Where truth stops"), in the words of the inspector and the colour key. */
function Coverage() {
  const b = bundle.value,
    statuses = truthStatuses.value;
  if (!b || !modes.value.roots.truth) return null;
  const seen = new Set<string>(),
    rows: [string, TruthStatus][] = [];
  for (const d of b.header.display) {
    const s = statuses.get(d.table),
      kind = truthName(d.table);
    if (!s || d.context || seen.has(kind)) continue;
    seen.add(kind);
    rows.push([kind, s]);
  }
  const gap = (n?: number) => (n !== undefined ? ` (truth-graph.md gap ${n})` : "");
  const what = (s: TruthStatus) =>
    s.kind === "match"
      ? [
          `matched by CMSSW`,
          `${s.match.target ? `reconstruct ${TARGETS[s.match.target]}; ` : ""}clean from ${percent(s.match.good)} of its ${s.match.measure === "hits" ? "hits" : s.match.measure === "pt2" ? "tracks' pT²" : "energy"}${s.match.in ? ` (${s.match.in})` : ""}`,
        ]
      : s.kind === "fact"
        ? [
            "simulation fact",
            `simulated energy per particle in each hit${s.in ? ` (${s.in})` : ""}${s.unit ? `, recorded per ${typeof s.unit === "string" ? s.unit : Object.values(s.unit.names).join(", ")}` : ""}`,
          ]
        : s.kind === "container"
          ? ["with what contains it", "no truth of its own: drawn in the colour of the object it belongs to"]
          : ["no truth for this kind", `${s.reason}${gap(s.gap)}`];
  // Folded to one line of counts (e.g. "7 matched · 9 no truth"): the list is long, and the collections come after it.
  const counts = (["match", "fact", "container", "none"] as const)
    .map((k) => [k, rows.filter(([, st]) => st.kind === k).length] as const)
    .filter(([, n]) => n);
  const SHORT = { match: "matched", fact: "sim", container: "via container", none: "no truth" };
  return (
    <section class="coverage">
      <details>
        <summary>
          <h3>Truth coverage</h3> <span class="count">{counts.map(([k, n]) => `${n} ${SHORT[k]}`).join(" · ")}</span>
        </summary>
        <p class="hint">
          What the truth graph says about each kind: matched by CMSSW's associator, or a simulation fact. Where it has
          no answer, Ember builds none: the gap is listed, with its number in the truth-graph notes.
        </p>
        <ul class="coverage">
          {rows.map(([kind, s]) => {
            const [word, detail] = what(s),
              why = s.kind === "none";
            return (
              <li class={s.kind === "none" ? "none" : undefined} title={detail}>
                <span class="kindname">{kind}</span> {word}
                {why && <span class="muted">: {detail}</span>}
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}

/** What became of each object of `table` that left hits (associations to a layer drawn as cells; e.g. each simulated
 *  particle): its best match (by the association's `best` weight) among the objects of the latest reconstruction
 *  stage it has associations to. Only reads the associations in the file; objects with none are flagged. With
 *  simulation facts in several detectors (the truth particles), one match per detector it left hits in, each against
 *  the kind compared there (model/pair.ts comparedKind): a barrel electron is matched by its ECAL cluster, not "lost"
 *  for want of an HGCal trackster. */
function Outcome({ table }: { table: string }) {
  const b = bundle.value!,
    ev = event.value!,
    t = ev.tables[table],
    sel = selection.value;
  const own = facts(b.header).filter((f) => f.from === table && ev.relations[f.name]);
  if (layerOf(table)?.truth && own.length) return <InView table={table} />;
  const rels = Object.entries(b.header.relations).filter(
    ([n, r]) => r.from === table && r.association && ev.relations[n],
  );
  const hitRels = rels.filter(([n, r]) => factIn(b.header, n) !== undefined || isHitLayer(layerOf(r.to))); // facts; cells without truth (a tree)
  const final = b.header.display
    .filter((l) => l.stage !== undefined && rels.some(([, r]) => r.to === l.table))
    .reduce<(typeof b.header.display)[number] | undefined>((a, l) => (!a || l.stage! > a.stage! ? l : a), undefined);
  const toFinal = final && rels.find(([, r]) => r.to === final.table);
  if (!hitRels.length || !final || !toFinal) return null;
  const keep = filterMask(t, filters.value[table]);
  const withHits = largestFirst(
    table,
    [...Array(t.n).keys()].filter(
      (r) =>
        (!keep || keep[r]) &&
        hitRels.some(([n]) => {
          const o = ev.relations[n].offsets;
          return o[r + 1] > o[r];
        }),
    ),
  );
  const [relName, info] = toFinal,
    rel = ev.relations[relName],
    w = info.best ? rel.weights[info.best.weight] : undefined;
  const best = bestPartners(rel, info, true, t.n).entry;
  const matched = withHits.filter((r) => best[r] >= 0),
    missed = withHits.filter((r) => best[r] < 0);
  const chip = (tab: string, r: number) => (
    <button class={sel?.table === tab && sel.row === r ? "chip selected" : "chip"} onClick={() => go(tab, r)}>
      {describe(tab, r) || `#${r}`}
    </button>
  );
  return (
    <section class="outcome">
      <h3>
        What became of each {layerOf(table)?.truth ? "particle" : "object"}{" "}
        <Info title="What became of each one">
          <p>
            {withHits.length} left hits{keep ? ` (filter: ${filters.value[table]})` : ""}: {matched.length}{" "}
            reconstructed as {final.group.toLowerCase()}.
          </p>
          <p>
            Each one with its best match by {info.best?.weight ?? "order"}
            {w ? " (the number on the right)" : ""}, from the associations in the file.
          </p>
        </Info>
      </h3>
      <table class="kv outcome">
        <tbody>
          {matched.slice(0, LISTED).map((r) => {
            const k = best[r];
            return (
              <tr>
                <td>{chip(table, r)}</td>
                <td>→ {chip(info.to, rel.indices[k])}</td>
                <td title={info.best?.weight}>{w && short(w[k])}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {matched.length > LISTED && <p class="hint">… {matched.length - LISTED} more</p>}
      {missed.length > 0 && (
        <>
          <p class="hint">Not reconstructed: {missed.length}</p>
          <div class="missed">
            {missed.slice(0, LISTED).map((r) => chip(table, r))}
            {missed.length > LISTED && <span class="muted"> … {missed.length - LISTED} more</span>}
          </div>
        </>
      )}
    </section>
  );
}

/** Which column "Particles in this view" is sorted by, largest first. */
const sortBy = signal<"amount" | "completeness" | "split">("amount");

/** The truth entry point (docs/viewer.md "Particles in this view"): detector by detector of the view, the particles
 *  with simulated energy in its hits (in the tracker, those its tracks are matched to), largest first, each with its
 *  best object of the kind compared there, that object's completeness for it, how many objects of the kind hold part of
 *  it, and whether its best object is also another particle's. Sortable; a click selects. */
function InView({ table }: { table: string }) {
  const b = bundle.value!,
    ev = event.value!,
    t = ev.tables[table],
    sel = selection.value,
    dom = domain.value,
    keep = filterMask(t, filters.value[table]);
  // Once per event, view and filter: a new selection only re-renders it.
  const dets = cached(ev, `inView|${table}|${dom}|${filters.value[table] ?? ""}`, () =>
    particlesInView(ev, b.header, table, dom, keep ? (r) => !!keep[r] : undefined),
  );
  if (!dets.length) return null;
  const order = sortBy.value,
    value = (r: ViewRow) =>
      order === "amount" ? r.amount : order === "completeness" ? (r.completeness ?? -1) : r.split;
  const chip = (tab: string, r: number, text?: string) => (
    <button class={sel?.table === tab && sel.row === r ? "chip selected" : "chip"} onClick={() => go(tab, r)}>
      {text ?? (describe(tab, r) || `#${r}`)}
    </button>
  );
  const amount = (x: number, sim: boolean) =>
    !sim ? `${short(x)} GeV` : x < 1 ? `${short(1000 * x)} MeV` : `${short(x)} GeV`;
  const total = new Set(dets.flatMap((d) => d.rows.map((r) => r.particle))).size;
  return (
    <section class="outcome inview">
      <h3>
        Particles in this view{" "}
        <span class="count">
          {total}
          {dom ? ` · ${dom}` : ""}
        </span>{" "}
        <Info title="Particles in this view">
          <p>
            Detector by detector, the truth particles that left simulated energy in its hits (from the hit index: the
            energy deposited in the sensors, not calibrated), largest first; in the tracker, which has no simulated
            energy in the file, the particles a track is matched to, by pT. A particle is listed in each detector it
            reached: energies of different detectors are never compared or added.
            {keep ? ` Filter: ${filters.value[table]}.` : ""}
          </p>
          <p>
            For each, its <b>best match</b>: the object of the kind compared there that CMSSW's associator rates best
            for it, with that object's completeness (<b>% of it</b>: the share of the particle it holds); <b>split</b>:
            how many objects of the kind hold part of it, when more than one; <b>shared</b>: how many other particles of
            the list have the same best match (a merge). A detector whose reco has no association (HF, HO) is not
            compared.
          </p>
          <p>Click a particle or an object to select it.</p>
        </Info>
      </h3>
      <p class="sortby">
        sort by
        {(
          [
            ["amount", "energy (pT)"],
            ["completeness", "completeness"],
            ["split", "split"],
          ] as const
        ).map(([k, text]) => (
          <button
            class={`link${order === k ? " on" : ""}`}
            aria-pressed={order === k}
            onClick={() => (sortBy.value = k)}
          >
            {text}
          </button>
        ))}
      </p>
      {dets.map((d, i) => {
        const sim = d.by === "simEnergy",
          sorted = [...d.rows].sort((a, c) => value(c) - value(a) || c.amount - a.amount),
          none = d.kind ? d.rows.filter((r) => r.best < 0).length : 0;
        return (
          <details class="indet" open={i === 0 || dets.length <= 2}>
            <summary>
              <b>{d.in}</b>{" "}
              <span class="count">
                {d.rows.length} {sim ? "with simulated energy" : "matched by a track"}
                {d.kind ? ` · compared with ${stepName(d.kind).toLowerCase()}` : " · not compared"}
                {none ? ` · ${none} no match` : ""}
              </span>
            </summary>
            <table class="inview">
              <thead>
                <tr>
                  <th>particle</th>
                  <th class="num" title={sim ? "simulated energy, not calibrated" : "pT"}>
                    {sim ? `sim E` : "pT"}
                  </th>
                  <th>best match</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, LISTED).map((r) => (
                  <tr>
                    <td>{chip(table, r.particle, truthText(table, r.particle, sim))}</td>
                    <td class="num">{amount(r.amount, sim)}</td>
                    <td>
                      {!d.kind ? (
                        <span class="muted">not compared</span>
                      ) : r.best >= 0 ? (
                        <>
                          {chip(d.kind, r.best)}{" "}
                          <span class="muted" title="The best match's completeness: the share of the particle it holds">
                            {r.completeness !== undefined ? `${percent(r.completeness)} of it` : ""}
                          </span>
                        </>
                      ) : (
                        <span class="muted">none</span>
                      )}
                      {r.split > 1 && (
                        <span class="muted" title="Objects of the kind that hold part of it">
                          {" "}
                          · split {r.split}
                        </span>
                      )}
                      {r.shares > 0 && (
                        <span class="muted" title="Other particles of this list whose best match is the same object">
                          {" "}
                          · shared +{r.shares}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.rows.length > LISTED && <p class="hint">… {d.rows.length - LISTED} more (sort to see others first)</p>}
          </details>
        );
      })}
    </section>
  );
}
