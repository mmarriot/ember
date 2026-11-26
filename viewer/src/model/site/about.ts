// What is known about the data set open, in words: for the chooser's header and the Metadata tab's Source section.
import type { Bundle } from "../../io/bundle";
import type { Header } from "../../io/format";
import { expiryText, ownerOf } from "./library";
import type { Opened } from "../store";

/** An ISO time as a date and time of day in the reader's own format; "" if it is not a time. */
export const when = (iso?: string) =>
  iso && !Number.isNaN(Date.parse(iso))
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";

/** Whether an event is simulated. No header field says so; the bundle has truth only from a simulation, and CMSSW
 *  numbers every simulated run 1 (data runs are in the hundreds of thousands). */
export const isSimulation = (h: Pick<Header, "display">, run: number) => run === 1 || h.display.some((d) => d.truth);

/** The event in one line, for the view's title and a picture's caption: "MC · ttbar 0PU · Run 1 · LS 1 · Event 18"
 *  (MC: a simulated event). Data are named by their run alone: "DATA · Run 392294 · LS 21 · Event 11805516". `sample`: the data
 *  set's title, of which the first part (before " · ") is kept. */
export function eventTitle(sim: boolean, sample: string, id: { run: number; lumi: number; event: number }): string {
  const name = sim ? sample.split(" · ")[0] : "";
  return [sim ? "MC" : "DATA", name, `Run ${id.run}`, `LS ${id.lumi}`, `Event ${id.event}`].filter(Boolean).join(" · ");
}

/** One line: how many events, whose it is (or that it is local, or from another site), when it expires. */
export function summary(o: Opened, b: Bundle, now = new Date()): string {
  const owner = !o.local && ownerOf(o.file);
  const from = o.local
    ? "a local file"
    : o.external
      ? `not on this site: read from ${o.file.split("/")[2]}`
      : owner
        ? `published by ${owner}`
        : "";
  return [`${b.events.length.toLocaleString()} events`, from, expiryText(o.entry?.expires, now)]
    .filter(Boolean)
    .join(" · ");
}

/** Name and value rows, those that are known: who published it and when (the index's `published`; an index without it
 *  says only when it was converted, which the bundle says too), its expiry, what converted it from what. */
export function provenance(o: Opened | null, b: Bundle | null, now = new Date()): [string, string][] {
  if (!o || !b) return [];
  const src = b.header.source,
    e = o.entry;
  const rows: [string, string | undefined | null | false][] = [
    ["Events", b.events.length.toLocaleString()],
    ["Published by", !o.local && ownerOf(o.file)], // a local file's name may look like anything
    ["Published", when(e?.published)],
    [
      "Expires",
      e?.expires && when(e.expires) && `${when(e.expires)} (${expiryText(e.expires, now).replace(/^expires /, "")})`,
    ],
    ["Converted", when(src.created)],
    ["Converter", src.converter],
    ["CMSSW", src.cmssw],
    ["Profile", b.header.profile],
    ["From", src.files?.join(", ")],
    [
      o.external ? "Address" : "File",
      o.local ? `${o.file} (on this computer)` : o.external ? `${o.file} (not on this site)` : o.file,
    ],
  ];
  return rows.filter((r): r is [string, string] => typeof r[1] === "string" && !!r[1]);
}
