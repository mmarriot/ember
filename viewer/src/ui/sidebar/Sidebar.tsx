// The side panel: the profile's presets, the tabs, and the colour key under them (Key.tsx). The tabs: with a domain
// bar (Look at), one Collections tab with a folding section per part, else a tab per part (Layers.tsx); Truth
// (TruthTab.tsx); Event (EventInfo.tsx). Its width can be dragged; on phones it is a sheet under the view.
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { activePreset } from "../../model/custom/custom";
import { applyPreset, presetFits } from "../../model/custom/presets";
import type { DisplayLayer } from "../../io/format";
import { bundle, bundleName, COLLECTIONS, domain, openTab, overlay, shared } from "../../model/store";
import { chooseDomain } from "../../control/navigate";
import { EventInfo } from "./EventInfo";
import { ColourKey } from "./Key";
import { Collections, TickAll, tabOf } from "./Layers";
import { treeRelations } from "./Tree";
import { TruthTab } from "./TruthTab";
import { stopTour } from "../../control/tour";
import { Icon, Tabs } from "../common/widgets";

/** Phones: the sheet is unfolded (by a tab or its handle); wider screens ignore it. */
const sheetOpen = signal(false);

// The panel's width: the CSS variable --sidebar on the root, remembered in this browser when storage is available (not
// in every private window). Read once, as the page loads.
const DEFAULT_WIDTH = 340,
  KEY = "evd.sidebar"; // the "evd." prefix is kept so that saved widths survive the rename (see model/site/library.ts)
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

/** A drag on the panel's edge. The handle captures the pointer, so its moves keep coming when it leaves the thin
 *  handle; the capture ends on a release and on a cancel (a touch turned into a scroll), and the drag with it. */
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
  handle.addEventListener("lostpointercapture", up, { once: true });
}

export function Sidebar() {
  const b = bundle.value,
    display = b?.header.display ?? [],
    presets = (b?.header.presets ?? []).map((p, i) => [p, i] as const).filter(([p]) => presetFits(p, b!.header));
  // The preset remembered for this profile may not be offered for this bundle: then the first one that is.
  const chosen = presets.some(([, i]) => i === activePreset.value) ? activePreset.value : (presets[0]?.[1] ?? 0);
  const reco = display.filter((d) => !d.truth),
    truth = display.some((d) => d.truth);
  // One tab per part, in the order of the header's `domains` (as the top bar), then the others in display order.
  const order = (b?.header.domains ?? []).map((d) => d.name),
    rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  const names = [...new Set(reco.map(tabOf))].sort((x, y) => rank(x) - rank(y)); // a stable sort: ties keep display order
  // With a domain bar, its parts share one tab, Collections, which follows the bar; layers of no part keep a tab.
  const domains = b?.header.domains ?? [],
    parts = domains.length >= 2 ? domains.map((d) => d.name).filter((name) => names.includes(name)) : [];
  const own = names.filter((name) => !parts.includes(name));
  const tabs: [string, () => ComponentChildren][] = [];
  if (parts.length) tabs.push([COLLECTIONS, () => <Parts names={parts} layers={reco} />]);
  for (const name of own)
    tabs.push([
      name,
      () => <Collections key={`${bundleName.value}|${name}`} layers={reco.filter((d) => tabOf(d) === name)} />,
    ]);
  if (truth || treeRelations().length) tabs.push([truth ? "Truth" : "Tree", TruthTab]);
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
              value={chosen}
              onChange={(e) => {
                applyPreset(Number((e.target as HTMLSelectElement).value));
                (e.target as HTMLSelectElement).blur();
              }}
            >
              {presets.map(([p, i]) => (
                <option value={i}>{p.name}</option>
              ))}
            </select>
            <button
              class="icon-button small"
              title="Apply this preset again: undoes filters and colours changed by hand"
              onClick={(e) => {
                e.preventDefault();
                applyPreset(chosen);
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

/** The parts of the bar (Look at), one section each, the one looked at open and first. In All, the shared parts (e.g.
 *  Physics) are open and the detector's folded (with no shared part, all open). Each says whether the view draws it:
 *  a shared part is drawn over another part's view with its overlay. */
function Parts({ names, layers }: { names: string[]; layers: DisplayLayer[] }) {
  const current = domain.value,
    order = [...names.filter((n) => n === current), ...names.filter((n) => n !== current)];
  return (
    <>
      {order.map((name) => {
        const here = name === current,
          over = !here && !!current && shared.value.has(name) && overlay.value,
          drawn = here || !current || over;
        const own = layers.filter((d) => d.domain === name);
        return (
          <details
            class="part"
            open={here || (!current && (shared.value.has(name) || !names.some((n) => shared.value.has(n))))}
            key={`${bundleName.value}|${name}|${current}`}
          >
            <summary>
              <TickAll layers={own} name={`collections of ${name}, of every kind`} />
              <b>{name}</b>{" "}
              <span
                class="muted"
                title={
                  drawn
                    ? here
                      ? "Drawn: the part looked at"
                      : over
                        ? "Drawn over this view (its overlay is on)"
                        : "Drawn in All"
                    : "Not drawn in this view: drawn when it is looked at (show, or D), and its objects for a selection"
                }
              >
                {drawn ? (here ? "looked at" : over ? "drawn over" : "drawn") : "not in this view"}
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
            <Collections key={`${bundleName.value}|${name}`} layers={own} />
          </details>
        );
      })}
    </>
  );
}
