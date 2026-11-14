// Left panel: the profile's presets; a tab per part of the detector (layer `domain`) with its collections (with a domain
// bar: a tab per shared domain, e.g. Physics, and one Detector tab for the parts, following the bar), the truth
// (its collections, what became of each particle, the tree) and the event; the colour key under them. Its width can
// be dragged.
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { activePreset } from "../model/custom";
import { applyPreset } from "../model/presets";
import type { DisplayLayer } from "../io/bundle";
import { bundle, bundleName, DETECTOR, domain, openTab } from "../model/store";
import { chooseDomain } from "./navigate";
import { EventInfo } from "./EventInfo";
import { ColourKey } from "./Key";
import { Collections, tabOf } from "./Layers";
import { Truth, treeRelations } from "./Tree";
import { stopTour } from "./tour";
import { Icon, Tabs } from "./widgets";

export function Sidebar() {
  const b = bundle.value,
    display = b?.header.display ?? [],
    presets = b?.header.presets ?? [];
  const reco = display.filter((d) => !d.truth),
    truth = display.some((d) => d.truth);
  // One tab per part, in the order of the header's `domains` (as the top bar's buttons), then the others in display order.
  const order = (b?.header.domains ?? []).map((d) => d.name),
    rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  const names = [...new Set(reco.map(tabOf))].sort((x, y) => rank(x) - rank(y)); // a stable sort: ties keep display order
  // With a domain bar, the parts of the detector share one tab, Detector, which follows the bar; shared domains (e.g.
  // Physics) and layers of no part keep a tab each.
  const domains = b?.header.domains ?? [],
    detectors = domains.length >= 2 ? domains.filter((d) => !d.shared).map((d) => d.name) : [];
  const own = names.filter((name) => !detectors.includes(name));
  const tabs: [string, () => ComponentChildren][] = own.map((name) => [
    name,
    () => <Collections key={`${bundleName.value}|${name}`} layers={reco.filter((d) => tabOf(d) === name)} />,
  ]);
  if (names.some((name) => detectors.includes(name)))
    tabs.push([DETECTOR, () => <Detector names={detectors.filter((name) => names.includes(name))} layers={reco} />]);
  if (truth || treeRelations().length) tabs.push([truth ? "Truth" : "Tree", Truth]);
  tabs.push(["Event", EventInfo]);
  return (
    <>
      <aside
        class={sheetOpen.value ? "sidebar" : "sidebar closed"}
        onPointerDown={stopTour}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(".tablist")) sheetOpen.value = true;
        }}
      >
        <button
          class="sheet-handle"
          aria-expanded={sheetOpen.value}
          title="Show or hide the panel"
          onClick={() => (sheetOpen.value = !sheetOpen.value)}
        >
          {sheetOpen.value ? "▾ hide the panel" : "▴ show the panel"}
        </button>
        {presets.length > 1 && (
          <label class="presets" title="Presets: which rows are drawn and how they are coloured">
            <span class="barlabel">Preset</span>
            {/* blurred once chosen: a focused list would take the view's keys (arrows, letters) */}
            <select
              aria-label="Preset"
              value={activePreset.value}
              onChange={(e) => {
                applyPreset(Number((e.target as HTMLSelectElement).value));
                (e.target as HTMLSelectElement).blur();
              }}
            >
              {presets.map((p, i) => (
                <option value={i}>{p.name}</option>
              ))}
            </select>
            <button
              class="icon-button small"
              title="Apply this preset again: undoes filters and colours changed by hand"
              onClick={(e) => {
                e.preventDefault();
                applyPreset(activePreset.value);
              }}
            >
              <Icon name="reset" />
            </button>
          </label>
        )}
        <Tabs tabs={tabs} open={openTab.value} />
        <ColourKey />
      </aside>
      <div
        class="resizer"
        title="Drag to resize, double-click to reset"
        onPointerDown={startResize}
        onDblClick={() => setWidth(DEFAULT_WIDTH)}
      />
    </>
  );
}

/** The parts of the detector, one section each: the one looked at open and first, with the others folded; in a shared
 *  domain's view all folded (it draws none of them), in All all open (it draws them all). */
function Detector({ names, layers }: { names: string[]; layers: DisplayLayer[] }) {
  const current = domain.value,
    order = [...names.filter((n) => n === current), ...names.filter((n) => n !== current)];
  return (
    <>
      {order.map((name) => {
        const here = name === current,
          drawn = here || !current;
        return (
          <details class="part" open={here || !current} key={`${bundleName.value}|${name}|${current}`}>
            <summary>
              <b>{name}</b>{" "}
              <span
                class="muted"
                title={
                  drawn
                    ? here
                      ? "Drawn: the part looked at"
                      : "Drawn in All"
                    : "Not drawn in this view: drawn when it is looked at (show, or D), and its objects for a selection"
                }
              >
                {drawn ? (here ? "looked at" : "drawn") : "not in this view"}
              </span>
              {!here && (
                <button
                  class="link"
                  title={`Look at ${name} (D)`}
                  onClick={(e) => {
                    e.preventDefault();
                    chooseDomain(name);
                  }}
                >
                  show
                </button>
              )}
            </summary>
            <Collections key={`${bundleName.value}|${name}`} layers={layers.filter((d) => d.domain === name)} />
          </details>
        );
      })}
    </>
  );
}

/** Phones (narrow screens): the panel is a sheet under the view, folded to its tabs and the colour key's title until
 *  a tab or the handle opens it; wider screens ignore it. */
const sheetOpen = signal(false);

// Sidebar width: a CSS variable on the root, remembered per browser (storage may be unavailable, e.g. private mode).
const DEFAULT_WIDTH = 340,
  KEY = "evd.sidebar";
function setWidth(px: number) {
  const w = Math.round(Math.min(560, Math.max(260, px)));
  document.documentElement.style.setProperty("--sidebar", `${w}px`);
  try {
    localStorage.setItem(KEY, String(w));
  } catch {
    /* not persisted */
  }
}
try {
  const w = Number(localStorage.getItem(KEY));
  if (w) setWidth(w);
} catch {
  /* default width */
}

function startResize(e: PointerEvent) {
  const handle = e.currentTarget as HTMLElement;
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  const move = (m: PointerEvent) => setWidth(m.clientX);
  const up = () => {
    handle.removeEventListener("pointermove", move);
    document.body.classList.remove("resizing");
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up, { once: true });
}
