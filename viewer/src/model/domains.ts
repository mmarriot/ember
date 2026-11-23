// The parts of the detector a bundle names (header `domains`) and which layers each draws. A shared domain (e.g.
// "Physics") has its layers drawn in the other domains only as an overlay the user turns on (a selection still draws
// its own objects there), and its own view draws only them and the layers without a domain (truth). "All" (null)
// draws every layer. Pure functions of the header, so they can be tested without a page.
import type { DisplayLayer, Header } from "../io/format";

/** The domains whose layers every domain draws. */
export const sharedDomains = (h: Pick<Header, "domains"> | undefined) =>
  new Set((h?.domains ?? []).filter((d) => d.shared).map((d) => d.name));

/** Whether domain `current` (null: All) draws layer `d`: its own layers, those without a domain, and with `overlay`
 *  (or from another shared domain) those of a shared domain. */
export const drawsLayer = (
  d: Pick<DisplayLayer, "domain">,
  current: string | null,
  shared: Set<string>,
  overlay = false,
) => !current || !d.domain || d.domain === current || (shared.has(d.domain) && (overlay || shared.has(current)));

/** The domain a bundle opens on: its `view.domain` if it names one of two or more domains, else All (null). */
export function startDomain(h: Pick<Header, "domains" | "view"> | undefined): string | null {
  const names = (h?.domains ?? []).map((d) => d.name),
    start = h?.view?.domain;
  return names.length >= 2 && start && names.includes(start) ? start : null;
}

/** The domain `by` steps (+1 next, -1 previous) from `current` in the cycle domains..., All. `has` (e.g. "the
 *  selection has objects there"): domains for which it is false are skipped; All never is. */
export function stepDomain(
  names: string[],
  current: string | null,
  by: number,
  has: (name: string) => boolean = () => true,
): string | null {
  if (names.length < 2) return current;
  const cycle: (string | null)[] = [...names, null];
  let i = cycle.indexOf(current);
  if (i < 0) i = cycle.length - 1;
  for (let k = 0; k < cycle.length; k++) {
    i = (i + by + cycle.length) % cycle.length;
    const c = cycle[i];
    if (c === null || has(c)) return c;
  }
  return current;
}

/** The domains of a set of layers that are not shared (where they are drawn as one part of the detector). */
export const ownDomains = (layers: Pick<DisplayLayer, "domain">[], shared: Set<string>) =>
  new Set(layers.flatMap((l) => (l.domain && !shared.has(l.domain) ? [l.domain] : [])));

type Rows = Map<string, Set<number>>;
/** The rows of `hl` (e.g. a focus's highlight) that domain `name` draws as its own: those of its layers (not of shared
 *  domains or of none, which every domain draws); with `name` null (All) or a shared domain, all of them. Null when it
 *  has none. */
export function rowsInDomain(
  hl: Rows,
  display: Pick<DisplayLayer, "table" | "domain">[],
  name: string | null,
  shared: Set<string>,
): Rows | null {
  if (!name || shared.has(name)) return [...hl.values()].some((s) => s.size) ? hl : null;
  const tables = new Set(display.filter((l) => l.domain === name).map((l) => l.table));
  const rows = new Map([...hl].filter(([t, set]) => tables.has(t) && set.size));
  return rows.size ? rows : null;
}

/** `part` with the focus itself added: what to frame when a domain is chosen with a focus (a jet from its vertex to
 *  its clusters there, not only the clusters, which in a 2D view would fill the screen). */
export function withFocus(part: Rows, focus: { table: string; row: number }): Rows {
  return new Map([...part, [focus.table, new Set([...(part.get(focus.table) ?? []), focus.row])]]);
}
