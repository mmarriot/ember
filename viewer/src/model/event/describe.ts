// One name for an object wherever it is named (docs/viewer.md "Names"): "Jet 1 · AK4 · pT 99.6 GeV · η 1.11", the
// kind in the singular, numbered from 1 by pT (the address keeps the row), the collection where the kind has several,
// then its values. And how a value is written (H1): in a unit scaled to its size, never in e-notation, and a sentinel
// ("-99: none") as words.
import { type DisplayLayer, type Header, kindName, type Table, unitOf } from "../../io/format";
import { columnName } from "./objects";

/** The singular of a kind's name, by its last word: "PF candidates" -> "PF candidate", "Vertices" -> "Vertex". */
export const singular = (s: string) =>
  s.replace(/[A-Za-z]+$/, (w) =>
    /ices$/.test(w) ? w.replace(/ices$/, "ex") : /[a-z]s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w,
  );

/** A kind's name in running text: its ordinary words in lower case, its acronyms kept ("PF candidates", "jets"). */
export const inText = (s: string) =>
  s
    .split(" ")
    .map((w) => (/^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w))
    .join(" ");

/** The name of one object of layer `d`'s kind: "Jet", "Primary vertex" (a label that names the kind itself), "Puppi
 *  MET", "Truth particle". */
export function kindLabel(d: DisplayLayer) {
  if (d.truth) return `Truth ${singular(d.label).toLowerCase()}`;
  const g = kindName(d);
  return d.label !== g && d.label.toLowerCase().endsWith(g.toLowerCase()) ? singular(d.label) : singular(g);
}

/** The collection of layer `d` within its kind, "" where its label adds nothing to the kind: "AK4 CHS", "Standalone",
 *  "HGCal" (of "Electrons (HGCal)"); "" for "Electrons" of Electrons, "Primary vertices" of Vertices (named in the
 *  kind), "Secondary" of Secondary vertices. */
export function collection(d: DisplayLayer) {
  const g = kindName(d),
    l = d.label;
  if (d.truth || !d.kind || l === g) return "";
  if (l.toLowerCase().endsWith(g.toLowerCase()) || g.toLowerCase().startsWith(l.toLowerCase())) return "";
  const m = l.match(/^(.+?)\s*\((.+)\)$/);
  return m && m[1] === g ? m[2] : l;
}

const squash = (s: string) => singular(s.toLowerCase().replace(/[^a-z0-9]/g, ""));
/** The CMSSW collection a table was read from, when its doc names one ("gedGsfElectrons", "AK4 jets (ak4PFJetsPuppi),
 *  uncorrected"), unless it only repeats the kind or the collection ("muons", "PuppiMET"). */
export function cmsswName(header: Header, d: DisplayLayer) {
  const doc = header.tables[d.table]?.doc ?? "",
    id = /^[A-Za-z][\w:]*$/.test(doc) ? doc : doc.match(/\(([A-Za-z][\w:]*)\)/)?.[1];
  if (!id) return "";
  const same = new Set([squash(kindLabel(d)), squash(collection(d)), squash(d.label)]);
  return same.has(squash(id)) ? "" : id;
}

/** Whether the kind of layer `d` has other collections in the bundle (AK4 and AK4 CHS jets): its objects' names then
 *  say which. */
export const severalOfKind = (header: Header, d: DisplayLayer) =>
  new Set(header.display.filter((l) => kindName(l) === kindName(d) && !l.truth).map((l) => l.table)).size > 1;

/** The name that tells layer `d` from the other collections of its kind: its collection, or where its label adds
 *  nothing, its CMSSW collection (gedGsfElectrons beside "HGCal" electrons); "" where its kind has one collection, or
 *  its kind already names it (Puppi MET). */
function which(header: Header, d: DisplayLayer) {
  if (!severalOfKind(header, d) || kindLabel(d) !== singular(kindName(d))) return "";
  return collection(d) || cmsswName(header, d);
}

/** "Jet 1": the kind and number `n` (store/names.ts numberOf); the kind alone for a one-object table (MET). */
const numbered = (d: DisplayLayer, n: number) => `${kindLabel(d)}${d.list?.headline === "value" ? "" : ` ${n}`}`;

/** An object's name: "Jet 1 · AK4 · pT 99.6 GeV". `cmssw`: with the CMSSW collection, for a chip's tooltip ("Jet 1 ·
 *  AK4 (ak4PFJetsPuppi) · …"). */
export function objectName(header: Header, d: DisplayLayer, n: number, values: string, cmssw = false) {
  const c = which(header, d),
    source = cmssw ? cmsswName(header, d) : "";
  const where = c && source && c !== source ? `${c} (${source})` : c || source;
  return [numbered(d, n), where, values].filter(Boolean).join(" · ");
}

/** A label's text in the view: "Jet 1 · pT 46 GeV", its collection named only where another collection of its kind is
 *  labelled too (`labelled`: the layers labelled), by the words that tell them apart ("PUPPI" of "AK4 PUPPI (raw, no
 *  JEC)" next to "AK4 CHS (raw, no JEC)"). */
export function labelName(header: Header, d: DisplayLayer, n: number, values: string, labelled: DisplayLayer[]) {
  const others = labelled.filter((l) => l.table !== d.table && !l.truth && kindName(l) === kindName(d)),
    own = others.length ? which(header, d) : "",
    shared = (w: string) => others.every((l) => which(header, l).split(" ").includes(w)),
    word =
      own
        .split(" ")
        .filter((w) => !shared(w))
        .join(" ") || own;
  return [numbered(d, n), word, values].filter(Boolean).join(" · ");
}

/** The card's header in two lines (on one, a long collection wrapped it over three): the name without its collection
 *  ("Jet 1 · pT 46 GeV · η 0.606"), and where it comes from ("AK4 PUPPI (raw, no JEC) · ak4PFJetsPuppi"; maybe ""). */
export function cardName(header: Header, d: DisplayLayer, n: number, values: string): [string, string] {
  const c = collection(d),
    source = cmsswName(header, d);
  return [
    [numbered(d, n), values].filter(Boolean).join(" · "),
    [c, source !== c ? source : ""].filter(Boolean).join(" · "),
  ];
}

/** A chip's text in a list of one kind (the chain's steps): its values, after its collection where its kind has
 *  several ("AK4 CHS · pT 52.8 GeV"). */
export function chipName(header: Header, d: DisplayLayer, n: number, values: string) {
  // a collection named in the kind (Puppi MET, PF MET) is named by it
  const own = kindLabel(d) !== singular(kindName(d)) ? kindLabel(d) : "",
    c = severalOfKind(header, d) ? which(header, d) || own : "";
  return [c, values || `${kindLabel(d)} ${n}`].filter(Boolean).join(" · ");
}

// ---- Numbers

/** Per unit, the smaller units a value is written in below a size: [below |value|, factor, unit]. */
const SMALLER: Record<string, [number, number, string][]> = {
  cm: [
    [0.1, 1e4, "µm"],
    [1, 10, "mm"],
  ],
  GeV: [[0.1, 1e3, "MeV"]],
};

/** `v` in a unit for its size: cm below 1 mm in µm, below 1 cm in mm; GeV below 0.1 in MeV. [number, unit]. The size
 *  is that of the value as written (3 figures): 0.0999995 cm is 1 mm, not 1,000 µm. */
export function scaled(v: number, unit: string): [number, string] {
  const r = Number(v.toPrecision(3)),
    s = v === 0 || !Number.isFinite(v) ? undefined : SMALLER[unit]?.find(([below]) => Math.abs(r) < below);
  return s ? [v * s[1], s[2]] : [v, unit];
}

/** A number in plain decimals, never in e-notation: `digits` significant figures, at least the units; integers in
 *  full, with thousands separators. */
export function plain(v: number, digits = 3) {
  if (Number.isNaN(v)) return "not set";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  if (v === 0) return "0"; // also -0
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  const a = Math.abs(v);
  if (a >= 10 ** digits) return Math.round(v).toLocaleString("en-US");
  const decimals = Math.min(12, Math.max(0, digits - 1 - Math.floor(Math.log10(a))));
  const text = v
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}

/** A value with its unit, scaled: "6.79 µm", "35 MeV", "59.7 GeV". */
export function withUnit(v: number, unit: string, digits = 3) {
  const [x, u] = scaled(v, unit);
  return `${plain(x, digits)}${u ? ` ${u}` : ""}`;
}

/** The value of column `c` that means it is not set (e.g. -99 for no time), from the layer's `missing` hint, else from
 *  the column's doc ("t0 [ns]; -99: none", "row in GsfTrack; -1: none", "..., -1 if none"). */
export function missingValue(header: Header, d: DisplayLayer | undefined, table: string, c: string) {
  const hint = d?.missing?.[c];
  if (hint !== undefined) return hint;
  const m = (header.tables[table]?.columns[c]?.doc ?? "").match(/(-\d+(?:\.\d+)?)(?::| if) *(none|not)/);
  return m ? Number(m[1]) : undefined;
}

/** Whether column `c` points at a row of another table (an index) rather than holding a quantity. */
export const isIndex = (header: Header, table: string, c: string) =>
  /Idx$/.test(c) || /^(row|index) (in|of)\b/.test(header.tables[table]?.columns[c]?.doc ?? "");
/** Whether column `c` is copied or derived from other columns (a PV's position copied in, px from pT and φ): not the
 *  object's own measurement. */
export const isCopied = (header: Header, table: string, c: string) =>
  /\(from [A-Za-z]\w*\.\w+|^derived from/.test(header.tables[table]?.columns[c]?.doc ?? "");

/** The name of value `v` of column `c` in the layer's colour categories (a truth vertex's reason 11, "hadronic
 *  inelastic"), if the layer is coloured by that column. */
function categoryName(d: DisplayLayer | undefined, c: string, v: number) {
  const by = d?.colourBy;
  if (typeof by !== "object" || !("category" in by) || by.category !== c || !by.names) return undefined;
  return Array.isArray(by.names) ? by.names.find(([k]) => String(k) === String(v))?.[1] : by.names[String(v)];
}

/** How column `c` of row `row` reads in the card: [value, unit]. A sentinel reads "no time" (a time) or "not set" ("none"
 *  for an index); a value named by the layer's `describe.names`, or by its colour categories, reads that name; a DetId
 *  also reads in hex. */
export function cellText(header: Header, d: DisplayLayer | undefined, table: string, t: Table, c: string, row: number) {
  const raw = t.columns[c]?.[row];
  if (raw === undefined) return ["", ""];
  if (typeof raw === "bigint") return [raw.toString(), ""];
  const v = Number(raw),
    unit = unitOf(header.tables[table]?.columns[c]?.doc) || (c === d?.cut?.column ? (d.cut.unit ?? "") : ""),
    name = d?.describe?.names?.[c]?.[String(v)] ?? categoryName(d, c, v);
  if (name) return [`${name} (${plain(v)})`, ""];
  // the layer's arrival-time column reads <= -50 for none (format.ts DisplayLayer `time`)
  if (v === missingValue(header, d, table, c) || (c === d?.time && v <= -50))
    return [isIndex(header, table, c) ? "none" : unit === "ns" || /time|^t0$/i.test(c) ? "no time" : "not set", ""];
  if (/detid|_id$/i.test(c) && Number.isInteger(v) && v > 0) return [`${v} (0x${v.toString(16)})`, ""];
  const [x, u] = scaled(v, unit);
  return [plain(x), u];
}

/** An object's values in a few words, from its layer's `describe` hint ("π⁺ · pT 65.5 GeV"), else its cut's quantity
 *  (a hit's energy), else "". Each number is named (its `prefix`, else objects.ts columnName), so a pT is never read as
 *  an energy. `skip`: columns to leave out. */
export function describeRow(
  header: Header,
  d: DisplayLayer | undefined,
  t: Table | undefined,
  row: number,
  skip: string[] = [],
) {
  const hint = d?.describe;
  if (!d || !t || row >= t.n) return "";
  if (!hint) {
    const c = d.cut?.column;
    if (!c || !(c in t.columns) || skip.includes(c)) return "";
    return `${columnName(c)} ${withUnit(Number(t.columns[c][row]), unitOf(header.tables[d.table]?.columns[c]?.doc) || (d.cut?.unit ?? ""))}`;
  }
  return hint.columns
    .filter((c) => c in t.columns && !skip.includes(c))
    .map((c) => {
      const v = Number(t.columns[c][row]),
        name = hint.names?.[c]?.[String(v)];
      if (name) return name;
      if (v === missingValue(header, d, d.table, c)) return "";
      // an empty prefix gives the bare number
      const prefix = hint.prefix?.[c] ?? columnName(c);
      return `${prefix ? `${prefix} ` : ""}${withUnit(v, unitOf(header.tables[d.table]?.columns[c]?.doc))}`;
    })
    .filter(Boolean)
    .join(" · ");
}
