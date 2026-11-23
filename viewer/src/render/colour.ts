// Colours per theme. Sequential scales fade towards the background at low values and stand out at high values
// (log10 for positive quantities such as energies, linear otherwise); categorical colours tell objects apart
// (one per trackster; its layer clusters share it). Identity colours (the colour modes) give the largest objects of
// one table a colour each, and the objects linked to them the same colour. Computed once per event on the CPU, so
// shaders and legend agree.
import { type DisplayLayer, type EventData, type Header, kindName, type Table, toF32, unitOf } from "../io/format";
import { kindLabel } from "../model/event/describe";
import { bestPurities, percent } from "../model/truth/match";
import { identities, ruleText, type SlotRank, truthClasses } from "../model/colour/identities";
import { bestPartners, contentPartners } from "../model/event/relations";

export const PALETTES = {
  light: {
    background: 0xffffff,
    rim: [0.1, 0.1, 0.1],
    unassigned: "#cdd2d8",
    flash: 0, // replay: how far a new object flashes to white
    ramps: {
      heat: ["#fff1a8", "#fdb863", "#f4743b", "#c7253e", "#5c0a1e"],
      cool: ["#d6e6f5", "#8fbbe0", "#4a8cc4", "#22589b", "#0b2a5c"],
    },
    categories: [
      "#1f77b4",
      "#2ca02c",
      "#8c564b",
      "#17becf",
      "#e377c2",
      "#393b79",
      "#637939",
      "#bcbd22",
      "#3182bd",
      "#31a354",
    ],
    // Identity colours (colour modes), never repeated: Okabe-Ito and Tol hues with >= 3.6:1 contrast on white, in the
    // dark theme's hue order where possible. Simulated protan/deutan/tritan vision (Machado 2009): every pair, and
    // "other", at least 17 CIELAB dE apart (dark set: 14.5; the categories above: 1.3).
    identity: ["#D55E00", "#2E8FCB", "#117733", "#CC6677", "#AA4499", "#332288", "#882255"],
    other: "#a3abb5",
    // Identity colouring with a `first` column (truth particles: signal first): keys without it (pile-up). A warm grey
    // between "other" and "unassigned" (no truth) in lightness, so that it differs from both by its tint too.
    pileup: "#bdb2a3",
    // One colour per particle type, by name (`typeColour`): the same in every layer, whatever the order of a
    // category's `names`; plus "jet", not a type but the jets' kind, kept here so that it is per theme and apart from
    // the types. CIEDE2000, normal and simulated protan/deutan/tritan vision (Machado 2009), both themes: the tracks
    // (charged hadron, electron, muon) at least 20 apart (charged hadron and electron 51), the TICL candidates' types
    // at least 23. Weaker pairs (down to 3.5 in one simulation) are a jet's cone against a line, or HF types, |η| > 3.
    types: {
      "charged hadron": "#C06A00",
      electron: "#1565C0",
      muon: "#7A0010",
      photon: "#2E9BD6", // 3.1:1 on white
      "neutral hadron": "#0B8A5E",
      "neutral pion": "#330055",
      "HF hadron": "#4E7F6E",
      "HF EM": "#6C8A9C",
      jet: "#A898C8", // a cone is a large translucent area: as light as on the dark theme
    },
    // Categories that are not particle types (e.g. a hit's subdetector) take these first: at least 15 CIEDE2000 from
    // every type colour and the greys (8 in each simulated colour vision), so a hit's colour never reads as a type.
    // Violet is the truth's (the TRUTH badge, truth labels): no category here or above is violet (CIELAB hue 260-350
    // with chroma above 8 was replaced; the replacement is at least 19 CIEDE2000 from both themes' truth violet).
    others: ["#001100", "#CC7788", "#884400", "#555500", "#005544", "#776677", "#889955", "#333344"],
    // The pair view (model/truth/pair.ts), by class: other, matched, contamination, split, missed, reco (part of a match,
    // no truth statement of its own: neutral), branch (the branch's other particles), uncompared (the branch's hits
    // where no reco kind has an association).
    pair: ["#cdd2d8", "#117733", "#AA4499", "#B8860B", "#D55E00", "#4d5560", "#44AA99", "#6a7fa0"],
  },
  dark: {
    background: 0x0f1419,
    rim: [0.93, 0.95, 0.97],
    unassigned: "#3a424d",
    flash: 0.8,
    ramps: {
      heat: ["#6a2450", "#a0303f", "#d4533a", "#f59e42", "#fde89a"],
      cool: ["#1d4166", "#2563a0", "#3a8fd0", "#72c3ee", "#cdf0ff"],
    },
    categories: [
      "#4ea1ff",
      "#5fd068",
      "#e0b25c",
      "#3dd6e0",
      "#ff8fd1",
      "#8e95ff",
      "#b5d94c",
      "#c9a27e",
      "#76b8ff",
      "#7be39a",
    ],
    identity: ["#E69F00", "#56B4E9", "#009E73", "#D55E00", "#CC79A7", "#0072B2", "#F0E442"],
    other: "#68717c",
    pileup: "#625a50",
    types: {
      "charged hadron": "#E69F00",
      electron: "#3D9BF0",
      muon: "#D41F2C",
      photon: "#C2EBFF",
      "neutral hadron": "#22C38E",
      "neutral pion": "#FFFF88",
      "HF hadron": "#5E9C87",
      "HF EM": "#7FA3B8",
      jet: "#A898C8",
    },
    others: ["#FFDDCC", "#007733", "#ff8855", "#99BB66", "#998866", "#EEAABB", "#BB6699", "#996655"],
    pair: ["#3a424d", "#009E73", "#CC79A7", "#F0E442", "#D55E00", "#d9dde2", "#7fd6b0", "#8fa3c2"],
  },
} as const;
export type ThemeName = keyof typeof PALETTES;
export type Pal = (typeof PALETTES)[ThemeName];
export type Palette = keyof Pal["ramps"];
/** A value scale: `lo` and `hi` are the values at its two ends (in log10 units for "log"). */
export interface Range {
  scale: "log" | "linear";
  lo: number;
  hi: number;
}

export type Legend =
  | { kind: "ramp"; palette: Palette; range: Range; column: string; unit: string }
  | {
      kind: "category";
      text: string;
      note?: string;
      items?: { label: string; colour: string; ref?: { table: string; row: number } }[];
    };

// Parsed once per colour: colouring runs per object (about 500k hits at PU200) and must not allocate per object.
const parsed = new Map<string, readonly number[]>();
const rgb = (hex: string) => {
  let c = parsed.get(hex);
  if (!c) parsed.set(hex, (c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)));
  return c;
};
/** The ramp sampled at 256 levels (RGB triplets), so a colour per object is a table lookup. */
const LEVELS = 256,
  tables = new WeakMap<readonly string[], Float32Array>();
function rampTable(stops: readonly string[]) {
  let lut = tables.get(stops);
  if (!lut) {
    lut = new Float32Array(3 * LEVELS);
    for (let k = 0; k < LEVELS; k++) {
      const x = (k / (LEVELS - 1)) * (stops.length - 1),
        i = Math.min(Math.floor(x), stops.length - 2),
        f = x - i;
      const a = rgb(stops[i]),
        b = rgb(stops[i + 1]);
      for (let c = 0; c < 3; c++) lut[3 * k + c] = a[c] + (b[c] - a[c]) * f;
    }
    tables.set(stops, lut);
  }
  return lut;
}

/** Colour scale over the bulk of the values (<= 50k samples): log10 from the 5th to the 99.5th percentile when
 *  (nearly) all values are positive, otherwise linear from the 1st to the 99th. */
export function valueRange(values: ArrayLike<number>): Range {
  const step = Math.max(1, Math.floor(values.length / 50000));
  const finite: number[] = [];
  for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) finite.push(values[i]);
  const positive = finite.filter((v) => v > 0);
  const log = positive.length > 0 && positive.length >= 0.95 * finite.length;
  const xs = Float64Array.from(log ? positive.map(Math.log10) : finite).sort(); // numeric sort, no comparator calls
  if (!xs.length) return { scale: "linear", lo: 0, hi: 1 };
  const q = (f: number) => xs[Math.floor(f * (xs.length - 1))];
  const [lo, hi] = log ? [q(0.05), q(0.995)] : [q(0.01), q(0.99)];
  return hi > lo
    ? { scale: log ? "log" : "linear", lo, hi }
    : { scale: log ? "log" : "linear", lo: lo - 0.5, hi: lo + 0.5 };
}

/** A shim for bundles converted before the profiles stopped using violet, the truth's colour (docs/truth.md "One
 *  look for truth"): their RPC hits (#c070d0) and taus (#a070e0) are drawn in the profiles' new colours. Remove it once
 *  no such bundle is served. */
const RETIRED: Record<string, string> = { "#c070d0": "#ff7799", "#a070e0": "#d4b44a" };

/** The colour of a particle type by its name ("electron", "charged hadron"; "jet"), or undefined for another name. */
export const typeColour = (pal: Pal, name: string | undefined): string | undefined =>
  name !== undefined && Object.hasOwn(pal.types, name) ? (pal.types as Record<string, string>)[name] : undefined;

/** Where a value lies on a range (0 at lo, 1 at hi; beyond them outside 0..1). */
export const position = (r: Range, v: number) =>
  ((r.scale === "log" ? Math.log10(Math.max(v, 1e-12)) : v) - r.lo) / (r.hi - r.lo);

/** A table's name in colour descriptions: "tracksters (SoA)", or with its layer's label when its kind has several
 *  layers, "trackster links (linked tracksters, legacy)", "particles (truth graph)". */
export function tableName(header: Header, table: string) {
  const d = header.display.find((l) => l.table === table);
  if (!d) return table;
  const several = !!d.kind && header.display.filter((l) => l.group === d.group).length > 1;
  const lower = (x: string) => x.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()); // "CE-E", "DNN" keep capitals
  const notes = [several ? lower(d.group) : "", d.source ?? ""].filter(Boolean);
  return `${lower(several ? d.label : kindName(d))}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/** How colouring through a relation is named (legend, colour menu): "colour of its layer clusters (SoA)"; for an
 *  association with a `best` weight, "colour of its matched particles (truth graph), best by score". */
export function relatedColourText(header: Header, table: string, relation?: string) {
  const info = relation ? header.relations[relation] : undefined;
  return `colour of its ${info?.association ? "matched " : ""}${tableName(header, table)}${info?.association && info.best ? `, best by ${info.best.weight}` : ""}`;
}

/** The words under a layer drawn in one neutral colour (`colourBy: "none"`: nothing to take a colour from in this
 *  mode). A hook: the truth mode words it from the layer's truth status (e.g. "no truth for jets: no associator in
 *  CMSSW") with `describeNoLink`. */
let noLinkText = (_d: DisplayLayer) => "one colour: no link to the colour's source";
export const describeNoLink = (text: (d: DisplayLayer) => string) => {
  noLinkText = text;
};

/** The display hint that colours a table's layer, with the user's colour choice applied. */
export type LayerFor = (table: string) => DisplayLayer | undefined;
/** `emphasis`: 0 for objects with nothing to take a colour from (drawn small and grey). Category legend `items` may
 *  name an object (`ref`) for the UI to describe; `note` says what grey means. */
interface Coloured {
  rgb: Float32Array;
  legend: Legend;
  emphasis?: Uint8Array;
}

/** Options of `colours`. `range` shares one value scale between layers; without it the layer's own values set the
 *  scale. `layerFor` gives the colouring of related tables (default: their display hints), so colours follow chains:
 *  a hit takes its layer cluster's colour, which is its candidate's. `rank`: how identity colours give their slots
 *  (model/event/relations.ts identities: the domain, the selection, the truth level). */
interface ColourOptions {
  range?: Range;
  layerFor?: LayerFor;
  rank?: SlotRank;
  /** An object's number in its name (store/names.ts numberOf; default: its row + 1), for the key's "Jet 1". */
  numberOf?: (table: string, row: number) => number;
}

/** Per-object RGB (n * 3), the legend describing it, and (for relation colouring) which objects to emphasise:
 *  0 for objects not related to anything, which are drawn as background. `seen`: the tables already on a chain of
 *  related colours (no loops). */
export function colours(
  d: DisplayLayer,
  t: Table,
  ev: EventData,
  header: Header,
  pal: Pal,
  opts: ColourOptions = {},
  seen: ReadonlySet<string> = new Set(),
): Coloured {
  const {
    range,
    layerFor = (table: string) => header.display.find((l) => l.table === table),
    rank,
    numberOf = (_: string, row: number) => row + 1,
  } = opts;
  const out = new Float32Array(3 * t.n),
    cats = pal.categories.map(rgb);
  // Named categories other than particle types (e.g. a hit's subdetector) take colours apart from the types first.
  const named = [...pal.others, ...pal.categories];
  const set = (i: number, c: ArrayLike<number>, at = 0) => {
    out[3 * i] = c[at];
    out[3 * i + 1] = c[at + 1];
    out[3 * i + 2] = c[at + 2];
  };
  const setCategory = (i: number, k: number) => set(i, cats[k % cats.length]);

  if (d.colourBy === "row") {
    for (let i = 0; i < t.n; i++) setCategory(i, i);
    return { rgb: out, legend: { kind: "category", text: "one colour per object" } };
  }
  // A kind's own colour (display hint `fixedColour`), also over "none", which bundles give as old viewers' fallback; the
  // truth mode and a user's colour choice drop the hint (store/colours.ts shownLayer, custom/settings.ts withColour). A kind
  // named after a particle type (electrons, muons, photons; jets) takes that type's colour in this theme, and so does
  // a layer that the profile gives the same colour (a global muon track: the muon's).
  if (d.fixedColour && (d.colourBy === undefined || d.colourBy === "none")) {
    const kin = header.display.find((l) => l.fixedColour === d.fixedColour && typeColour(pal, l.kind));
    const colour =
        typeColour(pal, d.kind) ?? typeColour(pal, kin?.kind) ?? RETIRED[d.fixedColour.toLowerCase()] ?? d.fixedColour,
      c = rgb(colour);
    for (let i = 0; i < t.n; i++) set(i, c);
    return {
      rgb: out,
      legend: { kind: "category", text: "its kind's colour", items: [{ label: d.label, colour }] },
    };
  }
  if (d.colourBy === "none") {
    // a layer with nothing to take a colour from in this mode (e.g. vertices, by truth)
    const c = rgb(pal.unassigned);
    for (let i = 0; i < t.n; i++) set(i, c);
    return { rgb: out, legend: { kind: "category", text: noLinkText(d) } };
  }
  if (d.colourBy === "identity" && d.truth && rank?.classes) {
    // A class level: one colour per class, every class drawn alike, pile-up too (drawn small per particle). The classes
    // take the identity colours but the second, pile-up's in every class level; the rest of the collision is grey.
    const cls = truthClasses(d, t, ev, header, rank.classes),
      { anchor } = identities(d, t, ev, header, 0),
      names = [...rank.classes.map((c) => c.name), "rest of the signal collision", "pile-up"],
      hexes = [...rank.classes.map((_, k) => pal.identity[k ? k + 1 : 0]), pal.other, pal.identity[1]],
      rgbs = hexes.map(rgb),
      present = new Uint8Array(names.length);
    for (let i = 0; i < t.n; i++) {
      set(i, rgbs[cls[i]]);
      if (anchor[i]) present[cls[i]] = 1; // the key names a class only if one of its particles left hits or is matched
    }
    return {
      rgb: out,
      emphasis: new Uint8Array(t.n).fill(1),
      legend: {
        kind: "category",
        text: "each particle in the class of its nearest flagged ancestor; each hit in its particle's with most energy",
        items: names.map((label, k) => ({ label, colour: hexes[k] })).filter((_, k) => present[k]),
      },
    };
  }
  if (d.colourBy === "identity") {
    const { key, used, top, others, rule, preferred } = identities(d, t, ev, header, pal.identity.length, rank);
    const slot = new Map(top.map((k, j) => [k, j])),
      ids = pal.identity.map(rgb),
      other = rgb(pal.other),
      none = rgb(pal.unassigned);
    const first = d.particle?.first ? t.columns[d.particle.first] : undefined,
      pileup = rgb(pal.pileup);
    // A level whose particles alone take colours (b / c hadron, parton jet, τ): the rest is drawn small, so its chains
    // stand out.
    const levelFlags = rank?.only && d.particle ? t.columns[d.particle.flags] : undefined;
    const emphasis = new Uint8Array(t.n); // linked to nothing (e.g. a quark): small and grey, like any object without a partner
    for (let i = 0; i < t.n; i++) {
      const j = slot.get(key[i]);
      const background = first && !Number(first[key[i]]); // pile-up: its own grey, drawn small so the signal shows
      const outside = levelFlags && !(Number(levelFlags[key[i]]) & (rank?.level ?? 0));
      set(i, !used[key[i]] ? none : j !== undefined ? ids[j] : background ? pileup : other);
      emphasis[i] = used[key[i]] && !background && !outside ? 1 : 0;
    }
    // With a selection, the key lists only its own particles: the other colours are faded with what is not selected.
    const items = top
      .map((row, j) => ({
        label: `${kindLabel(d)} ${numberOf(d.table, row)}`,
        colour: pal.identity[j],
        ref: { table: d.table, row },
      }))
      .slice(0, rank?.prefer ? preferred : undefined);
    return {
      rgb: out,
      emphasis,
      legend: {
        kind: "category",
        text: d.truth
          ? ruleText(rule, top.length)
          : top.length === 1
            ? "one colour for the largest"
            : `one colour each for the ${top.length} largest`,
        items,
        ...(others ? { note: first ? `grey: the other ${others}; pile-up small` : `grey: the other ${others}` } : {}),
      },
    };
  }
  if (typeof d.colourBy === "object" && "category" in d.colourBy) {
    // A value named after a particle type takes that type's colour (typeColour), so a PF and a TICL candidate of one
    // type look the same. Other values follow the order of `names`, so a value keeps its colour from event to event. As
    // an object, its integer keys come in increasing order (JavaScript orders them so, whatever the file says); as
    // [value, name] pairs, as given.
    const { category: column, abs = false } = d.colourBy,
      col = t.columns[column];
    const list = Array.isArray(d.colourBy.names) ? d.colourBy.names : Object.entries(d.colourBy.names ?? {}),
      names: Record<string, string> = Object.fromEntries(list);
    const order = list.map(([v]) => String(v)),
      used = new Map<number, { k: number; colour: string; rgb: readonly number[] }>(); // value -> its place and colour
    for (let i = 0; i < t.n; i++) {
      const raw = col ? Number(col[i]) : 0,
        v = abs ? Math.abs(raw) : raw;
      let u = used.get(v);
      if (u === undefined) {
        const k = order.includes(String(v)) ? order.indexOf(String(v)) : order.length + used.size,
          colour = typeColour(pal, names[String(v)]) ?? named[k % named.length];
        used.set(v, (u = { k, colour, rgb: rgb(colour) }));
      }
      set(i, u.rgb);
    }
    const items = [...used]
      .sort((a, b) => a[1].k - b[1].k)
      .map(([v, u]) => ({ label: names[String(v)] ?? String(v), colour: u.colour }));
    // Up to 16 values get a legend entry each; more (e.g. one colour per module) only tell neighbours apart.
    return {
      rgb: out,
      legend: {
        kind: "category",
        text: items.length > 16 ? `by ${column} (${items.length} values)` : `by ${column}`,
        ...(items.length > 16 ? {} : { items }),
      },
    };
  }
  // Colour taken from a partner object: through a relation, or (content) from the hits it is made of.
  const partnerColours = (otherTable: string, partner: Int32Array, text: string): Coloured => {
    // A partner with colours of its own passes them on (one per object, a category such as a candidate's particle
    // type, or taken from its own partner, with its grey); otherwise one colour per partner.
    const od = layerFor(otherTable),
      ot = ev.tables[otherTable],
      next = new Set(seen).add(d.table);
    const from =
      od && ot && od.colourBy && !next.has(otherTable)
        ? colours(od, ot, ev, header, pal, { layerFor, rank }, next)
        : null;
    const grey = rgb(pal.unassigned),
      emphasis = new Uint8Array(t.n);
    for (let i = 0; i < t.n; i++) {
      // A partner drawn small passes that on with its colour (grey for one linked to nothing, pile-up's own grey).
      const o = partner[i];
      if (o < 0) set(i, grey);
      else if (from) set(i, from.rgb, 3 * o);
      else setCategory(i, o);
      emphasis[i] = o < 0 || (from?.emphasis !== undefined && !from.emphasis[o]) ? 0 : 1;
    }
    // A chain is named to its end: "colour of its layer clusters (SoA): colour of its candidates (legacy)".
    const via =
      from?.legend.kind === "category" && from.legend.text.startsWith("colour of") ? `: ${from.legend.text}` : "";
    return { rgb: out, emphasis, legend: { kind: "category", text: `${text}${via}`, note: "small grey: none" } };
  };
  if (typeof d.colourBy === "object" && "content" in d.colourBy && ev.tables[d.colourBy.content]) {
    const { partner, share, weight, parts, derived } = contentPartners(d.table, d.colourBy.content, t.n, ev, header);
    const name = tableName(header, d.colourBy.content),
      of = parts ? tableName(header, parts) : "parts";
    // Derived truth (e.g. a layer cluster's particle) is held to a clean match too: at least half of the weight.
    const gated = derived ? partner.map((p, i) => (share[i] >= 0.5 ? p : -1)) : partner;
    return partnerColours(
      d.colourBy.content,
      gated,
      weight
        ? `colour of the ${name} with the most ${weight} in its ${of}${derived ? " if at least half (derived in Ember)" : ""}`
        : `colour of the ${name} holding most of its ${of}`,
    );
  }
  const relName = typeof d.colourBy === "object" && "relation" in d.colourBy ? d.colourBy.relation : undefined;
  const rel = relName ? ev.relations[relName] : undefined,
    info = relName ? header.relations[relName] : undefined;
  if (rel && info && (info.to === d.table || info.from === d.table)) {
    // The partner of each object: its owner (objects of `from` that contain it) or, for a layer on the `from` side,
    // the object it points to (e.g. a trackster's truth particle). With several, the relation's `best` weight
    // decides, else the first.
    const forward = info.from === d.table && info.to !== d.table,
      otherTable = forward ? info.to : info.from;
    let partner = bestPartners(rel, info, forward, t.n).partner,
      text = relatedColourText(header, otherTable, relName);
    // A reco object takes its matched particle's colour only for a clean match (docs/truth.md): a colour then means
    // "mostly this particle", never "is this particle".
    const purity = forward && info.match?.good !== undefined ? bestPurities(ev, header, relName!) : null;
    if (purity) {
      const good = info.match!.good!;
      partner = partner.map((p, i) => (purity[i] >= good ? p : -1));
      text += ` if at least ${percent(good)} of its ${info.match!.measure === "hits" ? "hits are" : "energy is"} from it`;
    }
    return partnerColours(otherTable, partner, text);
  }

  const palette = d.palette ?? "heat",
    column = d.colour ?? "";
  const values = toF32(column ? t.columns[column] : undefined, t.n, 1);
  const r = range ?? valueRange(values),
    lut = rampTable(pal.ramps[palette]);
  for (let i = 0; i < t.n; i++) {
    const p = position(r, values[i]),
      k = 3 * Math.round((p > 0 ? (p < 1 ? p : 1) : 0) * (LEVELS - 1)); // NaN -> 0
    out[3 * i] = lut[k];
    out[3 * i + 1] = lut[k + 1];
    out[3 * i + 2] = lut[k + 2];
  }
  return {
    rgb: out,
    legend: { kind: "ramp", palette, range: r, column, unit: unitOf(header.tables[d.table]?.columns[column]?.doc) },
  };
}
