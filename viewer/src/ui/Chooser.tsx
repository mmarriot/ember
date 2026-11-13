// The data set chooser of the top bar: a button naming the data set open, and a panel with what it is, a filter and
// the lists to choose from: my files (published with `evd file.root`), the ones opened lately from links, and the
// site's shared ones by group. The filter keeps the focus; ↑ ↓ move along the rows, Enter opens, Esc closes.
import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { agoText, DOCS_URL, expiryText, forgetLogin, forgetRecent, type Listed, login, matches, mine, ownerOf, PUBLISH_COMMAND, recent, recentShown, refreshMine, typeLogin } from "../model/library";
import { bundle, bundleName, catalogue, openBundle, opened, opening, openLocal, refreshCatalogue } from "../model/store";
import { stopLive } from "./live";
import { Icon } from "./widgets";

/** Open or closed; the start panels open it too (ui/Start.tsx). */
export const chooserOpen = signal(false);

interface Row { file: string; title: string; note: string; local?: boolean; forget?: () => void }
interface Section { name: string; rows: Row[]; mine?: boolean }

const SHARED = "Shared data sets"; // the site's data sets that name no group

/** "50 events · expires in 12 days": what the title does not already say. */
function noteOf(x: Listed, now: Date): string {
  const events = x.events !== undefined && !x.title.includes(`${x.events} events`) ? `${x.events.toLocaleString()} events` : "";
  return [events, expiryText(x.expires, now)].filter(Boolean).join(" · ");
}

/** The lists, each without the rows the filter leaves out; my files first, then the recent ones, then the site's
 *  groups in the order of its index (newest data first). */
function sections(filter: string, now: Date): Section[] {
  const shared = catalogue.value.bundles, own = mine.value;
  const keep = <T extends { title: string; file: string }>(list: T[]) => (filter.trim() ? list.filter((x) => matches(filter.trim(), x)) : list);
  const groups = new Map<string, Listed[]>();
  for (const x of keep(shared)) { const g = x.campaign_title ?? x.campaign ?? SHARED; groups.set(g, [...(groups.get(g) ?? []), x]); }
  const lately = recentShown(recent.value, [...shared, ...own].map((x) => x.file));
  return [
    { name: "My files", mine: true, rows: keep(own).map((x) => ({ file: x.file, title: x.title, note: noteOf(x, now) })) },
    { name: "Recent", rows: keep(lately).map((r) => ({
      file: r.file, title: r.title, local: r.local, forget: () => forgetRecent(r.file),
      note: r.local ? "a local file: drop it on the page to open it again" : [ownerOf(r.file) && `from ${ownerOf(r.file)}`, `opened ${agoText(r.time, now)}`].filter(Boolean).join(" · "),
    })) },
    ...[...groups].map(([name, list]) => ({ name, rows: list.map((x) => ({ file: x.file, title: x.title, note: noteOf(x, now) })) })),
  ];
}

export function Chooser() {
  const ref = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), open = chooserOpen.value;
  useEffect(() => { // a press outside closes it
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) chooserOpen.value = false; };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const o = opened.value, busy = opening.value;
  const label = busy && !o ? "Opening…" : o ? o.title : "Choose a data set";
  return (
    <div class="chooser" ref={ref}>
      <button ref={button} class={open ? "dataset on" : "dataset"} aria-haspopup="dialog" aria-expanded={open}
        title={o ? `Data set: ${o.title}${o.local ? " (a local file)" : ""}. Click to choose another` : "Choose a data set"} onClick={() => (chooserOpen.value = !open)}>
        <span class="name">{label}</span>{o?.local && <span class="tag">local</span>}<span class="caret" aria-hidden="true">▾</span>
      </button>
      {open && <Panel close={() => { chooserOpen.value = false; button.current?.focus(); }} />}
    </div>
  );
}

function Panel({ close }: { close: () => void }) {
  const [filter, setFilter] = useState(""), now = new Date();
  const list = sections(filter, now), rows = list.flatMap((s) => s.rows);
  const first = () => Math.max(0, rows.findIndex((r) => !r.local));
  // The row the keys act on: the data set open when the panel opens, the first one once a filter is typed.
  const [active, setActive] = useState(() => { const i = rows.findIndex((r) => r.file === bundleName.value && !r.local); return i >= 0 ? i : first(); });
  if (rows.length && active >= rows.length) setActive(rows.length - 1); // a list got shorter under it
  const input = useRef<HTMLInputElement>(null), scroller = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null);
  // The focus goes to the filter as the panel appears, not a frame later: keys pressed at once (↓, a first letter)
  // are the panel's, and a field clicked meanwhile keeps the focus.
  useLayoutEffect(() => input.current?.focus(), []);
  useEffect(() => { void refreshCatalogue(); void refreshMine(); }, []); // the lists as they are now
  useEffect(() => { scroller.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const pick = (row: Row | undefined) => {
    if (!row || row.local) return;
    stopLive(); // Live would open the newest file over the one chosen
    close();
    if (row.file !== bundleName.value || !bundle.value) void openBundle(row.file);
  };
  const step = (d: number) => { // to the next row that can be opened, stopping at the ends
    for (let i = active + d; i >= 0 && i < rows.length; i += d) if (!rows[i].local) return setActive(i);
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // the view's keys (arrows, letters) are not for a panel being typed in
    if (e.key === "Escape") return close();
    if (e.target !== input.current) return;
    if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (e.key === "Enter") { e.preventDefault(); pick(rows[active]); }
    else if (e.key === "Delete" && rows[active]?.forget) { e.preventDefault(); rows[active].forget!(); }
  };

  let i = 0; // rows are numbered through the sections, as the keys walk them
  const filtering = !!filter.trim(), nothing = filtering && !rows.length;
  return (
    <div class="chooserpanel" role="dialog" aria-label="Choose a data set" onKeyDown={onKey}>
      <About />
      <input ref={input} class="filter" type="search" role="combobox" aria-expanded="true" aria-controls="datasets" aria-autocomplete="list"
        aria-activedescendant={rows.length ? `dataset-${active}` : undefined} placeholder="Filter data sets…" aria-label="Filter data sets" value={filter}
        onInput={(e) => { setFilter((e.target as HTMLInputElement).value); setActive(0); }} />
      <div class="datasets" id="datasets" role="listbox" aria-label="Data sets" ref={scroller}>
        {list.map((s) => (s.rows.length || (s.mine && !filtering)) ? (
          <div role="group" aria-label={s.name}>
            <div class="sectionhead">
              <span>{s.name}{s.mine && login.value ? ` · ${login.value.name}` : ""}</span>
              {s.mine && login.value?.from === "typed" && <button class="link" title="Forget this login in this browser" onClick={() => forgetLogin()}>not you?</button>}
              {s.rows.length > 0 && <span class="count">{s.rows.length}</span>}
            </div>
            {s.mine && !s.rows.length && <Mine />}
            {s.rows.map((row) => {
              const at = i++, current = row.file === bundleName.value && !row.local && !!opened.value && !opened.value.local;
              return (
                <div role="option" id={`dataset-${at}`} data-i={at} aria-selected={at === active} aria-disabled={row.local || undefined} aria-current={current || undefined}
                  class={`dataset-row${at === active ? " active" : ""}${row.local ? " off" : ""}`} title={row.local ? row.note : row.file}
                  onPointerMove={() => !row.local && setActive(at)} onClick={() => pick(row)}>
                  <span class="tick" aria-hidden="true">{current ? "✓" : ""}</span>
                  <span class="what"><span class="title">{row.title}</span>{row.note && <small>{row.note}</small>}</span>
                  {row.forget && <button class="icon-button small" title="Remove from the recent ones (Delete)" tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); row.forget!(); setActive(Math.min(at, rows.length - 2)); input.current?.focus(); }}><Icon name="close" /></button>}
                </div>
              );
            })}
          </div>
        ) : null)}
        {nothing && <p class="hint none">No data set matches “{filter.trim()}”.</p>}
        {!filtering && !rows.length && !catalogue.value.bundles.length && <p class="hint none">This site has no shared data sets yet.</p>}
      </div>
      <footer>
        <button class="link" onClick={() => file.current?.click()}>Open a local file…</button>
        <input ref={file} type="file" accept=".evdb" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) { stopLive(); close(); void openLocal(f); } }} />
        <a class="link" href={DOCS_URL} target="_blank" rel="noopener">How to add data ↗</a>
      </footer>
    </div>
  );
}

/** My files, while there are none to list: who am I (asked once, where the site does not say), or how files get here. */
function Mine() {
  const [text, setText] = useState(""), [bad, setBad] = useState(false);
  if (login.value) return <p class="hint none">Nothing published yet: <code>{PUBLISH_COMMAND}</code> converts a file and lists it here.</p>;
  const submit = (e: Event) => {
    e.preventDefault();
    if (typeLogin(text)) void refreshMine();
    else setBad(true);
  };
  return (
    <form class="whoami" onSubmit={submit}>
      <label for="cern-login">Files you publish with <code>{PUBLISH_COMMAND}</code> are listed here. Your CERN login:</label>
      <div>
        <input id="cern-login" value={text} placeholder="e.g. jsmith" autocomplete="username" spellcheck={false} aria-invalid={bad}
          onInput={(e) => { setText((e.target as HTMLInputElement).value); setBad(false); }} />
        <button type="submit">Show my files</button>
      </div>
      {bad && <p class="hint error" role="alert">That is not a CERN login: letters, digits, - and _ only.</p>}
    </form>
  );
}

const when = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

/** What is known about the data set open: one line, and on request where it comes from. */
export function provenance(now = new Date()): [string, string][] {
  const o = opened.value, b = bundle.value;
  if (!o || !b) return [];
  const src = b.header.source, owner = o.local ? null : ownerOf(o.file);
  const rows: [string, string | undefined | null | false][] = [
    ["Events", b.events.length.toLocaleString()],
    ["Published by", owner],
    ["Published", !o.local && when(o.entry?.created)],
    ["Expires", o.entry?.expires && `${when(o.entry.expires)} (${expiryText(o.entry.expires, now).replace(/^expires /, "")})`],
    ["Converted", when(src.created)],
    ["Converter", src.converter],
    ["CMSSW", src.cmssw],
    ["Profile", b.header.profile],
    ["From", src.files.join(", ")],
    ["File", o.local ? `${o.file} (on this computer)` : o.file],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

function About() {
  const o = opened.value, b = bundle.value, [more, setMore] = useState(false);
  if (!o || !b) return null;
  const owner = o.local ? null : ownerOf(o.file), expiry = expiryText(o.entry?.expires);
  const line = [`${b.events.length.toLocaleString()} events`, o.local ? "a local file" : owner ? `published by ${owner}` : "", expiry].filter(Boolean).join(" · ");
  return (
    <div class="about">
      <div class="open"><b title={o.title}>{o.title}</b><button class="link" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Less" : "Details"}</button></div>
      <small>{line}</small>
      {more && <table class="kv prov"><tbody>{provenance().map(([k, v]) => <tr><td>{k}</td><td>{v}</td></tr>)}</tbody></table>}
    </div>
  );
}
