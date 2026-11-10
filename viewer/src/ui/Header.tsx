// Top bar: data set, event navigation (with jump-to), view switcher, share and help.
import logo from "../../logo.svg";
import type { ViewName } from "../render/engine";
import { bundle, bundleName, catalogue, dialog, eventIndex, following, loading, openBundle, showEvent, theme, toast, toggleTheme, touring, view, type Listed } from "../model/store";
import { toggleLive } from "./live";
import { toggleTour } from "./tour";
import { engine } from "./Viewport";
import { Icon } from "./widgets";

const VIEWS: [ViewName, string, string][] = [["3d", "3D", "1"], ["front", "Front", "2"], ["side", "Side", "3"], ["rz", "ρ–z", "4"]];

export function Header() {
  const b = bundle.value, e = b?.events[eventIndex.value], bundles = catalogue.value.bundles;
  const campaigns = new Map<string, Listed[]>();
  for (const x of bundles) { const c = x.campaign_title ?? x.campaign ?? ""; campaigns.set(c, [...(campaigns.get(c) ?? []), x]); }
  const jump = (value: string) => {
    const [run, ev] = value.includes(":") ? value.split(":").map(Number) : [undefined, Number(value)];
    const i = b?.events.findIndex((x) => x.event === ev && (run === undefined || x.run === run)) ?? -1;
    if (i >= 0) showEvent(i);
    else toast(`Event ${value} is not in this file`, "error");
  };
  const share = async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link to this view copied"); }
    catch { toast("Copy the address bar to share this view"); }
  };

  return (
    <header class="topbar">
      <div class="brand"><img src={logo} alt="" width={22} height={22} />Event display</div>
      <select class="dataset" value={bundleName.value} title="Data set" onChange={(ev) => openBundle((ev.target as HTMLSelectElement).value)}>
        {[...campaigns].map(([c, list]) => (c ? <optgroup label={c}>{list.map((x) => <option value={x.file}>{x.title}</option>)}</optgroup>
          : list.map((x) => <option value={x.file}>{x.title}</option>)))}
        {bundleName.value && !bundles.some((x) => x.file === bundleName.value) && <option value={bundleName.value}>{bundleName.value}</option>}
      </select>
      <nav class="eventnav" aria-label="Event navigation">
        <button class="icon-button" title="Previous event (←)" onClick={() => showEvent(eventIndex.value - 1)}><Icon name="prev" /></button>
        <div class="eventid">
          <strong>{e ? `Run ${e.run} · Event ${e.event}` : "No event"}</strong>
          <small>{b && e && b.runTitle(e.run) ? `${b.runTitle(e.run)} · ` : ""}{b ? `${eventIndex.value + 1} of ${b.events.length}` : ""}</small>
        </div>
        <button class="icon-button" title="Next event (→)" onClick={() => showEvent(eventIndex.value + 1)}><Icon name="next" /></button>
        <button class={touring.value ? "icon-button on" : "icon-button"} title={touring.value ? "Stop the tour (P)" : "Tour: orbit each event and visit its main showers (P)"}
          aria-pressed={touring.value} onClick={toggleTour}><Icon name={touring.value ? "pause" : "play"} /></button>
        <input class="jump" placeholder="Go to event…" title="Event number, or run:event" onKeyDown={(ev) => {
          if (ev.key === "Enter") { jump((ev.target as HTMLInputElement).value.trim()); (ev.target as HTMLInputElement).blur(); }
        }} />
      </nav>
      <div class="segmented" role="group" aria-label="View">
        {VIEWS.map(([v, name, key]) => (
          <button class={view.value === v ? "on" : ""} title={`${name} view (${key})`} onClick={() => (view.value = v)}>{name}</button>
        ))}
      </div>
      <button class={following.value ? "live on" : "live"} aria-pressed={following.value} onClick={toggleLive}
        title={`Live: play new data as it arrives, event by event${catalogue.value.updated ? `; index updated ${new Date(catalogue.value.updated).toLocaleString()}` : ""}`}>
        <i class="dot" />Live
      </button>
      <div class="actions">
        <button class="icon-button" title="Show the whole event (Home)" onClick={() => engine?.frame(undefined, true)}><Icon name="reset" /></button>
        <button class="icon-button" title="Copy a link to this view" onClick={share}><Icon name="share" /></button>
        <button class="icon-button" title={theme.value === "dark" ? "Light theme" : "Dark theme"} onClick={toggleTheme}><Icon name={theme.value === "dark" ? "sun" : "moon"} /></button>
        <button class="icon-button" title="Help (?)" onClick={() => (dialog.value = "help")}><Icon name="help" /></button>
      </div>
      {loading.value && <div class="progress" />}
    </header>
  );
}
