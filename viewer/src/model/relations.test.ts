import { describe, expect, it } from "vitest";
import type { DisplayLayer, EventData, Header } from "../io/bundle";
import { bestPartners, contentPartners, identities, levelsOf, related, relatedParts } from "./relations";

// candidate 0 -> trackster 1 -> clusters 0, 2 -> hits; candidate 0 -> track 1; trackster 0 -> cluster 1 (no candidate)
const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()), weights: {},
});
const ev = {
  id: [1, 1, 1], tables: {},
  relations: {
    candT: csr([[1]]), candTrack: csr([[1]]), tLCs: csr([[1], [0, 2]]), lcHits: csr([[0, 1], [2], [3]]),
  },
} as unknown as EventData;
const header = {
  relations: {
    candT: { from: "Cand", to: "T", weights: [] }, candTrack: { from: "Cand", to: "Track", weights: [] },
    tLCs: { from: "T", to: "LC", weights: [] }, lcHits: { from: "LC", to: "Hit", weights: [] },
    missing: { from: "Hit", to: "Other", weights: [] }, // in the header, not in this event
  },
} as unknown as Header;
const rows = (r: Map<string, Set<number>>) => Object.fromEntries([...r].map(([t, s]) => [t, [...s].sort()]));

describe("related", () => {
  it("follows a selection down to its hits", () => {
    expect(rows(related(ev, header, { table: "Cand", row: 0 }))).toEqual({ Cand: [0], T: [1], Track: [1], LC: [0, 2], Hit: [0, 1, 3] });
  });
  it("follows a hit up to every object that contains it, without its siblings", () => {
    expect(rows(related(ev, header, { table: "Hit", row: 3 }))).toEqual({ Hit: [3], LC: [2], T: [1], Cand: [0] });
  });
  it("crosses an association once: a trackster reaches its truth particle, not that particle's hits", () => {
    const tev = { ...ev, relations: { ...ev.relations, tTruth: csr([[], [0]]), truthHits: csr([[2, 3]]), truthKids: csr([[1], []]) } } as unknown as EventData;
    const th = { relations: { ...header.relations,
      tTruth: { from: "T", to: "P", weights: [], association: true }, truthHits: { from: "P", to: "Hit", weights: [], association: true },
      truthKids: { from: "P", to: "P", weights: [] } } } as unknown as Header;
    expect(rows(related(tev, th, { table: "T", row: 1 }))).toEqual({ T: [1], LC: [0, 2], Hit: [0, 1, 3], Cand: [0], P: [0] });
    // a particle: its descendants, its hits, the reco objects matched to it, but not their contents
    expect(rows(related(tev, th, { table: "P", row: 0 }))).toEqual({ P: [0, 1], Hit: [2, 3], T: [1] });
  });
  it("splits relatives into made of, part of and linked", () => {
    const tev = { ...ev, relations: { ...ev.relations, tTruth: csr([[], [0]]) } } as unknown as EventData;
    const th = { relations: { ...header.relations, tTruth: { from: "T", to: "P", weights: [], association: true } } } as unknown as Header;
    const p = relatedParts(tev, th, { table: "T", row: 1 });
    expect(rows(p.madeOf)).toEqual({ T: [1], LC: [0, 2], Hit: [0, 1, 3] });
    expect(rows(p.partOf)).toEqual({ Cand: [0] }); // shown in the inspector, not highlighted
    expect(rows(p.linked)).toEqual({ P: [0] });
  });
  it("counts as a level every object made only of the selection's parts", () => {
    // trackster 1 is made of clusters 0 and 2; a "link" object made of cluster 2 only is inside it; one made of 1 and 2 is not
    const lev = { ...ev, relations: { ...ev.relations, linkLCs: csr([[2], [1, 2]]) } } as unknown as EventData;
    const lh = { relations: { ...header.relations, linkLCs: { from: "Link", to: "LC", weights: [] } } } as unknown as Header;
    expect(rows(levelsOf(lev, lh, { table: "T", row: 1 }))).toEqual({ T: [1], LC: [0, 2], Hit: [0, 1, 3], Link: [0] });
  });
  it("follows a pointer back to a container once, not into the container's other parts", () => {
    // vertex 0 -> tracks 0, 1 (with hits 0 and 1); each track -> its vertex
    const vev = { id: [1, 1, 1], tables: {}, relations: { vtxTracks: csr([[0, 1]]), trackVtx: csr([[0], [0]]), trackHits: csr([[0], [1]]) } } as unknown as EventData;
    const vh = { relations: { vtxTracks: { from: "Vtx", to: "Trk", weights: [] }, trackVtx: { from: "Trk", to: "Vtx", weights: [] },
      trackHits: { from: "Trk", to: "Hit", weights: [] } } } as unknown as Header;
    const track = relatedParts(vev, vh, { table: "Trk", row: 1 });
    expect(rows(track.madeOf)).toEqual({ Trk: [1], Hit: [1] });
    expect(rows(track.partOf)).toEqual({ Vtx: [0] });
    expect(rows(track.linked)).toEqual({ Vtx: [0] }); // highlighted with it
    expect(rows(levelsOf(vev, vh, { table: "Trk", row: 1 }))).toEqual({ Trk: [1], Hit: [1], Vtx: [0] });
    expect(rows(relatedParts(vev, vh, { table: "Vtx", row: 0 }).madeOf)).toEqual({ Vtx: [0], Trk: [0, 1], Hit: [0, 1] });
  });
  it("counts an object as inside only if all its relations point inside (a candidate holding a vertex's track and clusters)", () => {
    const vev = { id: [1, 1, 1], tables: {}, relations: { vtxTracks: csr([[0, 1]]), trackVtx: csr([[0], [0]]), candTrack: csr([[1], [0]]),
      candLCs: csr([[], [0]]) } } as unknown as EventData;
    const vh = { relations: { vtxTracks: { from: "Vtx", to: "Trk", weights: [] }, trackVtx: { from: "Trk", to: "Vtx", weights: [] },
      candTrack: { from: "Cand", to: "Trk", weights: [] }, candLCs: { from: "Cand", to: "LC", weights: [] } } } as unknown as Header;
    expect(rows(levelsOf(vev, vh, { table: "Vtx", row: 0 }))).toEqual({ Vtx: [0], Trk: [0, 1], Cand: [0] }); // not candidate 1
    // A reconstruction stage (the candidates) is built on top of the objects without one: never inside a vertex.
    const staged = { ...vh, display: [{ table: "Cand", stage: 3 }] } as unknown as Header;
    expect(rows(levelsOf(vev, staged, { table: "Vtx", row: 0 }))).toEqual({ Vtx: [0], Trk: [0, 1] });
  });
  it("takes the pointer back up from the inverseOf hint, whatever the link counts", () => {
    // One vertex with one track: the counts cannot tell which way is up.
    const vev = { id: [1, 1, 1], tables: {}, relations: { vtxTracks: csr([[0]]), trackVtx: csr([[0]]), trackHits: csr([[0]]) } } as unknown as EventData;
    const vh = { relations: { vtxTracks: { from: "Vtx", to: "Trk", weights: [] }, trackVtx: { from: "Trk", to: "Vtx", weights: [], inverseOf: "vtxTracks" },
      trackHits: { from: "Trk", to: "Hit", weights: [] } } } as unknown as Header;
    expect(rows(relatedParts(vev, vh, { table: "Trk", row: 0 }).madeOf)).toEqual({ Trk: [0], Hit: [0] });
    expect(rows(relatedParts(vev, vh, { table: "Vtx", row: 0 }).madeOf)).toEqual({ Vtx: [0], Trk: [0], Hit: [0] });
    // Without the hint, both are plain: the track reaches its vertex as a part.
    const plain = { relations: { ...vh.relations, trackVtx: { from: "Trk", to: "Vtx", weights: [] } } } as unknown as Header;
    expect(rows(relatedParts({ ...vev } as EventData, plain, { table: "Trk", row: 0 }).madeOf)).toEqual({ Trk: [0], Hit: [0], Vtx: [0] });
  });
  it("finds what a track belongs to", () => {
    expect(rows(related(ev, header, { table: "Track", row: 1 }))).toEqual({ Track: [1], Cand: [0] });
  });
});

describe("best partners", () => {
  // particle 0 -> hits 0 (0.2), 1 (0.9); particle 1 -> hit 1 (0.5); hit 2 has none
  const rel = { ...csr([[0, 1], [1]]), weights: { e: Float32Array.from([0.2, 0.9, 0.5]) } };
  const info = (order?: "min" | "max") => ({ from: "P", to: "Hit", weights: ["e"], ...(order ? { best: { weight: "e", order } } : {}) });
  it("picks each object's partner by the best weight, else the first", () => {
    expect([...bestPartners(rel, info("max"), false, 3).partner]).toEqual([0, 0, -1]);
    expect([...bestPartners(rel, info("min"), false, 3).partner]).toEqual([0, 1, -1]);
    expect([...bestPartners(rel, info(), false, 3).partner]).toEqual([0, 0, -1]);
    const fwd = bestPartners(rel, info("max"), true, 2);
    expect([...fwd.partner]).toEqual([1, 1]);
    expect([...fwd.entry]).toEqual([1, 2]);
  });
});

describe("truth identities", () => {
  // particles: 0 π⁺ (100 GeV) -> children 1, 2 (inside the tracker); 1 owns hits 0, 1; 2 owns hit 2; 3 γ (30 GeV) owns
  // hit 3; 4 a quark (500 GeV) linked to nothing; 5 (5 GeV) owns no hits but a trackster is matched to it
  const tev = {
    id: [1, 1, 1], tables: { P: { n: 6, columns: { energy: Float32Array.from([100, 40, 20, 30, 500, 5]) } }, Hit: { n: 4, columns: {} } },
    relations: { kids: csr([[1, 2], [], [], [], [], []]), pHits: { ...csr([[], [0, 1], [2], [3], [], []]), weights: { simE: Float32Array.from([1, 2, 3, 4]) } },
      tTruth: csr([[0], [5]]) },
  } as unknown as EventData;
  const th = { relations: {
    kids: { from: "P", to: "P", weights: [] }, pHits: { from: "P", to: "Hit", weights: ["simE"], association: true, best: { weight: "simE", order: "max" } },
    tTruth: { from: "T", to: "P", weights: [], association: true } },
    display: [{ table: "Hit", repr: "cells" }, { table: "P", repr: "segments", truth: true, colour: "energy" }] } as unknown as Header;
  const d = th.display[1] as DisplayLayer;
  it("gives a particle the key of its highest ancestor that left hits or is matched", () => {
    const { key, top, others } = identities(d, tev.tables.P, tev, th, 2);
    expect([...key]).toEqual([0, 0, 0, 3, 4, 5]); // daughters of the matched π⁺ share its key
    expect(top).toEqual([0, 3]); // largest first; the quark is linked to nothing and takes no colour
    expect(others).toBe(1); // particle 5
    expect([...identities(d, tev.tables.P, tev, th, 2).used]).toEqual([1, 0, 0, 1, 0, 1]); // keys in use: not the quark
  });
  it("keeps every reconstructed object its own key", () => {
    const { key, top } = identities({ ...d, truth: false }, tev.tables.P, tev, th, 10);
    expect([...key]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(top).toEqual([4, 0, 1, 3, 2, 5]);
  });
});

describe("content partners", () => {
  it("picks the object with the most weight in an object's parts, times its share of each part", () => {
    // clusters: 0 -> hits 0 (fraction 1), 1 (0.5); 1 -> hit 2; 2 -> nothing. Particles: 0 -> hit 0 (1), hit 1 (4); 1 -> hit 1 (3)
    const cev = {
      id: [1, 1, 1], tables: { P: { n: 2, columns: {} }, LC: { n: 3, columns: {} }, Hit: { n: 3, columns: {} } },
      relations: { lcHits: { ...csr([[0, 1], [2], []]), weights: { fraction: Float32Array.from([1, 0.5, 1]) } },
        pHits: { ...csr([[0, 1], [1]]), weights: { simE: Float32Array.from([1, 4, 3]) } } },
    } as unknown as EventData;
    const ch = { relations: { lcHits: { from: "LC", to: "Hit", weights: ["fraction"] },
      pHits: { from: "P", to: "Hit", weights: ["simE"], association: true, best: { weight: "simE", order: "max" } } } } as unknown as Header;
    const { partner, weight } = contentPartners("LC", "P", 3, cev, ch);
    expect([...partner]).toEqual([0, -1, -1]); // particle 0: 1 + 0.5 * 4 = 3 > particle 1: 0.5 * 3; hit 2 has no particle
    expect(weight).toBe("simE");
  });
  it("votes through containment: a trackster takes the candidate holding most of its layer clusters", () => {
    // trackster 0 -> clusters 0, 1, 2; candidate 0 holds cluster 0, candidate 1 holds clusters 1 and 2
    const vev = { id: [1, 1, 1], tables: { T: { n: 1, columns: {} }, LC: { n: 3, columns: {} }, Cand: { n: 2, columns: {} } },
      relations: { tLCs: csr([[0, 1, 2]]), candLCs: csr([[0], [1, 2]]) } } as unknown as EventData;
    const vh = { relations: { tLCs: { from: "T", to: "LC", weights: [] }, candLCs: { from: "Cand", to: "LC", weights: [] } } } as unknown as Header;
    const c = contentPartners("T", "Cand", 1, vev, vh);
    expect([...c.partner]).toEqual([1]);
    expect(c.derived).toBe(false);
  });
});
