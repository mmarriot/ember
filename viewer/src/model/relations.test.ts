import { describe, expect, it } from "vitest";
import type { EventData, Header } from "../io/bundle";
import { levelsOf, related, relatedParts } from "./relations";

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
  it("finds what a track belongs to", () => {
    expect(rows(related(ev, header, { table: "Track", row: 1 }))).toEqual({ Track: [1], Cand: [0] });
  });
});
