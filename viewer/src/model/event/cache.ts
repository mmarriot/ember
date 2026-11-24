// Results worked out once per event (or once per header) and kept until it is dropped: what does not depend on the
// selection, so a click that only reorders the colours does not redo it.
import type { EventData, Header } from "../../io/format";

const perOwner = new WeakMap<EventData | Header, Map<string, unknown>>();

/** `make()`, computed once per `owner` (an event or a header) and `what` (a key naming everything it depends on). */
export function cached<T>(owner: EventData | Header, what: string, make: () => T): T {
  let m = perOwner.get(owner);
  if (!m) perOwner.set(owner, (m = new Map()));
  if (!m.has(what)) m.set(what, make());
  return m.get(what) as T;
}
