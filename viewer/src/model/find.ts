// What the top bar's Event box understands: an event as `run:lumi:event`, `run:event` or `event` (the numbers
// separated by ":" or spaces, as DQM and pick lists write them), or objects of the event shown: a kind, then
// optionally an expression on its columns ("electron", "jet pt > 50", model/expr.ts).
import { type DisplayLayer, kindName, type Table } from "../io/format";
import { evaluate } from "./custom";

export interface EventId {
  run?: number;
  lumi?: number;
  event: number;
}

/** The event `text` names, or null when it is not one to three whole numbers. */
export function parseEventId(text: string): EventId | null {
  const parts = text.trim().split(/\s*:\s*|\s+/);
  if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const [a, b, c] = parts.map(Number);
  return parts.length === 3 ? { run: a, lumi: b, event: c } : parts.length === 2 ? { run: a, event: b } : { event: a };
}

/** The index of the first event of `events` with the ids `id` names, or -1. */
export function findEvent(events: readonly { run: number; lumi: number; event: number }[], id: EventId): number {
  return events.findIndex(
    (x) =>
      x.event === id.event &&
      (id.run === undefined || x.run === id.run) &&
      (id.lumi === undefined || x.lumi === id.lumi),
  );
}

/** A name compared loosely: lower case, letters and digits only, no plural "s" ("Electrons" = "electron"). */
const loose = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/s\b/g, "")
    .trim();

/** The objects `text` asks for in the event's `tables`: the first of `layers` (pass the ticked ones first) whose
 *  kind, group, name or table is named by the first words, and its rows for which the rest, a condition on its
 *  columns, holds (all of them without one). Collections of the kind that lack a column of the condition are skipped
 *  ("jet btagDeepCSVB > 0.5" finds the AK4 CHS jets). A string says why nothing was found. */
export function findObjects(
  text: string,
  layers: readonly DisplayLayer[],
  tables: Record<string, Table>,
): { layer: DisplayLayer; rows: number[]; where: string } | string {
  const words = text.trim().split(/\s+/),
    named = words.findIndex((w) => !/^[\w()]+$/.test(w)); // the kind's name stops at the first operator
  for (let k = Math.min(3, named < 0 ? words.length : named); k >= 1; k--) {
    const name = loose(words.slice(0, k).join(" ")),
      where = words.slice(k).join(" ");
    const kind = layers.filter((d) => [kindName(d), d.group, d.label, d.table].some((x) => x && loose(x) === name));
    if (!kind.length) continue;
    let error = "",
      asked = false; // a collection could be asked: then "none" is the answer, not the others' errors
    for (const layer of kind) {
      const t = tables[layer.table];
      if (!t?.n) continue;
      const rows = Array.from({ length: t.n }, (_, i) => i);
      if (!where) return { layer, rows, where };
      const r = evaluate(t, where);
      if ("error" in r || !r.boolean) {
        error ||= `${kindName(layer)}: ${"error" in r ? r.error : `"${where}" is not a condition (e.g. pt > 50)`}`;
        continue;
      }
      asked = true;
      const pass = rows.filter((i) => r.values[i]);
      if (pass.length) return { layer, rows: pass, where };
    }
    if (error && !asked) return error;
    return `No ${kindName(kind[0]).toLowerCase()}${where ? ` with ${where}` : ""} in this event`;
  }
  return `"${text.trim()}" is neither an event (run:lumi:event) nor a kind of object in this data set`;
}
