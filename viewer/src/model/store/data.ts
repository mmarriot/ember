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
/** The bundle the event shown belongs to, written with the event (open.ts putEvent). openBundle writes the bundle and
 *  its first event at once, so the two differ only when a bundle has no event. */
export const shownOf = signal<Bundle | null>(null);
/** The index entry (run, event, ...) of the event shown, if it belongs to the open bundle. */
export const shownEntry = computed(() =>
  bundle.value && shownOf.value === bundle.value ? bundle.value.events[eventIndex.value] : undefined,
);
/** The event shown, with the user's custom columns added (model/custom.ts): what the view and the panels use. */
export const event = computed(() => (rawEvent.value ? withCustomColumns(rawEvent.value, customColumns.value) : null));

/** An event is being read. */
export const loading = signal(false);
/** How long the last event took to read and decompress (ms). */
export const loadMs = signal(0);
