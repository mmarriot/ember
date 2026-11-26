// Where a truth particle's line ends. The file's end point is its last copy's decayVertexIdx: the latest vertex where
// daughters it kept were made, which for a particle that showered can be a vertex of its shower, nanoseconds later and
// tens of cm off its path (an annihilation of one of its shower's positrons). A particle that reached the calorimeter
// is drawn to where it entered it (its boundary checkpoint) when its last vertex is no earlier than that.
import type { EventData, Header } from "../../io/format";

/** The boundary checkpoint's columns (docs/truth-graph.md): a particle crossed into the calorimeter there, then. */
const BOUNDARY = { reached: "hasBoundary", x: "boundaryX", y: "boundaryY", z: "boundaryZ", t: "boundaryT" };

/** A particle ends at its boundary checkpoint: it reached the calorimeter, and its last vertex (`vertexT`, its time;
 *  NaN for none) is no earlier than that. */
export const endsAtBoundary = (reached: number, boundaryT: number, vertexT: number) =>
  !!reached && !(vertexT < boundaryT);

/** `ev` with the end points of the truth particles that end at their boundary checkpoint (endsAtBoundary) moved
 *  there, for each truth particle layer with an end and the checkpoint's columns; `ev` itself when none moves. One
 *  pass over the particles per event, and a copy of the end columns only when a particle moves. */
export function withTruthEnds(ev: EventData, header: Header): EventData {
  let tables = ev.tables;
  for (const d of header.display) {
    const t = tables[d.table],
      c = t?.columns;
    if (!d.truth || !d.particle || !d.end || !c || !["decayVertexIdx", ...Object.values(BOUNDARY)].every((n) => c[n]))
      continue;
    // the vertex table: where a non-association relation from the particles leads to another truth table
    const vtx = Object.entries(header.relations).find(
      ([n, r]) =>
        r.from === d.table &&
        r.to !== d.table &&
        !r.association &&
        ev.relations[n] &&
        header.display.some((l) => l.table === r.to && l.truth),
    )?.[1].to;
    const vt = vtx ? tables[vtx]?.columns.t : undefined,
      nv = vtx ? (tables[vtx]?.n ?? 0) : 0,
      ends = d.end.map((name) => c[name]);
    if (ends.some((e) => !e)) continue;
    let out: Float32Array[] | null = null;
    for (let r = 0; r < t.n; r++) {
      const v = Number(c.decayVertexIdx[r]),
        when = vt && v >= 0 && v < nv ? Number(vt[v]) : NaN;
      if (!endsAtBoundary(Number(c[BOUNDARY.reached][r]), Number(c[BOUNDARY.t][r]), when)) continue;
      out ??= ends.map((e) => Float32Array.from({ length: t.n }, (_, i) => Number(e![i])));
      out[0][r] = Number(c[BOUNDARY.x][r]);
      out[1][r] = Number(c[BOUNDARY.y][r]);
      out[2][r] = Number(c[BOUNDARY.z][r]);
    }
    if (!out) continue;
    const columns = { ...c, [d.end[0]]: out[0], [d.end[1]]: out[1], [d.end[2]]: out[2] };
    tables = { ...tables, [d.table]: { ...t, columns } };
  }
  return tables === ev.tables ? ev : { ...ev, tables };
}
