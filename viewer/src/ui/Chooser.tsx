// The data set chooser of the top bar: a button naming the data set open, and a panel with what it is, a filter and
// the lists to choose from: my files (published with `evd file.root`), the ones opened lately from links, and the
// site's shared ones by group. The filter keeps the focus; ↑ ↓ move along the rows, Enter opens, Esc closes.
import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { provenance, summary } from "../model/about";
import { agoText, DOCS_URL, expiryText, forgetLogin, forgetRecent, type Listed, login, matches, mine, mineUnread, ownerOf, PUBLISH_COMMAND, recent, recentShown, refreshMine, typeLogin } from "../model/library";
import { bundle, bundleName, catalogue, openBundle, opened, opening, openLocal, refreshCatalogue } from "../model/store";
import { stopLive } from "./live";
import { Icon } from "./widgets";

/** Open or closed; the start panels open it too (ui/Start.tsx). */
export const chooserOpen = signal(false);

/** Ask for a file of this computer and open it (the chooser's "Open a local file…" and the start panel's). */
export function pickLocalFile() {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: ".evdb" });
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    stopLive(); // Live would open the newest file over this one
    chooserOpen.value = false;
    void openLocal(file);
  };
  input.click();
}

interface Row { file: string; title: string; note: string; local?: boolean; forget?: () => void }
interface Section { name: string; rows: Row[]; mine?: boolean }

const SHARED = "Shared data sets"; // the site's data sets that name no group

/** "50 events · expires in 12 days": what the title does not already say. */
function noteOf(x: Listed, now: Date): string {
  const events = typeof x.events === "number" && !x.title.includes(`${x.events} events`) ? `${x.events.toLocaleString()} events` : "";
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
  // And so does the focus going elsewhere (Tab past its last link): a panel left open over the view, with the keys
  // back at the view, is in the way. A press on the panel's own background moves the focus nowhere, and keeps it.
  const onFocusOut = (e: FocusEvent) => { if (e.relatedTarget instanceof Node && !ref.current?.contains(e.relatedTarget)) chooserOpen.value = false; };
  const o = opened.value, busy = opening.value;
  const label = busy && !o ? "Opening…" : o ? o.title : "Choose a data set";
  const kind = o?.local ? "local" : o?.external ? "external" : null;
  return (
    <div class="chooser" ref={ref} onFocusOut={onFocusOut}>
      <button ref={button} class={open ? "dataset on" : "dataset"} aria-haspopup="dialog" aria-expanded={open}
        title={o ? `Data set: ${o.title}${o.local ? " (a local file)" : o.external ? " (not on this site)" : ""}. Click to choose another` : "Choose a data set"} onClick={() => (chooserOpen.value = !open)}>
        <span class="name">{label}</span>{kind && <span class="tag">{kind}</span>}<span class="caret" aria-hidden="true">▾</span>
      </button>
      {open && <Panel close={() => { chooserOpen.value = false; button.current?.focus(); }} />}
    </div>
  );
}

function Panel({ close }: { close: () => void }) {
  const [filter, setFilter] = useState(""), now = new Date();
  // The lists are checked where they are read (library.ts cleanList); should building the rows fail all the same, the
  // panel still comes up, with the login and the way out of it ("not you?"), rather than not at all.
  let list: Section[];
  try { list = sections(filter, now); } catch (e) { console.error(e); list = [{ name: "My files", mine: true, rows: [] }]; }
  const rows = list.flatMap((s) => s.rows);
  const first = () => rows.findIndex((r) => !r.local);
  // The row the keys act on: the data set open when the panel opens, the first one once a filter is typed; never one
  // that cannot be opened (a local file's), never past the end of a list that got shorter; none (-1) when no row can
  // be opened.
  const [chosen, setActive] = useState(() => { const i = rows.findIndex((r) => r.file === bundleName.value && !r.local); return i >= 0 ? i : first(); });
  const active = rows[chosen] && !rows[chosen].local ? chosen : first();
  const input = useRef<HTMLInputElement>(null), scroller = useRef<HTMLDivElement>(null);
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
    // (from no row, ↓ starts at the top; ↑ stays)
  };
  const forget = (at: number) => { rows[at].forget!(); setActive(Math.max(0, Math.min(at, rows.length - 2))); input.current?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // the view's keys (arrows, letters) are not for a panel being typed in
    if (e.key === "Escape") return close();
    if (e.target !== input.current) return;
    if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (e.key === "Enter") { e.preventDefault(); pick(rows[active]); }
    // Delete forgets the recent row only with nothing typed: in a filter it deletes a character, as in any text field.
    else if (e.key === "Delete" && !filter && rows[active]?.forget) { e.preventDefault(); forget(active); }
  };

  let i = 0; // rows are numbered through the sections, as the keys walk them
  const filtering = !!filter.trim(), nothing = filtering && !rows.length;
  const shown = list.filter((s) => s.rows.length || (s.mine && !filtering));
  return (
    <div class="chooserpanel" role="dialog" aria-label="Choose a data set" onKeyDown={onKey}>
      <About />
      <input ref={input} class="filter" type="search" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={shown.map((_, k) => `datasets-${k}`).join(" ")}
        aria-activedescendant={active >= 0 ? `dataset-${active}` : undefined} placeholder="Filter data sets…" aria-label="Filter data sets" value={filter}
        onInput={(e) => { setFilter((e.target as HTMLInputElement).value); setActive(0); }} />
      <div class="datasets" ref={scroller}>
        {shown.map((s, k) => (
          <section>
            <div class="sectionhead">
              <span id={`datasets-head-${k}`}>{s.name}{s.mine && login.value ? ` · ${login.value.name}` : ""}</span>
              {s.mine && login.value?.from === "typed" && <button class="link" title="Forget this login in this browser" onClick={() => forgetLogin()}>not you?</button>}
              {s.rows.length > 0 && <span class="count">{s.rows.length}</span>}
            </div>
            {s.mine && !s.rows.length && <Mine />}
            {/* A list holds only its options: the heading, the login form and "not you?" are outside it. */}
            <div role="listbox" id={`datasets-${k}`} aria-labelledby={`datasets-head-${k}`}>
              {s.rows.map((row) => {
                const at = i++, current = row.file === bundleName.value && !row.local && !!opened.value && !opened.value.local;
                return (
                  <div role="option" id={`dataset-${at}`} data-i={at} aria-selected={at === active} aria-disabled={row.local || undefined} aria-current={current || undefined}
                    class={`dataset-row${at === active ? " active" : ""}${row.local ? " off" : ""}`} title={row.local ? row.note : row.file}
                    onMouseDown={(e) => e.preventDefault() /* the focus stays in the filter */} onPointerMove={() => !row.local && setActive(at)} onClick={() => pick(row)}>
                    <span class="tick" aria-hidden="true">{current ? "✓" : ""}</span>
                    <span class="what"><span class="title">{row.title}</span>{row.note && <small>{row.note}</small>}</span>
                    {row.forget && <button class="icon-button small" title="Remove from the recent ones (Delete, with no filter typed)" tabIndex={-1}
                      onClick={(e) => { e.stopPropagation(); forget(at); }}><Icon name="close" /></button>}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {nothing && <p class="hint none">No data set matches “{filter.trim()}”.</p>}
        {!filtering && !rows.length && !catalogue.value.bundles.length && <p class="hint none">This site has no shared data sets yet.</p>}
      </div>
      <footer>
        <button class="link" onClick={pickLocalFile}>Open a local file…</button>
        <a class="link" href={DOCS_URL} target="_blank" rel="noopener">How to add data ↗</a>
      </footer>
    </div>
  );
}

/** My files, while there are none to list: who am I (asked once, where the site does not say), or how files get here. */
function Mine() {
  const [text, setText] = useState(""), [bad, setBad] = useState(false);
  if (login.value) {
    return mineUnread.value ? <p class="hint none">Your files could not be listed just now: the site did not send your list. It is asked for again every half minute.</p>
      : <p class="hint none">Nothing published yet: <code>{PUBLISH_COMMAND}</code> converts a file and lists it here.</p>;
  }
  const submit = (e: Event) => {
    e.preventDefault();
    if (typeLogin(text)) void refreshMine();
    else setBad(true);
  };
  return (
    <form class="whoami" onSubmit={submit}>
      <label for="cern-login">Files you publish with <code>{PUBLISH_COMMAND}</code> are listed here. Your CERN login:</label>
      <div>
        <input id="cern-login" value={text} placeholder="e.g. jsmith" autocomplete="off" autocapitalize="off" spellcheck={false} aria-invalid={bad}
          onInput={(e) => { setText((e.target as HTMLInputElement).value); setBad(false); }} />
        <button type="submit">Show my files</button>
      </div>
      {bad && <p class="hint error" role="alert">That is not a CERN login: letters, digits, - and _ only.</p>}
    </form>
  );
}

/** What is known about the data set open: one line, and on request where it comes from. */
function About() {
  const o = opened.value, b = bundle.value, [more, setMore] = useState(false);
  if (!o || !b) return null;
  return (
    <div class="about">
      <div class="open"><b title={o.title}>{o.title}</b><button class="link" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Less" : "Details"}</button></div>
      <small>{summary(o, b)}</small>
      {more && <table class="kv prov"><tbody>{provenance(o, b).map(([k, v]) => <tr><td>{k}</td><td>{v}</td></tr>)}</tbody></table>}
    </div>
  );
}
