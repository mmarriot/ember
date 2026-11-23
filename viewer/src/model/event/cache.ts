import type { EventData } from "../../io/format";

/** Per-event results that do not depend on the selection (identity keys, content partners), so a click that only
 *  reorders the colours does not redo them. Dropped with the event. */
const perEvent = new WeakMap<EventData, Map<string, unknown>>();
export function cached<T>(ev: EventData, what: string, make: () => T): T {
  let m = perEvent.get(ev);
  if (!m) perEvent.set(ev, (m = new Map()));
  if (!m.has(what)) m.set(what, make());
  return m.get(what) as T;
}
