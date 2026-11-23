// Simulation facts (docs/truth.md): truth -> hit relations giving the simulated energy each particle left in each
// cell, from the truth graph's hit index. Not matches. The hint `fact: {in}` names the detector, so totals are never
// summed across detectors; without it (older bundles, hgcal.json), a truth association into a layer drawn as cells is
// a fact in that layer's domain.
import type { DisplayLayer, EventData, Fact, Header } from "../../io/format";
import { cached } from "../event/cache";

const layerOf = (header: Header, table: string): DisplayLayer | undefined =>
  header.display?.find((l) => l.table === table);

/** The detector of relation `name` if it is a simulation fact (truth -> hits), else undefined. "" for a fact whose
 *  detector the bundle does not name (an old bundle without domains). */
export function factIn(header: Header, name: string): string | undefined {
  const r = header.relations[name];
  if (!r) return undefined;
  if (r.fact) return r.fact.in;
  const from = layerOf(header, r.from),
    to = layerOf(header, r.to);
  if (!r.association || !from?.truth || !to || to.truth || to.context || to.repr !== "cells") return undefined;
  return to.domain ?? "";
}

/** The bundle's fact relations: name, truth table, hit table and detector. Once per header. */
export type FactRelation = { name: string; from: string; to: string; in: string; unit?: Fact["unit"] };
export function facts(header: Header): FactRelation[] {
  return cached(header, "facts", () =>
    Object.keys(header.relations).flatMap((name) => {
      const where = factIn(header, name),
        r = header.relations[name];
      return where === undefined
        ? []
        : [{ name, from: r.from, to: r.to, in: where, ...(r.fact?.unit ? { unit: r.fact.unit } : {}) }];
    }),
  );
}

/** Per particle (`n` of them), or per `key[particle]`, the simulated energy in detector `det`: the sum over the hits of
 *  the fact relations `fs` there, by their `best` weight (else their first). */
export function simEnergyIn(
  ev: EventData,
  header: Header,
  fs: FactRelation[],
  det: string,
  n: number,
  key?: Int32Array,
): Float64Array {
  const sum = new Float64Array(n);
  for (const f of fs) {
    if (f.in !== det) continue;
    const info = header.relations[f.name],
      rel = ev.relations[f.name],
      w = rel.weights[info.best?.weight ?? info.weights[0]];
    if (!w) continue;
    for (let p = 0; p < n && p + 1 < rel.offsets.length; p++) {
      const to = key ? key[p] : p;
      for (let k = rel.offsets[p]; k < rel.offsets[p + 1]; k++) sum[to] += w[k];
    }
  }
  return sum;
}

/** What one row of the simulation's record covers for hit `row` of a fact relation's table, when coarser than a hit
 *  (e.g. "CSC layer"); undefined when it is the hit itself. */
export function factUnit(
  f: FactRelation,
  columns: Record<string, ArrayLike<number | bigint>> | undefined,
  row: number,
): string | undefined {
  const u = f.unit;
  if (!u || typeof u === "string") return u;
  const v = columns?.[u.column]?.[row];
  return v === undefined ? undefined : u.names[String(v)];
}

/** Whether `table` holds hits with simulation facts (the `to` of a fact relation). */
export const isFactTable = (header: Header, table: string) => facts(header).some((f) => f.to === table);

/** The unit of the simulated amount in detector `where`: GeV, but photoelectrons in HF (docs/truth.md "Each kind's
 *  contract"). The bundle does not name it. */
export const simUnit = (where: string) => (where === "HF" ? "photoelectrons" : "GeV");

/** Whether `table`'s objects are made (through a plain relation) of fact hits drawn as cells: layer clusters,
 *  superclusters, PF clusters; not muon or track hits. */
export function madeOfSimCells(header: Header, table: string): boolean {
  const hits = new Set(facts(header).map((f) => f.to));
  return Object.values(header.relations).some(
    (r) => r.from === table && !r.association && hits.has(r.to) && layerOf(header, r.to)?.repr === "cells",
  );
}
