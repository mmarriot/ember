import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { related } from "../model/relations";
import { around, blobSource, Bundle, FormatError, httpSource, type Source } from "./bundle";
import { gatedSource, testBundle } from "./testing";

// One TICL v6 GPU event, made by: ember convert ... --max-events 1 -o golden/v6_1event.ember
const golden = () =>
  Bundle.open(blobSource(new Blob([readFileSync(new URL("../../../golden/v6_1event.ember", import.meta.url))])));

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
    expect([...hl.get("HGCalSoALayerClusters")!].sort((a, c) => a - c)).toEqual(
      [...rel.indices.slice(rel.offsets[0], rel.offsets[1])].sort((a, c) => a - c),
    );
  });
});

describe("httpSource", () => {
  it("keeps working when a server answers range requests with the whole file", async () => {
    const file = new Uint8Array([...Array(100).keys()]);
    let calls = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      calls++;
      const range = (init.headers as Record<string, string>).Range.match(/bytes=(\d+)-(\d+)/)!;
      if (calls === 1)
        // the probe is answered partially (e.g. from a cache), later reads in full
        return new Response(file.slice(0, 1), {
          status: 206,
          headers: { "Content-Range": `bytes ${range[1]}-${range[2]}/100` },
        });
      return new Response(file, { status: 200 });
    });
    const src = await httpSource("x.ember");
    expect([...new Uint8Array(await src.read(10, 3))]).toEqual([10, 11, 12]);
    expect([...new Uint8Array(await src.read(90, 2))]).toEqual([90, 91]);
    expect(calls).toBe(2); // the whole file was fetched once and reused
    vi.unstubAllGlobals();
  });

  it("probes past the browser's cache, and names the version it found in every read", async () => {
    const asked: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      asked.push([url, init]);
      const [, a, b] = (init.headers as Record<string, string>).Range.match(/bytes=(\d+)-(\d+)/)!.map(Number);
      return new Response(new Uint8Array(b - a + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${a}-${b}/100`, ETag: '"5f-abc"' },
      });
    });
    const src = await httpSource("data/x.ember");
    await src.read(10, 3);
    expect(asked[0][0]).toBe("data/x.ember");
    expect(asked[0][1].cache).toBe("no-store");
    expect(asked[1][0]).toBe(`data/x.ember?v=${encodeURIComponent('"5f-abc"')}`);
    expect(asked[1][1].cache).toBeUndefined(); // this version's ranges may come from the cache
    vi.unstubAllGlobals();
  });

  it("refuses the bytes of a file replaced since it was opened", async () => {
    let etag = '"v1"';
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const [, a, b] = (init.headers as Record<string, string>).Range.match(/bytes=(\d+)-(\d+)/)!.map(Number);
      return new Response(new Uint8Array(b - a + 1), {
        status: 206,
        headers: { "Content-Range": `bytes ${a}-${b}/100`, ETag: etag },
      });
    });
    const src = await httpSource("x.ember");
    await src.read(0, 4);
    etag = '"v2"'; // converted again under the same name
    await expect(src.read(4, 4)).rejects.toThrow(/changed on the server/);
    vi.unstubAllGlobals();
  });
});

describe("event cache", () => {
  // The golden bundle, counting the reads of its one event record (header, index and trailer are read on open).
  const counted = async (failFirst = false) => {
    const file = readFileSync(new URL("../../../golden/v6_1event.ember", import.meta.url)),
      src = blobSource(new Blob([file]));
    const counts = { events: 0 },
      b = await Bundle.open(src),
      at = b.events[0].offset;
    const reading: Source = {
      size: src.size,
      read: (o, l) => {
        if (o === at && counts.events++ === 0 && failFirst) return Promise.reject(new Error("network"));
        return src.read(o, l);
      },
    };
    (b as unknown as { source: Source }).source = reading;
    return { b, counts };
  };

  it("reads an event once while it is kept, and again once let go", async () => {
    const { b, counts } = await counted();
    const [a, c] = await Promise.all([b.event(0), b.event(0)]); // a read under way is shared
    expect(a).toBe(c);
    expect(await b.event(0)).toBe(a);
    expect(counts.events).toBe(1);
    b.keep([0]);
    expect(await b.event(0)).toBe(a);
    b.keep([]);
    expect(await b.event(0)).not.toBe(a);
    expect(counts.events).toBe(2);
  });

  it("reads again after a failed read", async () => {
    const { b, counts } = await counted(true);
    await expect(b.event(0)).rejects.toThrow("network");
    expect((await b.event(0)).tables).toBeTruthy();
    expect(counts.events).toBe(2);
  });

  it("keeps the shown event and its neighbours, and reads ahead in the direction of travel", () => {
    expect(around(4, 3, 10)).toEqual({ keep: [4, 5, 3], next: 5 }); // forward
    expect(around(4, 5, 10)).toEqual({ keep: [4, 3, 5], next: 3 }); // back
    expect(around(0, 9, 10)).toEqual({ keep: [0, 1, 9], next: 1 }); // forward, wrapping around
    expect(around(9, 0, 10)).toEqual({ keep: [9, 8, 0], next: 8 }); // back, wrapping around
    expect(around(7, 2, 10)).toEqual({ keep: [7, 8, 6], next: 8 }); // a jump: forward
    expect(around(0, 0, 10)).toEqual({ keep: [0, 1, 9], next: 1 }); // the first event shown
    expect(around(1, 0, 2)).toEqual({ keep: [1, 0], next: 0 });
    expect(around(0, 0, 1)).toEqual({ keep: [0], next: null });
  });
});

describe("a bundle from anyone", () => {
  it("reads a well-formed one", async () => {
    const b = await Bundle.open(blobSource(testBundle({ events: 2 })));
    expect([...(await b.event(1)).relations.R.indices]).toEqual([1, 0]);
  });

  it("refuses relations that would point outside their tables or loop for ever", async () => {
    const bad = [
      { offsets: [0, 1, 2], indices: [1, 2] }, // T has 2 rows
      { offsets: [0, 4e9, 2], indices: [0, 1] }, // a loop over offsets[0]..offsets[1] would run 4e9 times
      { offsets: [0, 1], indices: [0] }, // one offset short
    ];
    for (const r of bad) {
      const b = await Bundle.open(blobSource(testBundle(r)));
      await expect(b.event(0)).rejects.toBeInstanceOf(FormatError);
    }
  });

  it("refuses a record that names a table the header lacks, or arrays outside the record", async () => {
    const broken = [
      (m: Record<string, unknown>) => ({ ...m, tables: { Nope: { n: 1, columns: { x: [0, 1] } } }, relations: {} }),
      (m: Record<string, unknown>) => ({ ...m, tables: { T: { n: 2, columns: { x: [4096, 2] } } }, relations: {} }),
    ];
    for (const record of broken) {
      const b = await Bundle.open(blobSource(testBundle({ record })));
      await expect(b.event(0)).rejects.toBeInstanceOf(FormatError);
    }
  });

  it("reads one written before one source per kind as one written today", async () => {
    // L: T's rows again, from a less preferred source (legacy, `alternative`), with a relation T -> L. O: other
    // objects of T's kind, also marked `alternative` then (as CHS jets were), which the converter keeps today.
    const b = await Bundle.open(
      blobSource(
        testBundle({
          header: (h: any) => ({
            ...h,
            tables: { ...h.tables, L: h.tables.T, O: h.tables.T },
            relations: { ...h.relations, TL: { from: "T", to: "L", weights: [] } },
            display: [
              ...h.display,
              { ...h.display[0], table: "L", source: "legacy", visible: false, alternative: true },
              { ...h.display[0], table: "O", source: "CHS", visible: false, alternative: true },
            ],
          }),
          record: (m: any) => ({
            ...m,
            tables: { ...m.tables, L: m.tables.T, O: m.tables.T },
            relations: { ...m.relations, TL: m.relations.R },
          }),
        }),
      ),
    );
    expect([
      b.header.display.map((d) => d.table),
      Object.keys(b.header.tables),
      Object.keys(b.header.relations),
    ]).toEqual([["T", "O"], ["T", "O"], ["R"]]);
    const ev = await b.event(0);
    expect([Object.keys(ev.tables), Object.keys(ev.relations), [...ev.relations.R.indices]]).toEqual([
      ["T", "O"],
      ["R"],
      [1, 0],
    ]);
  });

  it("refuses an event it does not have", async () => {
    const b = await Bundle.open(blobSource(testBundle()));
    await expect(b.event(1)).rejects.toBeInstanceOf(RangeError);
    await expect(b.event(Number.NaN)).rejects.toBeInstanceOf(RangeError);
  });

  it("reads a run's tables again after a failed read", async () => {
    const blob = testBundle({ events: 2, runTable: true });
    let fail = false,
      runAt = -1;
    const b = await Bundle.open(
      gatedSource(blob, async (offset) => {
        if (fail && offset === runAt) throw new Error("network");
      }),
    );
    runAt = b.runs[0].offset!;
    fail = true;
    await expect(b.event(0)).rejects.toThrow("network");
    fail = false; // the network is back
    expect((await b.event(1)).tables.C.n).toBe(1);
  });
});
