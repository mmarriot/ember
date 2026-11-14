// What is known about the data set open, in words: for the chooser's header and the Event tab's Source section.
import type { Bundle } from "../io/bundle";
import { expiryText, ownerOf } from "./library";
import type { Opened } from "./store";

/** An ISO time as a date and time of day in the reader's own format; "" if it is not a time. */
export const when = (iso?: string) =>
  iso && !Number.isNaN(Date.parse(iso))
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";

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
