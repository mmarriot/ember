// The Truth tab of the side panel: the event's reco <-> truth scorecard, the truth coverage of each kind, the truth
// collections, what became of each object that left hits (e.g. each truth-graph particle), and the trees of objects
// linked to objects of the same table (Tree.tsx). A bundle with such trees but no truth calls the tab "Tree".
import { signal } from "@preact/signals";
import { filterMask, filters } from "../model/custom";
import { matchTally } from "../model/chain";
import { factIn, facts } from "../model/facts";
import { comparedKind, truthToReco } from "../model/pair";
import { percent, TARGETS, type TruthStatus } from "../model/match";
import { bestPartners } from "../model/relations";
import {
  bundle,
  describe,
  event,
  isHitLayer,
  largestFirst,
  layerOf,
  modes,
  selection,
  short,
  stepName,
  truthName,
  truthStatuses,
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
      {truth.length > 0 && <Scorecard />}
      {truth.length > 0 && <Coverage />}
      {truth.length > 0 && <Collections layers={truth} />}
      {trees.map(([, table]) => (
        <Outcome table={table} />
      ))}
      {trees.map(([name, table]) => (
        <Tree name={name} table={table} />
      ))}
    </div>
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
  const SHORT = { match: "matched", fact: "fact", container: "via container", none: "no truth" };
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
  if (layerOf(table)?.truth && own.length) return <ByDetector table={table} />;
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

/** Outcome for the truth particles: per particle that left hits, in each detector it left them in, its best match
 *  among the kind compared there (TruthToReco, by its `best` weight), "none" where the associator gives none, and
 *  "not compared" in a detector whose reco has no association. Largest first. */
function ByDetector({ table }: { table: string }) {
  const b = bundle.value!,
    ev = event.value!,
    t = ev.tables[table],
    sel = selection.value,
    keep = filterMask(t, filters.value[table]);
  const where = [...new Set(facts(b.header).filter((f) => f.from === table && ev.relations[f.name]).map((f) => f.in))];
  const dets = where.map((w) => {
    const kind = comparedKind(b.header, table, w),
      t2r = kind ? truthToReco(b.header, table, kind) : undefined,
      rels = facts(b.header).filter((f) => f.from === table && f.in === w && ev.relations[f.name]);
    const best = t2r && ev.relations[t2r[0]] ? bestPartners(ev.relations[t2r[0]], t2r[1], true, t.n) : undefined;
    const has = (r: number) => rels.some((f) => ev.relations[f.name].offsets[r + 1] > ev.relations[f.name].offsets[r]);
    return { in: w, kind, best, weight: t2r?.[1].best?.weight, rel: t2r && ev.relations[t2r[0]], has };
  });
  const rows = largestFirst(
    table,
    [...Array(t.n).keys()].filter((r) => (!keep || keep[r]) && dets.some((d) => d.has(r))),
  ).map((r) => ({ r, cells: dets.filter((d) => d.has(r)) }));
  const compared = rows.filter(({ cells }) => cells.some((d) => d.kind)),
    matched = compared.filter(({ r, cells }) => cells.some((d) => d.best && d.best.partner[r] >= 0)),
    missed = compared.filter(({ r, cells }) => !cells.some((d) => d.best && d.best.partner[r] >= 0)),
    uncompared = rows.filter(({ cells }) => !cells.some((d) => d.kind));
  const chip = (tab: string, r: number) => (
    <button class={sel?.table === tab && sel.row === r ? "chip selected" : "chip"} onClick={() => go(tab, r)}>
      {describe(tab, r) || `#${r}`}
    </button>
  );
  return (
    <section class="outcome">
      <h3>
        What became of each particle{" "}
        <Info title="What became of each particle">
          <p>
            {rows.length} particles left hits{keep ? ` (filter: ${filters.value[table]})` : ""} (simulation: the ones
            that entered the calorimeter, each with the hits of its own shower). {matched.length} have a match in at
            least one detector they left hits in.
          </p>
          <p>
            In each detector, the particle's best match by CMSSW's associator among the kind compared there:{" "}
            {dets
              .map((d) => `${d.in}: ${d.kind ? stepName(d.kind).toLowerCase() : "nothing (no association)"}`)
              .join("; ")}
            . The number is the association's {dets.find((d) => d.weight)?.weight ?? "weight"}.
          </p>
          <p>Simulated energy is not compared across detectors: a few MeV in a second detector still show there.</p>
        </Info>
      </h3>
      <table class="kv outcome">
        <tbody>
          {matched.slice(0, LISTED).map(({ r, cells }) => (
            <tr>
              <td>{chip(table, r)}</td>
              <td>
                {cells.map((d) => {
                  const k = d.best?.entry[r] ?? -1,
                    w = d.weight && d.rel && k >= 0 ? d.rel.weights[d.weight]?.[k] : undefined;
                  return (
                    <span class="outcell">
                      <span class="muted">{d.in}</span>{" "}
                      {!d.kind ? (
                        <span class="muted">not compared</span>
                      ) : k >= 0 ? (
                        <>
                          {chip(d.kind, d.best!.partner[r])}
                          {w !== undefined && <span class="muted" title={d.weight}>{short(w)}</span>}
                        </>
                      ) : (
                        <span class="muted">none</span>
                      )}{" "}
                    </span>
                  );
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {matched.length > LISTED && <p class="hint">… {matched.length - LISTED} more</p>}
      {missed.length > 0 && (
        <>
          <p class="hint">No match where they left hits: {missed.length}</p>
          <div class="missed">
            {missed.slice(0, LISTED).map(({ r }) => chip(table, r))}
            {missed.length > LISTED && <span class="muted"> … {missed.length - LISTED} more</span>}
          </div>
        </>
      )}
      {uncompared.length > 0 && (
        <p class="hint">
          Hits only where no reco has an association ({[...new Set(uncompared.flatMap(({ cells }) => cells.map((d) => d.in)))].join(", ")}):{" "}
          {uncompared.length}
        </p>
      )}
    </section>
  );
}
