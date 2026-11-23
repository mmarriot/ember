// The address of what is on screen, which the share button copies: data set, event, view, domain, selection and its
// level, truth colours and their grouping, and the kind drawn alone. ui/App.tsx writes it as the page changes and reads
// it when the page opens. Anyone can type or edit an address, so reading it checks every value, and drops one that is
// not well formed.

/** What an address names. Only `bundle` and `event` are always there. */
export interface Link {
  /** b: the data set, as openBundle takes it (a file of the site, or an address elsewhere). */
  bundle: string;
  /** e: the event's position in the data set, from 0. */
  event: number;
  /** v: the view (a ViewName; the caller checks it is one). */
  view?: string;
  /** d: the domain, or "All" for everything in a data set that opens on a domain. */
  domain?: string;
  /** s=Table:row: the selected object (the caller checks the row exists in the event). */
  selection?: { table: string; row: number };
  /** lv: the level of the selection's focus. */
  level?: string;
  /** c=truth: coloured by truth. */
  truth?: boolean;
  /** g: the level the truth colours group by (model/truth.ts ColourLevel id; the caller checks it is one). */
  group?: string;
  /** only: the kind drawn alone. */
  only?: string;
}

/** A row or event position: digits only, so that "abc", "1.5", "-1" and "" are no number at all. */
const position = (text: string | null | undefined) => (text && /^\d+$/.test(text) ? Number(text) : undefined);

/** The link in an address's fragment or query (without its "#" or "?"); null if it names no data set. */
export function readLink(text: string): Link | null {
  const p = new URLSearchParams(text),
    bundle = p.get("b");
  if (!bundle) return null; // "b=" names nothing
  const [table, row] = (p.get("s") ?? "").split(":"),
    selected = position(row);
  return {
    bundle,
    event: position(p.get("e")) ?? 0,
    ...(p.get("v") ? { view: p.get("v")! } : {}),
    ...(p.get("d") ? { domain: p.get("d")! } : {}),
    ...(table && selected !== undefined ? { selection: { table, row: selected } } : {}),
    ...(p.get("lv") ? { level: p.get("lv")! } : {}),
    ...(p.get("c") === "truth" ? { truth: true } : {}),
    ...(p.get("g") ? { group: p.get("g")! } : {}),
    ...(p.get("only") ? { only: p.get("only")! } : {}),
  };
}

/** The fragment for `link`, without its "#". "/" and ":" may stand as they are in a fragment, so the link reads
 *  b=data/u/alice/x.ember, not b=data%2Fu%2F… */
export function writeLink(link: Link): string {
  const p = new URLSearchParams({
    b: link.bundle,
    e: String(link.event),
    ...(link.view ? { v: link.view } : {}),
    ...(link.domain ? { d: link.domain } : {}),
    ...(link.selection ? { s: `${link.selection.table}:${link.selection.row}` } : {}),
    ...(link.level ? { lv: link.level } : {}),
    ...(link.truth ? { c: "truth" } : {}),
    ...(link.group ? { g: link.group } : {}),
    ...(link.only ? { only: link.only } : {}),
  });
  return String(p).replace(/%2F/g, "/").replace(/%3A/g, ":");
}
