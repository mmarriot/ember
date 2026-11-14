// The top bar: the data set chooser, the event's navigation (with a box to jump to an event), the parts of the
// detector (or the views), Live, the menu of every control, and the actions (show everything, share, help).
import logo from "../../logo.svg";
import { type Domain } from "../io/bundle";
import {
  bundle,
  catalogue,
  dialog,
  domain,
  eventIndex,
  following,
  loading,
  opening,
  showEvent,
  shownEntry,
  stepEvent,
  toast,
  touring,
} from "../model/store";
import { Chooser } from "./Chooser";
import { toggleLive } from "./live";
import { Menu } from "./Menu";
import { chooseDomain, showWhole } from "./navigate";
import { share } from "./Share";
import { stopTour, toggleTour } from "./tour";
import { Views } from "./Viewport";
import { Icon } from "./widgets";

export function Header() {
  // The event named is the one shown (store.ts shownEntry): a data set just opened says "Opening…" until its event
  // is read, not the name of the event its index pointed at in the data set before.
  const b = bundle.value,
    e = shownEntry.value;
  const jump = (value: string) => {
    const [run, ev] = value.includes(":") ? value.split(":").map(Number) : [undefined, Number(value)];
    const i = b?.events.findIndex((x) => x.event === ev && (run === undefined || x.run === run)) ?? -1;
    if (i >= 0) showEvent(i);
    else toast(`Event ${value} is not in this file`, "error");
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
        Event display
      </div>
      <Chooser />
      <nav class="eventnav" aria-label="Event navigation" inert={!b}>
        <button class="icon-button" title="Previous event (←)" onClick={() => stepEvent(-1)}>
          <Icon name="prev" />
        </button>
        <div class="eventid">
          <strong>
            {e ? `Run ${e.run} · Event ${e.event}` : opening.value || loading.value ? "Opening…" : "No event"}
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
          placeholder="Event…"
          title="Event number, or run:event"
          onKeyDown={(ev) => {
            if (ev.key === "Enter") {
              jump((ev.target as HTMLInputElement).value.trim());
              (ev.target as HTMLInputElement).blur();
            }
          }}
        />
      </nav>
      {!parts && <Views />}
      <Domains />
      <button
        class={following.value ? "live on" : "live"}
        aria-pressed={following.value}
        onClick={toggleLive}
        title={`Live: play new data as it arrives, event by event${catalogue.value.updated ? `; index updated ${new Date(catalogue.value.updated).toLocaleString()}` : ""}`}
      >
        <i class="dot" />
        Live
      </button>
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
      ? `${d.name}: its layers only, which every part of the detector also draws (D)`
      : `${d.name}: its layers and those shared by every part, in its region and view (D)`;
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
