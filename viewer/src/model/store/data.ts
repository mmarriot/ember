// The data set open and the event shown. open.ts writes these signals (openBundle, showEvent); everything else reads
// them.
import { computed, signal } from "@preact/signals";
import type { Bundle } from "../../io/bundle";
import type { EventData } from "../../io/format";
import { customColumns, withCustomColumns } from "../custom";

/** The bundle open, or null before the first one opens. */
export const bundle = signal<Bundle | null>(null);
/** The name it was opened by: a file of this site, an address elsewhere, or a local file's name. */
export const bundleName = signal("");

/** The index of the event shown (or being read) in `bundle.events`. */
export const eventIndex = signal(0);
/** The event shown, as read from the file. */
export const rawEvent = signal<EventData | null>(null);
/** The bundle the event shown belongs to: for a moment after another bundle opens, still the previous one. Written
 *  by showEvent with the event. */
export const shownOf = signal<Bundle | null>(null);
/** The index entry (run, event, ...) of the event shown, once it belongs to the open bundle. Until a newly opened
 *  bundle's first event is read, `eventIndex` still names the previous bundle's event (or 0, while a link's event 30
 *  is on its way): an event that is neither the one on screen nor the one coming. */
export const shownEntry = computed(() =>
  bundle.value && shownOf.value === bundle.value ? bundle.value.events[eventIndex.value] : undefined,
);
/** The event shown, with the user's custom columns added (model/custom.ts): what the view and the panels use. */
export const event = computed(() => (rawEvent.value ? withCustomColumns(rawEvent.value, customColumns.value) : null));

/** An event is being read. */
export const loading = signal(false);
/** How long the last event took to read and decompress (ms). */
export const loadMs = signal(0);
