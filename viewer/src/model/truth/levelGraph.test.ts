import { describe, expect, it } from "vitest";
import { drawnRows, graphOf } from "./graph";
import { DEFAULT_LEVELS, GRAPH_LEVELS, levelGraph } from "./levelGraph";

const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
});
const HARD = 1 << 1,
  GEN = 1 << 2,
  SIGNAL = 1 << 4,
  B = 1 << 8,
  C = 1 << 9,
  RECO = 1 << 10,
  RG = RECO | GEN; // reconstructable, and stable at generator level
// A small ttbar-like event with two pile-up collisions. Vertices: 0 the hard scatter, 1 a shower step, 2 the t decay,
// 3 the W decay, 4 and 5 the hadronisation of a string between the b and the s̄, 6 the B̄⁰ decay, 7 the D⁺ decay, 8 the
// K⁻'s hadronic interaction, 9 a string of the underlying event, 10 and 11 the pile-up collisions.
// Particles:
//   0 p (beam) -> 1 g (incoming) -> 2 t -> 3 t (its copy) -> 4 W⁺, 5 b (leg); 4 -> 6 c, 7 s̄ (legs)
//   5, 7 -> 8 a string (two parents) -> 9 B̄⁰ (b hadron), 10 π⁺ (reconstructable); 9 -> 11 D⁺ (c hadron) -> 12 K⁻
//   (reconstructable) -> 13 π⁻, 14 γ (Geant4, no level)
//   0 -> 15 g (initial-state radiation) -> 16 π⁻ (reconstructable, underlying event)
//   17 π⁰ (reconstructable, pile-up collision 1); 18 π⁺, 19 γ (reconstructable, pile-up collision 2)
const P = {
  pdgId: [2212, 21, 6, 6, 24, 5, 4, -3, 92, -511, 211, 411, -321, -211, 22, 21, -211, 111, 211, 22],
  status: [4, 21, 22, 62, 22, 23, 23, 23, 71, 2, 1, 2, 1, 0, 0, 41, 1, 2, 1, 1],
  energy: [7000, 500, 400, 400, 200, 150, 120, 70, 220, 100, 50, 60, 30, 5, 3, 300, 10, 4, 3, 2.5],
  pt: [0, 0, 100, 100, 80, 60, 40, 30, 50, 40, 20, 25, 15, 2, 1, 30, 5, 4, 3, 2],
  levelFlags: [0, 0, 0, 0, 0, HARD, HARD, HARD, 0, B, RG, C, RG, 0, 0, 0, RG, RG, RG, RG],
  isSignal: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  eventIndex: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2],
  prodVertexIdx: [-1, -1, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8, -1, 9, 10, 11, 11],
  decayVertexIdx: [-1, 0, 1, 2, 3, 4, -1, 4, 5, 6, -1, 7, 8, -1, -1, 9, -1, -1, -1, -1],
};
const V = { reason: [17, 18, 2, 2, 19, 19, 2, 2, 11, 19, 0, 0] };
const kids: number[][] = Array.from({ length: P.pdgId.length }, () => []);
Object.assign(kids, {
  0: [1, 15],
  1: [2],
  2: [3],
  3: [4, 5],
  4: [6, 7],
  5: [8],
  7: [8],
  8: [9, 10],
  9: [11],
  11: [12],
  12: [13, 14],
  15: [16],
});
const g = graphOf({ n: P.pdgId.length, columns: P }, csr(kids), { n: V.reason.length, columns: V });
const build = (mask = DEFAULT_LEVELS) => levelGraph(g, "levelFlags", "isSignal", mask);
/** The particle node of row `r`, and the rows of nodes `ids` (their first copies). */
const node = (lg: ReturnType<typeof build>, r: number) => lg.particles[lg.nodeOf[r]];
const rows = (lg: ReturnType<typeof build>, ids: number[]) => ids.map((i) => lg.particles[i].top);
const level = (id: string) => GRAPH_LEVELS.findIndex((l) => l.id === id);

describe("levelGraph", () => {
  it("folds generator copies into one node", () => {
    const lg = build(),
      t = node(lg, 3);
    expect(lg.nodeOf[2]).toBe(lg.nodeOf[3]);
    expect([t.top, t.last, t.copies]).toEqual([2, 3, 2]);
  });
  it("puts the hard process on top: the legs under the particles they came from, the W beside the b", () => {
    const lg = build();
    expect(rows(lg, lg.signal!.hard)).toEqual([2]); // t: the parent of the b leg; the incoming gluon is not shown
    expect(rows(lg, node(lg, 2).children)).toEqual([4, 5]); // t -> W⁺ b, largest first
    expect(rows(lg, node(lg, 4).children)).toEqual([6, 7]); // W⁺ -> c s̄
    expect([node(lg, 2).level, node(lg, 4).level, node(lg, 5).level]).toEqual(Array(3).fill(level("hard")));
    expect(lg.counts[level("hard")]).toBe(5); // t, W⁺, b, c, s̄
  });
  it("keeps every parent of a particle made from several, the one of highest energy first", () => {
    const lg = build();
    expect(rows(lg, node(lg, 9).parents)).toEqual([5, 7]); // B̄⁰ from the string between the b and the s̄
    expect(rows(lg, node(lg, 5).children)).toEqual([9, 10]);
    expect(rows(lg, node(lg, 7).children)).toEqual([9, 10]);
  });
  it("skips particles at no shown level, to the nearest shown ancestor", () => {
    expect(rows(build(), node(build(), 12).parents)).toEqual([11]); // K⁻ under the D⁺
    const lg = build(DEFAULT_LEVELS & ~(B | C)); // b and c hadrons hidden
    expect(lg.nodeOf[9]).toBe(-1);
    expect(rows(lg, node(lg, 12).parents)).toEqual([5, 7]); // K⁻ under the b, also from the s̄
    expect(lg.hiddenUnder[11]).toBe(lg.nodeOf[5]);
    // with the hard process hidden, what came from it still hangs from the hard scatter
    const below = build(DEFAULT_LEVELS & ~HARD);
    expect([rows(below, below.signal!.hard), rows(below, below.signal!.rest)]).toEqual([[9, 10], [16]]);
  });
  it("puts the vertex each particle was made at between, with its reason, and marks skipped particles", () => {
    const lg = build(),
      decay = lg.vertices[node(lg, 4).made];
    expect([decay.row, decay.reason, decay.skips]).toEqual([2, 2, false]);
    expect(rows(lg, decay.into)).toEqual([2]);
    expect(rows(lg, decay.out)).toEqual([4, 5]);
    expect(node(lg, 5).made).toBe(node(lg, 4).made);
    const string = lg.vertices[node(lg, 9).made];
    expect([string.row, string.reason, string.skips]).toEqual([5, 19, true]);
    expect(rows(lg, string.into)).toEqual([5, 7]);
    expect(node(lg, 5).ends).toEqual([node(lg, 9).made]);
    const top = lg.vertices[node(lg, 2).made];
    expect([top.reason, top.into, top.skips]).toEqual([17, [], false]); // the hard scatter, above the t
  });
  it("counts the hidden particles below each node that no shown particle covers", () => {
    const lg = build();
    expect(node(lg, 12).below).toBe(2); // the K⁻'s interaction products
    expect([node(lg, 5).below, node(lg, 7).below]).toEqual([1, 1]); // the string, below both
    expect(node(lg, 2).below).toBe(0);
    expect(lg.hiddenUnder[13]).toBe(lg.nodeOf[12]);
    expect([lg.hiddenUnder[0], lg.hiddenUnder[12]]).toEqual([-1, -1]);
  });
  it("hangs the signal collision from its hard scatter, with its beams, the hard process and the underlying event", () => {
    const lg = build(),
      s = lg.signal!;
    expect([s.id, s.signal, s.vertex, s.beams]).toEqual([0, true, 0, [0]]); // vertex 0: the hard scatter; row 0: p
    expect([rows(lg, s.hard), rows(lg, s.rest), s.pt]).toEqual([[2], [16], 105]);
    expect([node(lg, 12).collision, node(lg, 16).collision]).toEqual([s, s]);
  });
  it("puts pile-up in its collisions, the largest summed pT first, each at the vertex its particles came out of", () => {
    const lg = build();
    // collision 2 (π⁺ 3 + γ 2 GeV) before collision 1 (π⁰ 4 GeV), though its largest particle is smaller
    expect(lg.pileup.map((c) => [c.id, c.signal, c.vertex, c.beams, rows(lg, c.hard), rows(lg, c.rest), c.pt])).toEqual(
      [
        [2, false, 11, [], [], [18, 19], 5],
        [1, false, 10, [], [], [17], 4],
      ],
    );
    expect([node(lg, 19).collision, node(lg, 17).collision]).toEqual(lg.pileup);
    expect(build(B).pileup).toEqual([]); // a collision with no particle shown is not listed
  });
  it("puts a particle gun's particles straight under its collision, where the gun shot them", () => {
    const gun = graphOf(
      {
        n: 2,
        columns: {
          pdgId: [211, -211],
          status: [1, 1],
          energy: [20, 50],
          levelFlags: [RECO, RECO],
          isSignal: [1, 1],
          prodVertexIdx: [0, 0],
        },
      },
      csr([[], []]),
      { n: 1, columns: { reason: [0] } },
    );
    const lg = levelGraph(gun, "levelFlags", "isSignal", DEFAULT_LEVELS),
      s = lg.signal!;
    expect([s.id, s.vertex, s.beams, s.hard, rows(lg, s.rest), lg.pileup]).toEqual([-1, 0, [], [], [1, 0], []]);
  });
  it("hangs a truth preset's signal process from the hard scatter too, not in a group of its own", () => {
    // 0 p (beam) -> 1 Z (signal process) -> 2 μ⁻; 0 -> 3 π⁺ (underlying event)
    const preset = graphOf(
      {
        n: 4,
        columns: {
          pdgId: [2212, 23, 13, 211],
          status: [4, 62, 1, 1],
          energy: [7000, 95, 40, 5],
          levelFlags: [0, SIGNAL, RECO, RECO],
          isSignal: [1, 1, 1, 1],
        },
      },
      csr([[1, 3], [2], [], []]),
    );
    const lg = levelGraph(preset, "levelFlags", "isSignal", DEFAULT_LEVELS),
      s = lg.signal!;
    expect([rows(lg, s.hard), rows(lg, s.rest), node(lg, 1).level]).toEqual([[1], [3], level("signal")]);
    expect(Object.keys(lg).sort()).toEqual([
      "counts",
      "hiddenUnder",
      "nodeOf",
      "particles",
      "pileup",
      "signal",
      "vertices",
    ]);
  });
  it("colours a particle by its first shown level", () => {
    expect(node(build(), 10).level).toBe(level("reco"));
    expect(node(build(GEN), 10).level).toBe(level("gen"));
    expect(build(GEN).nodeOf[9]).toBe(-1);
  });
  it("survives a loop of parents (bad data): every parent a node, none its own", () => {
    // 1 and 2 each the parent of the other, 0 a child of 2; all reconstructable
    const loop = graphOf(
      {
        n: 3,
        columns: { pdgId: [211, 321, 2212], status: [1, 1, 1], energy: [3, 2, 1], levelFlags: [RECO, RECO, RECO] },
      },
      csr([[], [2], [1, 0]]),
    );
    const lg = levelGraph(loop, "levelFlags", undefined, DEFAULT_LEVELS);
    expect(lg.particles.length).toBe(3);
    lg.particles.forEach((p, i) => {
      expect(p.parents.every((a) => a >= 0 && a < 3 && a !== i)).toBe(true);
      expect(p.children.every((c) => c >= 0 && c < 3)).toBe(true);
    });
    expect(rows(lg, node(lg, 0).parents)).toEqual([2]);
  });
  it("puts no vertex above a particle made at none, or at one outside the vertex table", () => {
    const columns = { pdgId: [211, 321, 2212], status: [1, 1, 1], energy: [3, 2, 1], levelFlags: [RECO, RECO, RECO] };
    const lone = graphOf({ n: 3, columns: { ...columns, prodVertexIdx: [0, -1, 7] } }, csr([[], [], []]), {
      n: 1,
      columns: { reason: [0] },
    });
    const lg = levelGraph(lone, "levelFlags", undefined, DEFAULT_LEVELS);
    expect([0, 1, 2].map((r) => node(lg, r).made)).toEqual([0, -1, -1]);
    expect(lg.vertices.map((v) => v.row)).toEqual([0]);
  });
  it("marks a vertex as skipping only for hidden particles between, not a parent from elsewhere", () => {
    // 1 b (leg) and 0 a beam remnant (no shown ancestor) -> 2 π⁺ at vertex 0; 1 -> 3 a string -> 4 π⁻ at vertex 1
    const mixed = graphOf(
      {
        n: 5,
        columns: {
          pdgId: [2101, 5, 211, 92, -211],
          status: [63, 23, 1, 71, 1],
          energy: [50, 100, 30, 60, 20],
          levelFlags: [0, HARD, RECO, 0, RECO],
          prodVertexIdx: [-1, -1, 0, -1, 1],
        },
      },
      csr([[2], [2, 3], [], [4], []]),
      { n: 2, columns: { reason: [19, 19] } },
    );
    const lg = levelGraph(mixed, "levelFlags", undefined, DEFAULT_LEVELS);
    expect(lg.vertices.map((v) => [v.row, rows(lg, v.into), v.skips])).toEqual([
      [0, [1], false],
      [1, [1], true],
    ]);
  });
});

describe("drawnRows", () => {
  it("draws a picked particle with its copies, where it was made and where it ended", () => {
    const t = drawnRows(g, [3], false);
    expect([[...t.particles].sort((a, b) => a - b), [...t.vertices].sort()]).toEqual([
      [2, 3],
      [0, 2],
    ]);
  });
  it("adds everything below it with descendants, for every pick", () => {
    const d = drawnRows(g, [9, 17], true);
    expect([...d.particles].sort((a, b) => a - b)).toEqual([9, 11, 12, 13, 14, 17]);
    expect([...d.vertices].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 10]);
    expect([...drawnRows(g, [9], false).particles]).toEqual([9]);
  });
});
