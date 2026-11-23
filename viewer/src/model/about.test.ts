import { describe, expect, it } from "vitest";
import type { Bundle } from "../io/bundle";
import { eventTitle, isSimulation, provenance, summary } from "./about";

const NOW = new Date("2026-11-13T12:00:00Z");
const bundle = (source: object) =>
  ({
    header: { profile: "cms", source: { files: ["step3_nano.root"], ...source } },
    events: new Array(50),
  }) as unknown as Bundle;
const names = (rows: [string, string][]) => rows.map(([k]) => k);

describe("what is known about the data set open", () => {
  it("says who published a person's file and when it expires, and when it was published only if the index says", () => {
    const o = {
      file: "data/u/alice/x.ember",
      title: "X",
      local: false,
      external: false,
      entry: {
        file: "data/u/alice/x.ember",
        title: "X",
        created: "2026-11-01T10:00:00Z",
        expires: "2026-12-03T12:00:00Z",
      },
    };
    const b = bundle({ created: "2026-11-01T10:00:00Z", converter: "embertools 0.3.0", cmssw: "CMSSW_20_1_0_pre6" });
    expect(summary(o, b, NOW)).toBe("50 events · published by alice · expires in 20 days");
    expect(names(provenance(o, b, NOW))).toEqual([
      "Events",
      "Published by",
      "Expires",
      "Converted",
      "Converter",
      "CMSSW",
      "Profile",
      "From",
      "File",
    ]);
    expect(names(provenance({ ...o, entry: { ...o.entry, published: "2026-11-03T12:00:00Z" } }, b, NOW))).toContain(
      "Published",
    );
    expect(Object.fromEntries(provenance(o, b, NOW)).Expires).toMatch(/\(in 20 days\)$/);
  });

  it("leaves out what a bundle or an index does not say, and says nothing of a publisher for other files", () => {
    const b = bundle({});
    expect(names(provenance({ file: "data/sim/x.ember", title: "X", local: false, external: false }, b, NOW))).toEqual([
      "Events",
      "Profile",
      "From",
      "File",
    ]);
    const local = { file: "data/u/alice/x.ember", title: "x.ember", local: true, external: false };
    expect(summary(local, b, NOW)).toBe("50 events · a local file");
    expect(Object.fromEntries(provenance(local, b, NOW)).File).toBe("data/u/alice/x.ember (on this computer)");
    expect(names(provenance(local, b, NOW))).not.toContain("Published by"); // whatever its name looks like
    const external = {
      file: "https://elsewhere.example/data/u/alice/x.ember",
      title: "x · elsewhere.example",
      local: false,
      external: true,
    };
    expect(summary(external, b, NOW)).toBe("50 events · not on this site: read from elsewhere.example");
    expect(names(provenance(external, b, NOW))).toEqual(["Events", "Profile", "From", "Address"]);
    expect(provenance(null, b)).toEqual([]);
  });
});

describe("the event's title", () => {
  it("names a simulated event's sample, and data by their run alone", () => {
    const id = { run: 1, lumi: 1, event: 18 };
    expect(eventTitle(true, "ttbar 0PU · Phase 2 · 10 events", id)).toBe(
      "SIMULATION · ttbar 0PU · Run 1 · LS 1 · Event 18",
    );
    expect(eventTitle(false, "Run 3 JetMET data", { run: 392294, lumi: 21, event: 11805516 })).toBe(
      "DATA · Run 392294 · LS 21 · Event 11805516",
    );
  });
  it("calls an event simulated when the bundle has truth or its run is 1", () => {
    const reco = { display: [{ table: "Jet" }] } as never,
      truth = { display: [{ table: "Jet" }, { table: "TruthParticles", truth: true }] } as never;
    expect(isSimulation(truth, 392294)).toBe(true);
    expect(isSimulation(reco, 1)).toBe(true);
    expect(isSimulation(reco, 392294)).toBe(false);
  });
});
