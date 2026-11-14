import { describe, expect, it } from "vitest";
import type { DisplayLayer } from "../io/format";
import all from "./fixtures/all_header.json";
import cms from "./fixtures/cms_header.json";
import { stepLayers, TOUR_STEPS, tourPlan } from "./tour";

const display = (h: unknown) => (h as { display: DisplayLayer[] }).display;
const titles = (h: unknown) => tourPlan(display(h)).map((s) => s.step.title);
const tables = (h: unknown, title: string) =>
  tourPlan(display(h))
    .find((s) => s.step.title === title)
    ?.layers.map((d) => d.table);

describe("tour plan", () => {
  it("goes out from the collision point and up from hits to physics objects (whole-detector bundle)", () => {
    expect(titles(all)).toEqual([
      "The collision point",
      "Tracker hits",
      "Tracks",
      "Timing layer",
      "Calorimeter hits",
      "Clusters",
      "Showers in HGCal",
      "Muon chambers",
      "Muon tracks",
      "Particle flow",
      "Jets",
      "Missing momentum",
      "Leptons and photons",
      "b tagging",
    ]);
  });
  it("shows a kind's layers that the bundle shows by default, else all of them; no alternatives or truth", () => {
    // ECAL and HCAL barrel, HGCal; not HCAL outer and forward (hidden by default), nor the merged HGCal hits (an alternative)
    expect(tables(all, "Calorimeter hits")).toEqual([
      "EcalHits",
      "HBHEHits",
      "HGCalSoARecHitsEE",
      "HGCalSoARecHitsHSi",
      "HGCalSoARecHitsHSci",
    ]);
    expect(tables(all, "The collision point")).toEqual(["BeamSpot", "Vertices"]); // the beam spot is hidden by default
    expect(tables(all, "Jets")).toEqual(["Jets"]); // not the CHS alternative
    expect(tables(all, "Particle flow")).toEqual(["PFCandidates"]); // hidden by default, the only layer of its kind
    for (const s of tourPlan(display(all))) expect(s.layers.some((d) => d.truth || d.alternative)).toBe(false);
  });
  it("shows only the last reconstruction stage of a kind with stages", () => {
    const stages = [0, 1, 2].map(
      (stage) => ({ table: `S${stage}`, kind: "candidate", stage, visible: false }) as DisplayLayer,
    );
    expect(stepLayers(stages, { kinds: ["candidate"] }).map((d) => d.table)).toEqual(["S2"]);
  });
  it("tours an HGCal-focused bundle through what it has", () => {
    expect(titles(cms)).toEqual([
      "The collision point",
      "Tracker hits",
      "Tracks",
      "Calorimeter hits",
      "Clusters",
      "Showers in HGCal",
    ]);
  });
  it("is empty (the replay tour) for a bundle without the kinds it names, or with only one step", () => {
    expect(tourPlan([{ table: "HGCHit", repr: "cells", label: "Hits", visible: true } as DisplayLayer])).toEqual([]);
    expect(tourPlan(display(all).filter((d) => d.kind === "jet"))).toEqual([]);
  });
  it("has a caption for every step", () => {
    for (const s of TOUR_STEPS) expect(s.title.length && s.detail.length).toBeTruthy();
  });
});
