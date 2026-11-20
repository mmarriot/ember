// What the top bar's Event box understands: an event as `run:lumi:event`, `run:event` or `event` (the numbers
// separated by ":" or spaces, as DQM and pick lists write them).

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
