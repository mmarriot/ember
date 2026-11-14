// Top bar: data set, event navigation (with jump-to), the parts of the detector (or the view switcher), the menu of
// every control, share and help.
import { signal } from "@preact/signals";
import logo from "../../logo.svg";
import { type Domain, kindName } from "../io/format";
import { DOCS_URL, expiryText, ownerOf, PUBLISH_COMMAND } from "../model/library";
import {
  activeMode,
  bundle,
  catalogue,
  dialog,
  domain,
  eventIndex,
  following,
  layerOf,
  loading,
  opened,
  opening,
  selection,
  showEvent,
  shownEntry,
  shownLevel,
  solo,
  stepEvent,
  toast,
  touring,
  view,
} from "../model/store";
import { Chooser } from "./Chooser";
import { togglePopover } from "./Info";
import { toggleLive } from "./live";
import { Menu } from "./Menu";
import { chooseDomain, showWhole } from "./navigate";
import { stopTour, toggleTour } from "./tour";
import { VIEWS, Views } from "./Viewport";
import { Icon } from "./widgets";

/** Whether the link of the open share pop-up reached the clipboard ("": not known yet). */
const copied = signal<"" | "yes" | "no">("");

/** The share button: copy the link to this view, and say what it is a link to (or why a local file has none). The
 *  pop-up describes the link it holds: both are taken at the click, so it stays true to its link if the view moves on
 *  while it is open. */
function share(e: Event) {
  const o = opened.peek(),
    link = location.href;
  if (!o) return toast("Open a data set first: the link is to what is on screen");
  copied.value = "";
  const snapshot = {
    link,
    opens: captured(),
    owner: ownerOf(o.file),
    expiry: expiryText(o.entry?.expires),
    external: o.external,
  };
  togglePopover(
    e,
    () => (o.local ? <NoLink name={o.title} /> : <ShareLink {...snapshot} />),
    o.local ? "A local file has no link" : "Link to this view",
  );
  if (o.local) return;
  const failed = () => (copied.value = "no"); // no clipboard here (not a secure page, or not allowed): the link is there to copy
  if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => (copied.value = "yes"), failed);
  else failed();
}

/** What the link opens, in the reader's words: each part of the view that the address keeps. */
function captured(): string[] {
  const b = bundle.peek(),
    o = opened.peek(),
    e = shownEntry.peek(),
    s = selection.peek();
  if (!b || !o || !e) return o ? [o.title] : [];
  const layer = s && layerOf(s.table),
    parts = (b.header.domains?.length ?? 0) >= 2,
    level = shownLevel.peek();
  return [
    o.title,
    `event ${eventIndex.peek() + 1} of ${b.events.length} (run ${e.run}, event ${e.event})`,
    parts ? (domain.peek() ? `the ${domain.peek()} part of the detector` : "every part of the detector") : "",
    `the ${VIEWS.find(([v]) => v === view.peek())?.[1] ?? view.peek()} view`,
    solo.peek() ? `only the ${solo.peek()!.split("|").filter(Boolean).reverse().join(" · ")}` : "",
    s ? `the selected ${layer ? kindName(layer) : s.table} #${s.row}${level ? `, down to its ${level}` : ""}` : "",
    activeMode.peek() === "truth" ? "truth colours" : "",
  ].filter(Boolean);
}

function ShareLink({
  link,
  opens,
  owner,
  expiry,
  external,
}: {
  link: string;
  opens: string[];
  owner: string | null;
  expiry: string;
  external: boolean;
}) {
  return (
    <div class="sharepop">
      <input
        readOnly
        value={link}
        aria-label="Link to this view"
        onFocus={(e) => (e.target as HTMLInputElement).select()}
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
      <p class={copied.value === "yes" ? "status ok" : "status"} role="status">
        {copied.value === "yes"
          ? "✓ Copied: paste it anywhere"
          : copied.value === "no"
            ? "Select it and copy (Ctrl+C): this page may not use the clipboard"
            : " "}
      </p>
      <p>
        {external
          ? "It opens, for whoever can open this site and can also reach the data set's own address:"
          : "It opens, for anyone who can open this site:"}
      </p>
      <ul>
        {opens.map((c) => (
          <li>{c}</li>
        ))}
      </ul>
      <p class="hint">
        Cuts, ticked collections and the camera are not part of it.
        {external &&
          " The data set is not on this site: it is read from the address in the link, for as long as that address serves it."}
        {owner && ` The link works while ${owner}'s file is on the site${expiry ? ` (it ${expiry})` : ""}.`}
      </p>
    </div>
  );
}

const NoLink = ({ name }: { name: string }) => (
  <div class="sharepop">
    <p>
      <b>{name}</b> is read from your computer: a link to it would open nothing for anyone else.
    </p>
    <p>
      To share it, publish the file it was converted from: <code>{PUBLISH_COMMAND}</code> puts it on this site and
      prints a link.
    </p>
    <p>
      <a class="link" href={DOCS_URL} target="_blank" rel="noopener">
        How to publish ↗
      </a>
    </p>
  </div>
);

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
