// Which truth -> hit relations are simulation facts (docs/truth.md): the simulated energy each truth particle left in
// each detector cell, from the truth graph's hit index. They are not matches: a hit "has 60% of its simulated energy
// from this particle". The relation hint `fact: {in}` says so and names the detector, so totals are never summed
// across detectors (sampling and homogeneous calorimeters, HF photoelectrons). Bundles made before the hint, and
// relations of profiles that do not set it (hgcal.json), keep the earlier rule: a truth association into a layer
// drawn as cells is a fact, in that layer's domain.
import type { DisplayLayer, Fact, Header } from "../io/bundle";

const layerOf = (header: Header, table: string): DisplayLayer | undefined => header.display?.find((l) => l.table === table);

/** The detector of relation `name` if it is a simulation fact (truth -> hits), else undefined. "" for a fact whose
 *  detector the bundle does not name (an old bundle without domains). */
export function factIn(header: Header, name: string): string | undefined {
  const r = header.relations[name];
  if (!r) return undefined;
  if (r.fact) return r.fact.in;
  const from = layerOf(header, r.from), to = layerOf(header, r.to);
  if (!r.association || !from?.truth || !to || to.truth || to.context || to.repr !== "cells") return undefined;
  return to.domain ?? "";
}

/** The fact relations of the bundle: name, truth table, hit table and detector. Once per header. */
export type FactRelation = { name: string; from: string; to: string; in: string; unit?: Fact["unit"] };
export function facts(header: Header): FactRelation[] {
  let out = factsOf.get(header);
  if (!out) {
    out = Object.keys(header.relations).flatMap((name) => {
      const where = factIn(header, name), r = header.relations[name];
      return where === undefined ? [] : [{ name, from: r.from, to: r.to, in: where, ...(r.fact?.unit ? { unit: r.fact.unit } : {}) }];
    });
    factsOf.set(header, out);
  }
  return out;
}
const factsOf = new WeakMap<Header, FactRelation[]>();

/** What one row of the simulation's record covers for hit `row` of a fact relation's table, when coarser than a hit
 *  (e.g. "CSC layer"); undefined when it is the hit itself. */
export function unitOf(f: FactRelation, columns: Record<string, ArrayLike<number | bigint>> | undefined, row: number): string | undefined {
  const u = f.unit;
  if (!u || typeof u === "string") return u;
  const v = columns?.[u.column]?.[row];
  return v === undefined ? undefined : u.names[String(v)];
}

/** Whether `table` holds hits with simulation facts (the `to` of a fact relation). */
export const isFactTable = (header: Header, table: string) => facts(header).some((f) => f.to === table);
