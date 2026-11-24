// The side panel's Truth tab (docs/viewer.md "Truth tab"): the truth levels the graph shows (its legend), its controls
// (vertices, what the view draws of the picks, search, the picks), the graph (truthgraph/view.ts), and a folded
// Details section: the truth collections, the particles in the view and the reco <-> truth scorecard. A bundle with
// trees but no truth calls the tab "Tree" and shows them (Tree.tsx), as does a truth bundle without level flags.
import { signal, type Signal } from "@preact/signals";
import { filterMask, filters } from "../../model/custom/settings";
import { factIn, facts } from "../../model/truth/facts";
import { particlesInView, type ViewRow } from "../../model/truth/particles";
import { GRAPH_LEVELS } from "../../model/truth/levelGraph";
import { matchTally, percent, TARGETS } from "../../model/truth/match";
import { bestPartners, type Ref } from "../../model/event/relations";
import { cached } from "../../model/event/cache";
import { PALETTES } from "../../render/colour";
import {
  bundle,
  chipText,
  clearPicks,
  describe,
  domain,
  event,
  graphLevels,
  graphQuery,
  graphVertices,
  isHitLayer,
  largestFirst,
  layerOf,
  modes,
  pickTruth,
  selection,
  short,
  stepName,
  theme,
  truthDraw,
  truthGraph,
  truthLevelGraph,
  truthPicks,
  truthStatuses,
  truthText,
} from "../../model/store";
import { Info } from "../common/Info";
import { counted } from "./Coverage";
import { Collections } from "./Layers";
import { jump } from "../../control/navigate";
import { passing } from "./ObjectRows";
import { Tree, treeRelations } from "./Tree";
import { levelColour, matchingNodes } from "./truthgraph/view";
// The view of the graph (truthgraph/view.ts says what it is given and may use).
import { TreeView as GraphView } from "./truthgraph/TreeView";

/** Which folded sections are open, kept while the tab is closed and between events (a plain <details> would fold
 *  again on every visit). */
const folds = signal<Record<string, boolean>>({});
const fold = (name: string) => ({
  open: folds.value[name] ?? false,
  onToggle: (e: Event) => {
    const open = (e.currentTarget as HTMLDetailsElement).open;
    if (open !== (folds.peek()[name] ?? false)) folds.value = { ...folds.peek(), [name]: open };
  },
});

const go = (table: string, row: number) => jump({ table, row });
const LISTED = 100; // objects listed per table; the rest are counted

/** A chip that selects row `row` of `table`, lit while it is the selection; a truth object is named by `describe`. */
const selectChip = (sel: Ref | null, table: string, row: number, text?: string) => (
  <button class={sel?.table === table && sel.row === row ? "chip selected" : "chip"} onClick={() => go(table, row)}>
    {text ?? ((layerOf(table)?.truth && describe(table, row)) || chipText(table, row))}
  </button>
);

/** The tab's content. The tabs (widgets.tsx) call it as a plain function, not as a component: it must not use hooks. */
export function TruthTab() {
  const trees = treeRelations(),
    truth = bundle.value?.header.display.filter((d) => d.truth) ?? [],
    tg = truthGraph.value,
    lg = truthLevelGraph.value;
  const browse = trees.map(([name, table]) => <Tree name={name} table={table} />);
  if (!truth.length)
    return (
      <div>
        {trees.map(([, table]) => (
          <Outcome table={table} />
        ))}
        {browse}
      </div>
    );
  return (
    <div>
      {tg && lg ? (
        <>
          <Levels counts={lg.counts} />
          <Controls />
          <GraphView lg={lg} g={tg.graph} particles={tg.particles} vertices={tg.vertices} />
        </>
      ) : (
        browse
      )}
      <section class="fold details">
        <details {...fold("details")}>
          <summary>
            <h3>Details</h3>
          </summary>
          <Collections layers={truth} />
          {trees.map(([, table]) => (
            <Outcome table={table} />
          ))}
          <Scorecard />
        </details>
      </section>
    </div>
  );
}

/** The truth levels the graph shows, one chip each in its colour (the graph's legend), with how many particles of the
 *  event are at it; a click shows or hides them. A level only a truth preset sets is offered where the event has it. */
function Levels({ counts }: { counts: number[] }) {
  const mask = graphLevels.value,
    pal = PALETTES[theme.value];
  return (
    <div class="graphlevels" role="group" aria-label="Truth levels the graph shows">
      {GRAPH_LEVELS.map((l, i) => {
        const on = !!(mask & l.mask);
        if (l.optional && !counts[i]) return null;
        return (
          <button
            class={on ? "chip on" : "chip"}
            aria-pressed={on}
            title={`${l.what}: ${counts[i]} in this event. Click to ${on ? "hide" : "show"} them in the graph.`}
            style={{ "--level": levelColour(pal, i) }}
            onClick={() => (graphLevels.value = on ? mask & ~l.mask : mask | l.mask)}
          >
            <i class="swatch" />
            {l.name} <span class="muted">{counts[i].toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One of a few values of `value`, as a row of buttons after a label. */
function Choice<T>({
  label,
  title,
  value,
  options,
}: {
  label: string;
  title: string;
  value: Signal<T>;
  options: [T, string, string][];
}) {
  return (
    <div class="segmented small" role="group" aria-label={label} title={title}>
      <span class="label">{label}</span>
      {options.map(([v, text, what]) => (
        <button
          class={value.value === v ? "on" : ""}
          aria-pressed={value.value === v}
          title={what}
          onClick={() => (value.value = v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The graph's controls: its vertices, what the view draws of the picked particles, the search (Enter picks the next
 *  particle found), and the picks. */
function Controls() {
  const n = truthPicks.value.length;
  return (
    <div class="graphcontrols">
      <Choice
        label="Vertices"
        title="The vertices between the particles, in the graph"
        value={graphVertices}
        options={[
          [false, "hide", "Particles straight under the particles they came from"],
          [true, "show", "The vertex each particle was made at, between it and the particles it came from"],
        ]}
      />
      <Choice
        label="3D"
        title="What the view draws of the truth for the particles picked"
        value={truthDraw}
        options={[
          ["particle", "particle only", "Each picked particle, from the vertex it was made at to the one it ended at"],
          ["descendants", "+ descendants", "Each picked particle and everything it made"],
        ]}
      />
      <input
        class="expr"
        type="search"
        placeholder="Find: a name (B, μ), a pdgId (511), |pdg|=11"
        value={graphQuery.value}
        spellcheck={false}
        onInput={(e) => (graphQuery.value = (e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === "Enter" && pickNextFound()}
      />
      {n > 0 && (
        <span class="picks">
          {n} selected ·{" "}
          <button class="link" title="Pick no particle, and close the card" onClick={clearPicks}>
            clear
          </button>
        </span>
      )}
    </div>
  );
}

/** Picks the particle the search finds after the one selected (the first, largest, at first), so Enter steps
 *  through them. */
function pickNextFound() {
  const tg = truthGraph.peek(),
    lg = truthLevelGraph.peek(),
    sel = selection.peek();
  if (!tg || !lg) return;
  const found = matchingNodes(lg, tg.graph, layerOf(tg.particles)?.describe?.names?.pdgId ?? {}, graphQuery.peek()),
    at = sel?.table === tg.particles ? found.findIndex((i) => lg.particles[i].top === tg.graph.top[sel.row]) : -1;
  if (found.length) pickTruth(lg.particles[found[(at + 1) % found.length]].last);
}

/** The scorecard's unfolded count: "<table>|<class>". */
const opened = signal<string | null>(null);
const CLASSES = [
  ["clean", "q-clean", "a best match with purity at or above the kind's threshold"],
  ["impure", "q-impure", "a best match below the threshold: merged with, or mostly from, something else"],
  [
    "unmatched",
    "q-unmatched",
    "not matched by the associator: a fake, or an object the associator does not consider (e.g. a candidate without calorimeter energy)",
  ],
] as const;

/** For each reco kind the CMSSW associator matches, how many of the objects that pass their cuts and filters are a
 *  clean match, an impure one, or unmatched (model/truth/match.ts matchTally). A count unfolds to its objects. */
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
    <section class="scorecard fold">
      <details {...fold("scorecard")}>
        <summary>
          <h3>Reco ↔ truth in this event</h3>{" "}
          <Info title="Reco ↔ truth in this event">
            <p>
              For each kind of reco object that CMSSW's associator matches to the truth: how many of the objects drawn
              (passing their cuts and filters) are a clean match, an impure one, or have none.
            </p>
            <p>Click a number to list those objects, largest first; click one to select it.</p>
            <p>Kinds without an associator are under Truth coverage, in the Metadata tab.</p>
          </Info>
        </summary>
        <table class="score">
          <thead>
            <tr>
              <th />
              {CLASSES.map(([name, , what]) => (
                <th title={what}>{name === "unmatched" ? "not matched" : name}</th>
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
                      title={`${match.target ? `They reconstruct ${TARGETS[match.target]}. ` : ""}${tally.good !== undefined ? `Clean: at least ${percent(tally.good)} of its ${counted(match)} from its match.` : ""}`}
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
                            {chipText(d.table, r)}
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
      </details>
    </section>
  );
}

/** What became of each object of `table` that left hits: its best match among the objects of the latest
 *  reconstruction stage it has associations to, from the associations in the file. The truth particles, with
 *  simulation facts in several detectors, are listed per detector instead (InView). */
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
  // to hits: simulation facts, or cells without truth (a tree)
  const hitRels = rels.filter(([n, r]) => factIn(b.header, n) !== undefined || isHitLayer(layerOf(r.to)));
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
  const chip = (tab: string, r: number) => selectChip(sel, tab, r);
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

/** Particles in this view (docs/viewer.md): per detector, the particles with simulated energy in its hits (in the
 *  tracker, those its tracks are matched to), each with its best object of the kind compared there
 *  (model/truth/pair.ts comparedKind). */
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
  const chip = (tab: string, r: number, text?: string) => selectChip(sel, tab, r, text);
  const amount = (x: number) => (x < 1 ? `${short(1000 * x)} MeV` : `${short(x)} GeV`);
  const total = new Set(dets.flatMap((d) => d.rows.map((r) => r.particle))).size,
    sims = new Set(dets.map((d) => d.by === "simEnergy")),
    // the energy deposited in a calorimeter, or a track's particle's pT
    amountName = sims.size > 1 ? "deposited energy or pT" : sims.has(true) ? "deposited energy" : "pT";
  return (
    <section class="outcome inview fold">
      <details {...fold("inview")}>
        <summary>
          <h3>Particles in this view</h3>{" "}
          <span class="count">
            {total}
            {dom ? ` in ${dom}` : ""}
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
              for it, with that object's completeness (<b>% of it</b>: the share of the particle it holds); <b>split</b>
              : how many objects of the kind hold part of it, when more than one; <b>shared</b>: how many other
              particles of the list have the same best match (a merge). A detector whose reco has no association (HF,
              HO) is not compared.
            </p>
            <p>Click a particle or an object to select it.</p>
          </Info>
        </summary>
        <p class="sortby">
          sort by{" "}
          {(
            [
              ["amount", amountName],
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
                  {none ? ` · ${none} not matched` : ""}
                </span>
              </summary>
              <table class="inview">
                <thead>
                  <tr>
                    <th>particle</th>
                    {/* in the tracker, the particle's name already gives its pT */}
                    {sim && (
                      <th
                        class="num"
                        title={`Simulated energy the particle deposited in the ${d.in} sensors (hit index), not calibrated: not its energy`}
                      >
                        deposited in {d.in}
                      </th>
                    )}
                    <th title="The best match, and its completeness: the share of the particle it holds">
                      best match · % of it
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, LISTED).map((r) => (
                    <tr>
                      <td>{chip(table, r.particle, truthText(table, r.particle, sim))}</td>
                      {sim && <td class="num">{amount(r.amount)}</td>}
                      <td>
                        {!d.kind ? (
                          <span class="muted">not compared</span>
                        ) : r.best >= 0 ? (
                          <>
                            {chip(d.kind, r.best)}{" "}
                            <span
                              class="muted"
                              title="The best match's completeness: the share of the particle it holds"
                            >
                              {r.completeness !== undefined ? percent(r.completeness) : ""}
                            </span>
                          </>
                        ) : (
                          <span class="muted">none</span>
                        )}
                        {/* the spaces outside the spans: where a narrow column wraps */}
                        {r.split > 1 && (
                          <>
                            {" "}
                            <span class="muted" title="Objects of the kind that hold part of it">
                              · split {r.split}
                            </span>
                          </>
                        )}
                        {r.shares > 0 && (
                          <>
                            {" "}
                            <span
                              class="muted"
                              title="Other particles of this list whose best match is the same object"
                            >
                              · shared +{r.shares}
                            </span>
                          </>
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
      </details>
    </section>
  );
}
