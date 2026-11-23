// The top bar: the data set chooser, the event's navigation (with a box to jump to an event), the parts of the
// detector (or the views), the menu of every control, and the actions (show everything, share, help).
import logo from "../../../logo.svg";
import { type Domain, kindName } from "../../io/format";
import {
  bundle,
  dialog,
  domain,
  event,
  eventIndex,
  largestFirst,
  layerKey,
  loading,
  opening,
  selection,
  showEvent,
  shownEntry,
  stepEvent,
  toast,
  touring,
  visible,
} from "../../model/store";
import { Chooser } from "./Chooser";
import { findEvent, findObjects, parseEventId } from "../../model/event/find";
import { Menu } from "./Menu";
import { chooseDomain, showWhole } from "../../control/navigate";
import { share } from "./Share";
import { stopTour, toggleTour } from "../../control/tour";
import { Views } from "../viewport/Viewport";
import { Icon } from "../common/widgets";

export function Header() {
  // The event named is the one shown (store/data.ts shownEntry). While another data set opens, the one on screen stays
  // whole, its event included, until the new one's first event is read (store/open.ts openBundle).
  const b = bundle.value,
    e = shownEntry.value;
  // An event, else objects of the event shown: the largest of them is selected.
  const find = (value: string) => {
    const id = parseEventId(value);
    if (id) {
      const i = b ? findEvent(b.events, id) : -1;
      if (i >= 0) void showEvent(i);
      else toast(`Event ${value} is not in this file`, "error");
      return;
    }
    const ev = event.value;
    if (!b || !ev || !value) return;
    const ticked = visible.value,
      layers = b.header.display.filter((d) => !d.truth && !d.context),
      found = findObjects(value, [...layers.filter((d) => ticked[layerKey(d)]), ...layers], ev.tables);
    if (typeof found === "string") return toast(found, "error");
    const { layer, rows, where } = found,
      kind = kindName(layer).toLowerCase(),
      one = kind.replace(/ices$/, "ex").replace(/([^s])s$/, "$1"), // "jets" -> "jet", "vertices" -> "vertex"
      cond = where ? ` with ${where}` : "";
    selection.value = { table: layer.table, row: largestFirst(layer.table, rows)[0] };
    toast(rows.length === 1 ? `1 ${one}${cond}: selected` : `${rows.length} ${kind}${cond}: the largest is selected`);
  };
  const parts = (b?.header.domains?.length ?? 0) >= 2; // the domain bar takes the views' place, which go on the canvas

  return (
    <header
      class={parts ? "topbar parts" : "topbar"} // a touch here stops the tour, but on its own button and the menu (whose items do)
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest(".tour-button, .menu")) stopTour();
      }}
    >
      <div class="brand">
        <img src={logo} alt="" width={22} height={22} />
        Ember
      </div>
      <Chooser />
      <nav class="eventnav" aria-label="Event navigation" inert={!b}>
        <button class="icon-button" title="Previous event (←)" onClick={() => stepEvent(-1)}>
          <Icon name="prev" />
        </button>
        <div class="eventid">
          <strong>
            {e
              ? `Run ${e.run} · LS ${e.lumi} · Event ${e.event}`
              : opening.value || loading.value
                ? "Opening…"
                : "No event"}
          </strong>
          <small>
            {b && e
              ? `${b.runTitle(e.run) ? `${b.runTitle(e.run)} · ` : ""}${eventIndex.value + 1} of ${b.events.length}`
              : b
                ? `${b.events.length.toLocaleString()} events`
                : ""}
          </small>
        </div>
        <button class="icon-button" title="Next event (→)" onClick={() => stepEvent(1)}>
          <Icon name="next" />
        </button>
        <button
          class={touring.value ? "icon-button tour-button on" : "icon-button tour-button"}
          title={
            touring.value
              ? "Stop the tour (P)"
              : "Tour: build each event up from the collision point to the physics objects (P)"
          }
          aria-pressed={touring.value}
          onClick={toggleTour}
        >
          <Icon name={touring.value ? "pause" : "play"} />
        </button>
        <input
          class="jump"
          placeholder="Event or object…"
          title="Go to an event (run:lumi:event, run:event or the event number), or find objects of this one: a kind, then optionally a condition on its columns (electron, jet pt > 50)"
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              find((ev.target as HTMLInputElement).value.trim());
              (ev.target as HTMLInputElement).blur();
            }
          }}
        />
      </nav>
      {!parts && <Views />}
      <Domains />
      <Menu />
      <div class="actions">
        <button class="icon-button" title="Show the whole event (Home)" onClick={() => showWhole()}>
          <Icon name="reset" />
        </button>
        <button class="icon-button share" title="Copy a link to this view" onClick={share}>
          <Icon name="share" />
        </button>
        <button class="icon-button" title="Help (?)" onClick={() => (dialog.value = "help")}>
          <Icon name="help" />
        </button>
      </div>
      {(loading.value || opening.value) && <div class="progress" />}
    </header>
  );
}

/** <domain> · <domain> · All: look at one part of the detector (its layers, region and view), or at everything. Below
 *  1100 px wide, a drop-down list instead (CSS shows one of the two). */
function Domains() {
  const list = bundle.value?.header.domains ?? [];
  if (list.length < 2) return null;
  const current = domain.value,
    ALL = "";
  const tip = (d: Domain) =>
    d.shared
      ? `${d.name}: its layers only, which the other parts draw as an overlay when asked (D)`
      : `${d.name}: its layers, in its region and view (D)`;
  return (
    <div class="domainbar">
      <span class="barlabel" aria-hidden="true">
        Look at
      </span>
      <div class="segmented domains" role="group" aria-label="Detector part">
        {list.map((d) => (
          <button class={current === d.name ? "on" : ""} title={tip(d)} onClick={() => chooseDomain(d.name)}>
            {d.name}
          </button>
        ))}
        <button
          class={current ? "" : "on"}
          title="Everything (D cycles through the parts, Shift+D backwards)"
          onClick={() => chooseDomain(null)}
        >
          All
        </button>
      </div>
      <select
        class="domainlist"
        aria-label="Detector part"
        title="Part of the detector (D, Shift+D)"
        value={current ?? ALL}
        onChange={(e) => chooseDomain((e.target as HTMLSelectElement).value || null)}
      >
        {list.map((d) => (
          <option value={d.name}>{d.name}</option>
        ))}
        <option value={ALL}>All</option>
      </select>
    </div>
  );
}
