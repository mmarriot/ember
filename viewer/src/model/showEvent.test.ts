import { describe, expect, it } from "vitest";
import type { Bundle, EventData } from "../io/bundle";
// The store sets the page's theme as it loads: a stand-in page (the tests run without a DOM).
Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
const { bundle, eventIndex, loading, rawEvent, showEvent, stepEvent } = await import("./store");

/** A bundle of n events whose reads finish when the test says so. */
function fake(n: number) {
  const reads: number[] = [],
    pending = new Map<number, (ev: EventData) => void>();
  const b = {
    header: { display: [], tables: {} },
    events: Array.from({ length: n }, () => ({})),
    event: (i: number) => {
      reads.push(i);
      return new Promise<EventData>((done) => pending.set(i, done));
    },
    keep: () => {},
  } as unknown as Bundle;
  const finish = async (i: number) => {
    pending.get(i)!({ id: [1, 1, i], tables: {}, relations: {} });
    await new Promise((r) => setTimeout(r, 0));
  };
  return { b, reads, finish };
}

describe("showEvent", () => {
  it("reads one event at a time, going on to the last one asked for", async () => {
    const { b, reads, finish } = fake(10);
    bundle.value = b;
    void showEvent(0);
    await finish(0);
    expect(eventIndex.value).toBe(0);
    reads.length = 0;
    void stepEvent(1);
    void stepEvent(1);
    void stepEvent(1); // → three times while event 1 is read
    expect(reads).toEqual([1]);
    expect(loading.value).toBe(true);
    await finish(1); // not shown: 3 was asked for meanwhile, and 2 is skipped
    expect(eventIndex.value).toBe(0);
    expect(reads.slice(0, 2)).toEqual([1, 3]);
    await finish(3);
    expect(eventIndex.value).toBe(3);
    expect(rawEvent.value?.id[2]).toBe(3);
    expect(loading.value).toBe(false);
    expect(reads[2]).toBe(4); // then the next one is read ahead
  });

  it("drops a read of a bundle no longer open", async () => {
    const one = fake(5),
      two = fake(5);
    bundle.value = one.b;
    void showEvent(2);
    bundle.value = two.b; // another data set opened while event 2 is read
    void showEvent(0);
    expect(two.reads).toEqual([0]);
    await one.finish(2);
    await two.finish(0);
    expect(eventIndex.value).toBe(0);
    expect(rawEvent.value?.id[2]).toBe(0);
    expect(two.reads[1]).toBe(1); // read ahead forwards: the event shown before was another bundle's
  });
});
