import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { related } from "../model/relations";
import { blobSource, Bundle, httpSource } from "./bundle";

// One TICL v6 GPU event, made by: evdtools from-nano ... --max-events 1 -o golden/v6_1event.evdb
const golden = () => Bundle.open(blobSource(new Blob([readFileSync(new URL("../../../golden/v6_1event.evdb", import.meta.url))])));

describe("bundle", () => {
  it("reads header, index and an event with consistent tables", async () => {
    const b = await golden();
    expect(b.header.schema).toBe("evd/1");
    expect(b.events).toHaveLength(1);
    const ev = await b.event(0);
    expect(ev.id).toEqual([b.events[0].run, b.events[0].lumi, b.events[0].event]);
    for (const [name, t] of Object.entries(ev.tables)) {
      expect(t.n).toBe(b.events[0].counts[name]);
      for (const col of Object.values(t.columns)) expect(col.length).toBe(t.n);
    }
  });

  it("relations are CSR within the tables' bounds", async () => {
    const b = await golden();
    const ev = await b.event(0);
    for (const [name, r] of Object.entries(ev.relations)) {
      const { from, to } = b.header.relations[name];
      expect(r.offsets.length).toBe(ev.tables[from].n + 1);
      expect(r.offsets[r.offsets.length - 1]).toBe(r.indices.length);
      expect(Math.max(-1, ...r.indices)).toBeLessThan(ev.tables[to].n);
    }
  });

  it("selecting a trackster relates exactly its layer clusters", async () => {
    const b = await golden();
    const ev = await b.event(0);
    const rel = ev.relations.soaTracksterLCs;
    const hl = related(ev, b.header, { table: "TICLSoATracksters", row: 0 });
    expect([...hl.get("HGCalSoALayerClusters")!].sort((a, c) => a - c)).toEqual([...rel.indices.slice(rel.offsets[0], rel.offsets[1])].sort((a, c) => a - c));
  });
});

describe("httpSource", () => {
  it("keeps working when a server answers range requests with the whole file", async () => {
    const file = new Uint8Array([...Array(100).keys()]);
    let calls = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls++;
      const range = (init.headers as Record<string, string>).Range.match(/bytes=(\d+)-(\d+)/)!;
      if (calls === 1) // the probe is answered partially (e.g. from a cache), later reads in full
        return new Response(file.slice(0, 1), { status: 206, headers: { "Content-Range": `bytes ${range[1]}-${range[2]}/100` } });
      return new Response(file, { status: 200 });
    });
    const src = await httpSource("x.evdb");
    expect([...new Uint8Array(await src.read(10, 3))]).toEqual([10, 11, 12]);
    expect([...new Uint8Array(await src.read(90, 2))]).toEqual([90, 91]);
    expect(calls).toBe(2); // the whole file was fetched once and reused
    vi.unstubAllGlobals();
  });
});
