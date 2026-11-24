import { describe, expect, it } from "vitest";
import { graphOf } from "../../../model/truth/graph";
import { DEFAULT_LEVELS, levelGraph } from "../../../model/truth/levelGraph";
import {
  emptyState,
  hiddenChildren,
  LIST,
  pathTo,
  reveal,
  type Place,
  type Row,
  treeRows,
  type TreeState,
} from "./rows";

const csr = (rows: number[][]) => ({
  offsets: Uint32Array.from(rows.reduce((o, r) => [...o, o[o.length - 1] + r.length], [0])),
  indices: Uint32Array.from(rows.flat()),
});
const HARD = 1 << 1,
  B = 1 << 8,
  C = 1 << 9,
  RECO = 1 << 10;
// The small ttbar-like event of levelGraph.test.ts:
//   0 p (beam) -> 1 g -> 2 t -> 3 t (its copy) -> 4 W⁺, 5 b; 4 -> 6 c, 7 s̄
//   5, 7 -> 8 a string (no level) -> 9 B̄⁰ (b hadron), 10 π⁺ (reconstructable); 9 -> 11 D⁺ (c hadron) -> 12 K⁻
//   (reconstructable) -> 13 π⁻, 14 γ (no level)
//   0 -> 15 g (no level) -> 16 π⁻ (underlying event); 17 π⁰ (pile-up)
const NAMES = ["p", "g", "t", "t", "W⁺", "b", "c", "s̄", "str", "B̄⁰", "π⁺", "D⁺", "K⁻", "π⁻", "γ", "g", "π⁻", "π⁰"];
const P = {
  pdgId: [2212, 21, 6, 6, 24, 5, 4, -3, 92, -511, 211, 411, -321, -211, 22, 21, -211, 111],
  status: [4, 21, 22, 62, 22, 23, 23, 23, 71, 2, 1, 2, 1, 0, 0, 41, 1, 2],
  energy: [7000, 500, 400, 400, 200, 150, 120, 70, 220, 100, 50, 60, 30, 5, 3, 300, 10, 4],
  levelFlags: [0, 0, 0, 0, 0, HARD, HARD, HARD, 0, B, RECO, C, RECO, 0, 0, 0, RECO, RECO],
  isSignal: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  prodVertexIdx: [-1, -1, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8, -1, 9, 10],
};
const V = { reason: [17, 18, 2, 2, 19, 19, 2, 2, 11, 19, 0] };
const kids: number[][] = Array.from({ length: P.pdgId.length }, () => []);
Object.assign(kids, { 0: [1, 15], 1: [2], 2: [3], 3: [4, 5], 4: [6, 7], 5: [8], 7: [8], 8: [9, 10], 9: [11] });
Object.assign(kids, { 11: [12], 12: [13, 14], 15: [16] });
const g = graphOf({ n: P.pdgId.length, columns: P }, csr(kids), { n: V.reason.length, columns: V });
const lg = levelGraph(g, "levelFlags", "isSignal", DEFAULT_LEVELS);

/** Each row as text: indented by depth, a vertex as ◆ and its reason, a folded particle with ▸, an open one ▾. */
const text = (rows: Row[]) =>
  rows.map((r) => {
    if (r.kind === "group") return `[${r.group.name}${r.open ? "" : " ▸"}]`;
    const pad = "  ".repeat(r.depth),
      fold = "open" in r && r.open !== undefined ? (r.open ? " ▾" : " ▸") : "";
    if (r.kind === "vertex") return `${pad}◆${V.reason[lg.vertices[r.vertex].row]}`;
    if (r.kind === "more") return `${pad}+${r.left}`;
    return `${pad}${r.kind === "hidden" ? "~" : ""}${NAMES[r.kind === "hidden" ? r.top : lg.particles[r.node].top]}${fold}`;
  });
const rows = (s: TreeState = emptyState(), vertices = true, keep = new Set<number>()) =>
  treeRows(lg, g, s, vertices, keep);

describe("treeRows", () => {
  it("lists the hard process unfolded down to its hadrons, with the vertices between, and the other groups folded", () => {
    expect(text(rows())).toEqual([
      "[hard process]",
      "t ▾",
      "  ◆2",
      "  W⁺ ▾",
      "    ◆2",
      "    c",
      "    s̄",
      "  b ▾",
      "    ◆19",
      "    B̄⁰ ▾",
      "      ◆2",
      "      D⁺ ▾",
      "        ◆2",
      "        K⁻",
      "    π⁺",
      "[underlying event ▸]",
      "[pile-up ▸]",
    ]);
  });
  it("hangs the daughters straight under the particle without vertices, with the lines of the tree", () => {
    const r = rows(emptyState(), false);
    expect(text(r).slice(1, 5)).toEqual(["t ▾", "  W⁺ ▾", "    c", "    s̄"]);
    const place = (name: string) => {
      const x = r.find((x) => x.kind === "particle" && NAMES[lg.particles[x.node].top] === name) as Place;
      return [x.depth, x.rails, x.last];
    };
    expect(place("c")).toEqual([2, [true], false]); // the line of t's daughters goes on to the b
    expect(place("s̄")).toEqual([2, [true], true]);
    expect(place("K⁻")).toEqual([4, [false, true, false], true]); // beside the π⁺ under the b
  });
  it("folds and unfolds particles and groups by hand", () => {
    const s = emptyState();
    s.folds.set(5, false); // the b
    s.groups.underlying = true;
    expect(text(rows(s))).toEqual([
      "[hard process]",
      "t ▾",
      "  ◆2",
      "  W⁺ ▾",
      "    ◆2",
      "    c",
      "    s̄",
      "  b ▸",
      "[underlying event]",
      "π⁻",
      "[pile-up ▸]",
    ]);
  });
  it("lists the particles at no shown level under a node when asked, each folding its own", () => {
    expect(hiddenChildren(g, lg, 12)).toEqual([13, 14]);
    expect(hiddenChildren(g, lg, 5)).toEqual([8]); // the string
    const s = emptyState();
    s.below.add(5);
    const r = text(rows(s));
    expect(r.slice(r.indexOf("    π⁺"), r.indexOf("[underlying event ▸]"))).toEqual(["    π⁺", "    ~str"]);
    expect(hiddenChildren(g, lg, 8)).toEqual([]); // the string's daughters are all shown: nothing to unfold
  });
  it("gives every row its own key", () => {
    const s = reveal(emptyState(), pathTo(g, lg, 13)!);
    s.groups = { underlying: true, pileup: true };
    s.below.add(5);
    const keys = rows(s).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("reveals a particle at no shown level: the way down to it and the list of the node it hides under", () => {
    const path = pathTo(g, lg, 13)!;
    expect(path).toEqual({ group: "hard", tops: [2, 5, 9, 11, 12, 13], hidden: 5 });
    const s = reveal(emptyState(), path);
    expect([...s.below]).toEqual([12]);
    expect([...s.folds.keys()]).toEqual([2, 5, 9, 11]);
    expect(text(rows(s)).slice(13, 16)).toEqual(["        K⁻", "          ~π⁻", "          ~γ"]);
    expect(pathTo(g, lg, 16)).toEqual({ group: "underlying", tops: [16], hidden: 1 });
    expect(reveal(emptyState(), pathTo(g, lg, 16)!).groups).toEqual({ underlying: true });
    expect(pathTo(g, lg, 15)).toBeNull(); // no shown particle above it
  });
  it("climbs to a hidden particle through a parent with a shown particle above it, not a dead end", () => {
    // 0 p (beam) -> 1 a remnant string (no level, 5 TeV); 1 and 2 b (leg) -> 3 B̄*⁰ (no level) -> 4 B̄⁰ (b hadron)
    const d = graphOf(
      {
        n: 5,
        columns: {
          pdgId: [2212, 92, 5, -513, -511],
          status: [4, 71, 23, 2, 2],
          energy: [7000, 5000, 150, 100, 99],
          levelFlags: [0, 0, HARD, 0, B],
          isSignal: [1, 1, 1, 1, 1],
        },
      },
      csr([[1], [3], [3], [4], []]),
    );
    const dlg = levelGraph(d, "levelFlags", "isSignal", DEFAULT_LEVELS);
    expect(pathTo(d, dlg, 3)).toEqual({ group: "hard", tops: [2, 3], hidden: 1 });
    // the B̄*⁰ listed under the b, beside the B̄⁰ (by pdgId, indented by depth)
    const r = treeRows(dlg, d, reveal(emptyState(), pathTo(d, dlg, 3)!), false, new Set());
    const pdg = (x: Row) =>
      x.kind === "group"
        ? ""
        : "  ".repeat(x.depth) +
          (x.kind === "hidden"
            ? `~${d.col("pdgId", x.top)}`
            : x.kind === "particle"
              ? d.col("pdgId", dlg.particles[x.node].top)
              : x.kind);
    expect(r.map(pdg)).toEqual(["", "5", "  -511", "  ~-513"]);
  });
});

describe("treeRows of a large group", () => {
  const n = 2 * LIST + 20;
  const big = graphOf(
    {
      n,
      columns: {
        pdgId: Array(n).fill(211),
        status: Array(n).fill(1),
        energy: Array.from({ length: n }, (_, i) => n - i), // largest first
        levelFlags: Array(n).fill(RECO),
        isSignal: Array(n).fill(0),
      },
    },
    csr(Array.from({ length: n }, () => [])),
  );
  const blg = levelGraph(big, "levelFlags", "isSignal", DEFAULT_LEVELS);
  const open: TreeState = { ...emptyState(), groups: { pileup: true } };
  const listed = (s: TreeState, keep = new Set<number>()) => {
    const r = treeRows(blg, big, s, true, keep);
    return [
      r.filter((x) => x.kind === "particle").length,
      r.at(-1)!.kind === "more" ? (r.at(-1) as { left: number }).left : 0,
    ];
  };
  it("lists the first ones, the rest on asking", () => {
    expect(treeRows(blg, big, emptyState(), true, new Set()).length).toBe(1); // folded: its heading only
    expect(listed(open)).toEqual([LIST, n - LIST]);
    expect(listed({ ...open, more: new Map([["gpileup", 2 * LIST]]) })).toEqual([2 * LIST, n - 2 * LIST]);
  });
  it("lists a kept one wherever it is", () => {
    expect(listed(open, new Set([n - 1]))).toEqual([LIST + 1, n - LIST - 1]);
  });
});
