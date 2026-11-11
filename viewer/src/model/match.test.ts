import { describe, expect, it } from "vitest";
import type { EventData, Header } from "../io/bundle";
import { bestPurities, completeness, quality } from "./match";

const csr = (rows: number[][], weights: Record<string, number[]> = {}) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()), weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Float32Array.from(v)])),
});
// Tracks 0 (20 hits: 18 from particle 0, 2 from 1) and 1 (no match); a trackster of 10 GeV, 4 GeV of it from particle 1.
const ev = {
  id: [1, 1, 1],
  tables: { Track: { n: 2, columns: { nPix: Uint8Array.from([5, 4]), nOT: Uint8Array.from([15, 8]) } },
    Trackster: { n: 1, columns: { rawEnergy: Float32Array.from([10]) } }, P: { n: 2, columns: {} } },
  relations: {
    trackTruth: csr([[0, 1], []], { sharedEnergy: [18, 2], score: [0.1, 0.9] }),
    truthTracks: csr([[0], [0]], { sharedFraction: [18, 2], score: [0.4, 0.95] }),
    tsTruth: csr([[1]], { sharedEnergy: [4], score: [0.5] }), truthTs: csr([[], [0]], { sharedFraction: [0.8], score: [0.3] }),
  },
} as unknown as EventData;
const best = { weight: "score", order: "min" } as const;
const header = { relations: {
  trackTruth: { from: "Track", to: "P", weights: ["sharedEnergy", "score"], association: true, best,
    match: { measure: "hits", in: "tracker", target: "trackerHits", shared: "sharedEnergy", over: ["nPix + nOT"], good: 0.75 } },
  truthTracks: { from: "P", to: "Track", weights: ["sharedFraction", "score"], association: true,
    match: { measure: "hits", in: "tracker", completeness: { weight: "score", complement: true } } },
  tsTruth: { from: "Trackster", to: "P", weights: ["sharedEnergy", "score"], association: true, best,
    match: { measure: "energy", in: "HGCal", shared: "sharedEnergy", over: ["raw_energy", "rawEnergy"], good: 0.5 } },
  truthTs: { from: "P", to: "Trackster", weights: ["sharedFraction", "score"], association: true,
    match: { measure: "energy", in: "HGCal", completeness: { weight: "sharedFraction" } } },
} } as unknown as Header;

describe("match quality", () => {
  it("gives purity as shared over the object's own amount, from the first expression that can be computed", () => {
    expect(quality(ev, header, "trackTruth", 0, 0)).toMatchObject({ shared: 18, over: 20, purity: 0.9, score: expect.closeTo(0.1), clean: true });
    expect(quality(ev, header, "tsTruth", 0, 0)).toMatchObject({ shared: 4, over: 10, purity: 0.4, clean: false });
  });
  it("gives the purity of each object's best match, NaN without one", () => {
    const p = bestPurities(ev, header, "trackTruth")!;
    expect(p[0]).toBeCloseTo(0.9);
    expect(Number.isNaN(p[1])).toBe(true);
  });
  it("gives completeness from the truth -> reco weight, or its complement", () => {
    expect(completeness(ev, header, "P", 0, "Track", 0)?.value).toBeCloseTo(0.6);
    expect(completeness(ev, header, "P", 1, "Trackster", 0)?.value).toBeCloseTo(0.8);
    expect(completeness(ev, header, "P", 0, "Trackster", 0)).toBeUndefined();
  });
});
