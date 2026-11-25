import { describe, expect, it } from "vitest";
import { graphOf } from "../../../model/truth/graph";
import { DEFAULT_LEVELS, levelGraph } from "../../../model/truth/levelGraph";
import {
  emptyState,
  type Head,
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
// The small ttbar-like event of levelGraph.test.ts, its two pile-up collisions at vertices 10 and 11:
//   0 p (beam) -> 1 g -> 2 t -> 3 t (its copy) -> 4 W⁺, 5 b; 4 -> 6 c, 7 s̄
//   5, 7 -> 8 a string (no level) -> 9 B̄⁰ (b hadron), 10 π⁺ (reconstructable); 9 -> 11 D⁺ (c hadron) -> 12 K⁻
//   (reconstructable) -> 13 π⁻, 14 γ (no level)
//   0 -> 15 g (no level) -> 16 π⁻ (underlying event); 17 π⁰ (pile-up collision 1); 18 π⁺, 19 γ (collision 2)
const NAMES = "p g t t W⁺ b c s̄ str B̄⁰ π⁺ D⁺ K⁻ π⁻ γ g π⁻ π⁰ π⁺ γ".split(" ");
const P = {
  pdgId: [2212, 21, 6, 6, 24, 5, 4, -3, 92, -511, 211, 411, -321, -211, 22, 21, -211, 111, 211, 22],
  status: [4, 21, 22, 62, 22, 23, 23, 23, 71, 2, 1, 2, 1, 0, 0, 41, 1, 2, 1, 1],
  energy: [7000, 500, 400, 400, 200, 150, 120, 70, 220, 100, 50, 60, 30, 5, 3, 300, 10, 4, 3, 2.5],
  pt: [0, 0, 100, 100, 80, 60, 40, 30, 50, 40, 20, 25, 15, 2, 1, 30, 5, 4, 3, 2],
  levelFlags: [0, 0, 0, 0, 0, HARD, HARD, HARD, 0, B, RECO, C, RECO, 0, 0, 0, RECO, RECO, RECO, RECO],
  isSignal: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  eventIndex: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2],
  prodVertexIdx: [-1, -1, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7, 8, 8, -1, 9, 10, 11, 11],
};
const V = { reason: [17, 18, 2, 2, 19, 19, 2, 2, 11, 19, 0, 0] };
const kids: number[][] = Array.from({ length: P.pdgId.length }, () => []);
Object.assign(kids, { 0: [1, 15], 1: [2], 2: [3], 3: [4, 5], 4: [6, 7], 5: [8], 7: [8], 8: [9, 10], 9: [11] });
Object.assign(kids, { 11: [12], 12: [13, 14], 15: [16] });
const g = graphOf({ n: P.pdgId.length, columns: P }, csr(kids), { n: V.reason.length, columns: V });
const lg = levelGraph(g, "levelFlags", "isSignal", DEFAULT_LEVELS);

/** A head as text: a collision by its id (signal: "s"), its hard scatter, its underlying event, the pile-up. */
const headText = (h: Head) =>
  h.kind === "pileup" ? "[pile-up]" : `[${h.kind === "collision" ? (h.c.signal ? "s" : h.c.id) : h.kind}]`;
/** Each row as text: indented by depth, a head in brackets, a vertex as ◆ and its reason, a folded particle or head
 *  with ▸, an open one ▾. */
const text = (rows: Row[]) =>
  rows.map((r) => {
    const pad = "  ".repeat(r.depth),
      fold = "open" in r && r.open !== undefined ? (r.open ? " ▾" : " ▸") : "";
    if (r.kind === "head") return `${pad}${headText(r.head)}${fold}`;
    if (r.kind === "vertex") return `${pad}◆${V.reason[lg.vertices[r.vertex].row]}`;
    if (r.kind === "more") return `${pad}+${r.left}`;
    return `${pad}${r.kind === "hidden" ? "~" : ""}${NAMES[r.kind === "hidden" ? r.top : lg.particles[r.node].top]}${fold}`;
  });
const rows = (s: TreeState = emptyState(), vertices = true, keep = new Set<number>()) =>
  treeRows(lg, g, s, vertices, keep);

describe("treeRows", () => {
  it("hangs the hard process from the hard scatter, unfolded down to its hadrons, the rest folded", () => {
    expect(text(rows())).toEqual([
      "[s] ▾",
      "  [scatter] ▾",
      "    t ▾",
      "      ◆2",
      "      W⁺ ▾",
      "        ◆2",
      "        c",
      "        s̄",
      "      b ▾",
      "        ◆19",
      "        B̄⁰ ▾",
      "          ◆2",
      "          D⁺ ▾",
      "            ◆2",
      "            K⁻",
      "        π⁺",
      "  [underlying] ▸",
      "[pile-up] ▸",
    ]);
  });
  it("hangs the daughters straight under the particle without vertices, with the lines of the tree", () => {
    const r = rows(emptyState(), false);
    expect(text(r).slice(2, 6)).toEqual(["    t ▾", "      W⁺ ▾", "        c", "        s̄"]);
    const place = (name: string) => {
      const x = r.find((x) => x.kind === "particle" && NAMES[lg.particles[x.node].top] === name) as Place;
      return [x.depth, x.rails, x.last];
    };
    // the line of the signal collision's heads goes on past the hard process to the underlying event
    expect(place("t")).toEqual([2, [true], true]);
    expect(place("c")).toEqual([4, [true, false, true], false]); // the line of t's daughters goes on to the b
    expect(place("s̄")).toEqual([4, [true, false, true], true]);
    expect(place("K⁻")).toEqual([6, [true, false, false, true, false], true]); // beside the π⁺ under the b
  });
  it("folds and unfolds particles and heads by hand", () => {
    const s = emptyState();
    s.folds.set(5, false); // the b
    s.heads.set("underlying", true).set("scatter", false);
    expect(text(rows(s))).toEqual(["[s] ▾", "  [scatter] ▸", "  [underlying] ▾", "    π⁻", "[pile-up] ▸"]);
    s.heads.set("scatter", true).set("signal", false);
    expect(text(rows(s))).toEqual(["[s] ▸", "[pile-up] ▸"]);
  });
  it("lists the pile-up collisions, the hardest first, each folded, and builds nothing of a folded one", () => {
    const s = emptyState();
    s.heads.set("signal", false).set("pileup", true);
    expect(text(rows(s))).toEqual(["[s] ▸", "[pile-up] ▾", "  [2] ▸", "  [1] ▸"]);
    s.heads.set("pu2", true);
    expect(text(rows(s))).toEqual(["[s] ▸", "[pile-up] ▾", "  [2] ▾", "    π⁺", "    γ", "  [1] ▸"]);
  });
  it("hangs a collision without a hard scatter's particles straight under it", () => {
    // a particle gun: two π at vertex 0, the signal collision
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
    const glg = levelGraph(gun, "levelFlags", "isSignal", DEFAULT_LEVELS);
    const r = treeRows(glg, gun, emptyState(), true, new Set());
    expect(r.map((x) => [x.kind, x.depth, x.kind === "particle" ? glg.particles[x.node].top : -1])).toEqual([
      ["head", 0, -1],
      ["particle", 1, 1],
      ["particle", 1, 0],
    ]);
    expect(pathTo(gun, glg, 0)).toMatchObject({ collision: glg.signal, hard: false, tops: [0] });
  });
  it("lists the particles at no shown level under a node when asked, each folding its own", () => {
    expect(hiddenChildren(g, lg, 12)).toEqual([13, 14]);
    expect(hiddenChildren(g, lg, 5)).toEqual([8]); // the string
    const s = emptyState();
    s.below.add(5);
    const r = text(rows(s));
    expect(r.slice(r.indexOf("        π⁺"), r.indexOf("  [underlying] ▸"))).toEqual(["        π⁺", "        ~str"]);
    expect(hiddenChildren(g, lg, 8)).toEqual([]); // the string's daughters are all shown: nothing to unfold
  });
  it("gives every row its own key", () => {
    const s = reveal(emptyState(), pathTo(g, lg, 13)!);
    for (const k of ["underlying", "pileup", "pu1", "pu2"]) s.heads.set(k, true);
    s.below.add(5);
    const keys = rows(s).map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("reveals a particle at no shown level: the way down to it and the list of the node it hides under", () => {
    const path = pathTo(g, lg, 13)!;
    expect(path).toEqual({ collision: lg.signal, hard: true, tops: [2, 5, 9, 11, 12, 13], hidden: 5 });
    const s = reveal(emptyState(), path);
    expect([...s.heads]).toEqual([
      ["signal", true],
      ["scatter", true],
    ]);
    expect([...s.below]).toEqual([12]);
    expect([...s.folds.keys()]).toEqual([2, 5, 9, 11, 12]); // the K⁻ unfolded too: its list shows only then
    expect(text(rows(s)).slice(14, 17)).toEqual(["            K⁻", "              ~π⁻", "              ~γ"]);
    expect(pathTo(g, lg, 16)).toEqual({ collision: lg.signal, hard: false, tops: [16], hidden: 1 });
    expect([...reveal(emptyState(), pathTo(g, lg, 16)!).heads.keys()]).toEqual(["signal", "underlying"]);
    expect([...reveal(emptyState(), pathTo(g, lg, 17)!).heads.keys()]).toEqual(["pileup", "pu1"]);
    expect(pathTo(g, lg, 15)).toBeNull(); // no shown particle above it
    expect(reveal(s, path)).toBe(s); // open already: the same state
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
    expect(pathTo(d, dlg, 3)).toEqual({ collision: dlg.signal, hard: true, tops: [2, 3], hidden: 1 });
    // the B̄*⁰ listed under the b, beside the B̄⁰ (by pdgId, indented by depth)
    const r = treeRows(dlg, d, reveal(emptyState(), pathTo(d, dlg, 3)!), false, new Set());
    const pdg = (x: Row) =>
      "  ".repeat(x.depth) +
      (x.kind === "hidden"
        ? `~${d.col("pdgId", x.top)}`
        : x.kind === "particle"
          ? d.col("pdgId", dlg.particles[x.node].top)
          : x.kind);
    expect(r.map(pdg)).toEqual(["head", "  head", "    5", "      -511", "      ~-513"]);
  });
  it("lists the particles at no shown level of a node only while it is unfolded", () => {
    const s = emptyState();
    s.below.add(5);
    s.folds.set(5, false);
    const r = rows(s),
      b = r.find((x) => x.kind === "particle" && lg.particles[x.node].top === 5);
    expect(text(r)).not.toContain("        ~str");
    expect(b && b.kind === "particle" && [b.open, b.below]).toEqual([false, 1]); // "▸ 1 below": what a click lists
  });
  it("gives a particle at no shown level listed under two parents a key under each", () => {
    const s = emptyState();
    s.below.add(5);
    s.below.add(7); // the string, under the b and the s̄
    const r = rows(s),
      keys = r.map((x) => x.key);
    expect(text(r).filter((x) => x.endsWith("~str"))).toHaveLength(2);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("opens what is forced, whatever the state, without changing it", () => {
    const s = emptyState();
    s.folds.set(5, false);
    const force = reveal(emptyState(), pathTo(g, lg, 12)!);
    expect(text(rows(s))).not.toContain("            K⁻");
    expect(text(treeRows(lg, g, s, true, new Set(), force))).toContain("            K⁻");
    expect(s.folds.get(5)).toBe(false);
  });
});

describe("treeRows of large lists", () => {
  const n = 2 * LIST + 20;
  /** n pile-up particles, largest first: in one collision, or each in its own (`apart`). */
  const pileup = (apart: boolean) => {
    const big = graphOf(
      {
        n,
        columns: {
          pdgId: Array(n).fill(211),
          status: Array(n).fill(1),
          energy: Array.from({ length: n }, (_, i) => n - i),
          pt: Array.from({ length: n }, (_, i) => n - i),
          levelFlags: Array(n).fill(RECO),
          isSignal: Array(n).fill(0),
          ...(apart ? { eventIndex: Array.from({ length: n }, (_, i) => i + 1) } : {}),
        },
      },
      csr(Array.from({ length: n }, () => [])),
    );
    return { big, blg: levelGraph(big, "levelFlags", "isSignal", DEFAULT_LEVELS) };
  };
  const one = pileup(false),
    many = pileup(true);
  /** How many rows of `kind` are listed, and how many the last row says are left. */
  const listed = ({ big, blg }: typeof one, s: TreeState, kind: Row["kind"], keep = new Set<number>()) => {
    const r = treeRows(blg, big, s, true, keep);
    return [
      r.filter((x) => x.kind === kind).length,
      r.at(-1)!.kind === "more" ? (r.at(-1) as { left: number }).left : 0,
    ];
  };
  const open = (...heads: string[]): TreeState => ({ ...emptyState(), heads: new Map(heads.map((k) => [k, true])) });
  it("lists the first particles of a collision, the rest on asking", () => {
    expect(treeRows(one.blg, one.big, emptyState(), true, new Set()).length).toBe(1); // folded: the pile-up only
    expect(text(treeRows(one.blg, one.big, open("pileup"), true, new Set()))).toEqual(["[pile-up] ▾", "  [-1] ▸"]);
    expect(listed(one, open("pileup", "pu-1"), "particle")).toEqual([LIST, n - LIST]);
    const more = { ...open("pileup", "pu-1"), more: new Map([["pu-1", 2 * LIST]]) };
    expect(listed(one, more, "particle")).toEqual([2 * LIST, n - 2 * LIST]);
  });
  it("lists a kept one wherever it is", () => {
    expect(listed(one, open("pileup", "pu-1"), "particle", new Set([n - 1]))).toEqual([LIST + 1, n - LIST - 1]);
  });
  it("lists the first collisions, the rest on asking, and a kept particle's collision wherever it is", () => {
    expect(listed(many, open("pileup"), "head")).toEqual([1 + LIST, n - LIST]); // the pile-up and its collisions
    const more = { ...open("pileup"), more: new Map([["pileup", 2 * LIST]]) };
    expect(listed(many, more, "head")).toEqual([1 + 2 * LIST, n - 2 * LIST]);
    expect(listed(many, open("pileup"), "head", new Set([n - 1]))).toEqual([2 + LIST, n - LIST - 1]);
  });
  it("lists the first daughters of a particle under their vertices, a kept one under its own", () => {
    // 0 b (leg) -> 1 .. n daughters, largest first, made at vertices 0 and 1 in turn
    const m = n + 1,
      fam = graphOf(
        {
          n: m,
          columns: {
            pdgId: Array.from({ length: m }, (_, i) => (i ? 211 : 5)),
            status: Array.from({ length: m }, (_, i) => (i ? 1 : 23)),
            energy: Array.from({ length: m }, (_, i) => (i ? m - i : 1e4)),
            levelFlags: Array.from({ length: m }, (_, i) => (i ? RECO : HARD)),
            isSignal: Array(m).fill(1),
            prodVertexIdx: Array.from({ length: m }, (_, i) => (i ? (i + 1) % 2 : -1)),
          },
        },
        csr([Array.from({ length: n }, (_, i) => i + 1), ...Array.from({ length: n }, () => [])]),
        { n: 2, columns: { reason: [2, 11] } },
      );
    const flg = levelGraph(fam, "levelFlags", "isSignal", DEFAULT_LEVELS);
    const shape = (keep: Set<number>) =>
      treeRows(flg, fam, emptyState(), true, keep)
        .slice(3) // the signal collision, its hard scatter and the b
        .reduce<string[]>((out, r) => {
          const k =
            r.kind === "particle" ? "p" : r.kind === "vertex" ? `◆${r.vertex}` : `+${(r as { left: number }).left}`;
          if (k === "p" && out.at(-1)?.startsWith("p")) out[out.length - 1] = `p${Number(out.at(-1)!.slice(1)) + 1}`;
          else out.push(k === "p" ? "p1" : k);
          return out;
        }, []);
    expect(shape(new Set())).toEqual(["◆0", "p25", "◆1", "p25", `+${n - LIST}`]);
    expect(shape(new Set([n]))).toEqual(["◆0", "p25", "◆1", "p26", `+${n - LIST - 1}`]); // the last, made at 1
  });
});
