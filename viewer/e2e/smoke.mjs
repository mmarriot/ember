// Browser check (headless Chromium, software WebGL) of every bundle in the site's index.json, or of those named.
// Each: layers draw (helices end at finite points), a start domain opens, domains draw only their layers (and shared
// ones) and open their tab, labels show (L hides them) and N selects, object rows ring and select, D and the focus
// bar's chips keep the selection, the URL keeps the level and the truth colours, presets apply, a bundle with candidates has a colour key, T colours by generator particle where there is truth, summary charts show where the profile defines them,
// a selection draws its objects that a layer's filter hides and its levels of lines (a vertex's tracks),
// selecting an object shows what is related and only its bottom level (↓ ↑ step through the others), a related
// object can be jumped to and back, Esc leaves. One bundle (`--deep`, default the smallest with reconstruction
// stages) also gets: themes, help, a rotate drag keeping the selection, a custom column used for colour and a filter,
// the replay and the tour; the replay also for any bundle whose paths are built from their parts (`grow`: captions in order, paths complete by the fit). Any console error, or a bundle taking over BUNDLE_TIMEOUT (three times that for files over
// BIG_FILE or events over BIG_EVENT: software WebGL takes seconds per frame on their scenes, and clicks wait for frames), fails.
// Screenshots: <dir>/<bundle>_*.png (one small one for scenes over BIG objects). Progress: one timestamped line per step.
// Usage: node e2e/smoke.mjs <dev server URL> <screenshot dir> [--deep <bundle>] [bundle ...]  (dev builds expose the engine)
import { chromium } from "playwright";

const args = process.argv.slice(2), deepAt = args.indexOf("--deep");
const deepName = deepAt >= 0 ? args.splice(deepAt, 2)[1] : undefined;
const [base = "http://127.0.0.1:5173/", out = "e2e/shots", ...names] = args;
const files = names.length ? names : (await (await fetch(`${base}index.json`)).json()).bundles.map((b) => b.file);
const headers = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await header(f)])));
const deep = deepName ?? files.filter((f) => headers[f].display.some((d) => d.stage !== undefined)).sort((a, c) => headers[a].size - headers[c].size)[0];

const BUNDLE_TIMEOUT = 300_000, BIG_FILE = 500e6, BIG_EVENT = 10e6; // ms: a bundle not checked by then fails, and the run goes on with the next; bytes
/** A bundle whose events are big (PU200: ~30 MB each), however many it holds: software WebGL is slow on its scenes. */
const bigEvents = (h) => h.size > BIG_FILE || h.size / Math.max(1, h.events) > BIG_EVENT;
const BIG = 200_000; // objects drawn above which a bundle gets one small screenshot (software WebGL is slow)
const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const problems = [];
for (const file of files) {
  const tag = file.replace(/\.evdb$/, ""), t0 = Date.now(), state = { page: null };
  let timer;
  const result = await Promise.race([
    checkBundle(file, tag, state).then(() => "checked", (e) => `error: ${e.message.split("\n")[0]}`),
    new Promise((done) => { const ms = (bigEvents(headers[file]) ? 3 : 1) * BUNDLE_TIMEOUT; timer = setTimeout(() => done(`not finished after ${ms / 1000} s`), ms); }),
  ]);
  clearTimeout(timer);
  await state.page?.close().catch(() => {}); // also ends a check that timed out
  if (result !== "checked") problems.push(`${tag}: ${result}`);
  log(`${tag}: ${result} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
await browser.close();
console.log(problems.length ? `FAILED\n  ${problems.join("\n  ")}` : "ok");
process.exit(problems.length ? 1 : 0);

async function checkBundle(file, tag, state) {
  const h = headers[file], fail = (text) => problems.push(`${tag}: ${text}`);
  let page, small = false;
  const shot = async (name) => { // a record, not a check
    if (small && name !== "1_layers") return;
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${tag}_${name}.png`, timeout: 60000 }).catch(() => log(`${tag}: screenshot ${name} timed out`));
  };
  const open = async (hash, query = false) => { // a fresh page each time: software WebGL is slow to let go of a big scene
    await page?.close();
    page = state.page = await browser.newPage({ viewport: small ? { width: 720, height: 450 } : { width: 1440, height: 860 } });
    page.on("console", (m) => m.type() === "error" && fail(m.text()));
    page.on("pageerror", (e) => fail(e.message));
    await page.goto(`${base}${query ? "?" : "#"}${hash}`, { timeout: 90000 });
    await page.waitForSelector(".eventid strong:has-text('Event')", { timeout: 90000 });
    await page.waitForTimeout(1200);
  };

  await open(`b=${file}&e=1`);
  await checkStart(page, h, fail, tag);
  const [drawn, objects] = await page.evaluate(() => [window.evdEngine.layers.length, window.evdEngine.layers.reduce((s, l) => s + l.x.length, 0)]);
  const rows = await page.$$eval(".layer:not(.off) label", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  log(`${tag}: ${drawn} layers, ${objects} objects drawn: ${rows.join(" | ")}`);
  if (!drawn) fail("no layer drawn");
  // A big scene (or a big file, whose start view may be light, e.g. only the physics objects): software WebGL is too
  // slow for the replay and full-size screenshots.
  if ((small = objects > BIG || bigEvents(h))) await page.setViewportSize({ width: 720, height: 450 });
  await shot("1_layers");
  await checkHelices(page, fail, tag);
  await checkDomains(page, h, fail, shot, tag);
  await checkObjectRows(page, h, fail, shot, tag);

  for (const name of await page.$$eval(".segmented.presets button", (b) => b.map((x) => x.textContent))) {
    const button = page.locator(".segmented.presets button", { hasText: name });
    await button.click({ timeout: 120000 });
    if (!(await button.getAttribute("class"))?.includes("on")) fail(`preset ${name} did not apply`);
  }

  // With reconstruction stages (so candidates), the colour key under the tabs names the particle types.
  const tabs = await page.$$eval(".sidebar .tablist [role=tab]", (t) => t.map((x) => x.textContent));
  const keys = await page.locator(".colourkey .key li").count();
  log(`${tag}: tabs ${tabs.join(" | ")}; colour key: ${keys} entries`);
  if (h.display.some((d) => d.stage !== undefined) && keys < 2) fail("no colour key for the candidates");
  // With truth particles, T colours by generator particle and says so in the key's title; T again goes back.
  if (h.display.some((d) => d.truth && d.particle)) {
    const title = () => page.locator(".colourkey > summary").innerText().catch(() => "");
    await page.keyboard.press("t");
    await page.waitForTimeout(1500);
    const truthTitle = await title(), entries = await page.locator(".colourkey .key li").count();
    log(`${tag}: truth colours: "${truthTitle.split("\n")[0]}", ${entries} key entries`);
    if (!truthTitle.includes("generator particle") || entries < 3) fail(`T did not colour by generator particle (${truthTitle})`);
    if (!new URL(page.url()).hash.includes("c=truth")) fail("the truth colours are not in the URL (c=truth)");
    // Each kind's truth in one word on the side panel's headings; kinds without truth faint.
    const words = await page.locator(".sidebar .truthword").allInnerTexts(), faint = await page.locator(".sidebar .layer.faint").count();
    log(`${tag}: truth words ${[...new Set(words)].join(", ") || "none"}; ${faint} faint rows`);
    if (h.display.some((d) => d.truthGap) && !words.length) fail("no truth word on the side panel's kinds in the truth colours");
    await shot("1_truth");
    await page.keyboard.press("t");
    await page.waitForTimeout(1500);
    if ((await title()).includes("generator particle")) fail("T again did not go back to the reco colours");
  }
  if ((h.presets?.length ?? 0) > 1) await page.getByRole("group", { name: "Preset" }).getByRole("button").first().click({ timeout: 120000 }); // the default filters
  await checkFocusFilters(page, h, fail, tag);

  await page.getByRole("tab", { name: "Event", exact: true }).click();
  const charts = await page.locator(".bars").count(), run = await page.locator(".tabpanel section h3", { hasText: /^Run \d+/, hasNotText: "Lumi" }).count();
  log(`${tag}: ${charts} summary charts (profile defines ${h.summaries?.length ?? 0}), run information ${run ? "shown" : "none"}`);
  if (h.summaries?.length && !charts) fail("no summary charts");
  await shot("2_event");

  // Select an object that is made of others: from a relation into a drawn table, preferring later stages.
  const drawnTables = new Set(h.display.map((d) => d.table));
  const score = (d) => Object.values(h.relations).filter((r) => !r.association && r.from === d.table)
    .reduce((s, r) => Math.max(s, (drawnTables.has(r.to) ? 100 : 1) + (d.stage ?? 0)), 0);
  const target = h.display.filter((d) => d.visible && !d.context).sort((a, c) => score(c) - score(a))[0];
  if (!target || !score(target)) return log(`${tag}: nothing made of other objects to select`);
  const all = (h.domains?.length ?? 0) >= 2 ? "&d=All" : ""; // every level in the focus bar, as without domains
  await open(`b=${file}&e=1${all}&s=${target.table}:0`);
  const related = await page.locator(".inspector [role=tab]", { hasText: "Related" }).innerText().catch(() => "");
  if (!/Related · [1-9]/.test(related)) fail(`selecting ${target.table} #0 shows nothing related (${related})`);
  // In the "Particle type" mode a selection shows its truth <-> reco pair (a candidate, and its particle with truth).
  if (await page.locator(".colourkey").count()) {
    const pair = await page.locator(".colourkey .pairline").innerText().catch(() => "");
    log(`${tag}: pair ${pair.replace(/\s+/g, " ")}`);
    if (!pair) fail("no truth <-> reco pair for the selection");
  }
  await shot("3_selected");
  // The levels need an object made of several kinds (row 0 may be e.g. a track-only candidate): the first such row.
  const pills = () => page.locator(".focusbar .level").count();
  let row = 0;
  if (target.stage !== undefined) for (let r = 1; r < 6 && (await pills()) < 2; r++) await open(`b=${file}&e=1${all}&s=${target.table}:${(row = r)}`);
  if (row && (await pills()) < 2) await open(`b=${file}&e=1${all}&s=${target.table}:${(row = 0)}`);
  await checkLevels(page, h, target, fail, shot, tag);
  await checkDomainFocus(page, h, fail, shot, tag);
  // A shared link reopens its state: data set, event (its place in the file), domain and selection, also written as a
  // query (?b=…) rather than the hash.
  const names = (h.domains ?? []).map((d) => d.name), part = names.find((n) => !h.domains.find((d) => d.name === n).shared);
  for (const query of [false, true]) {
    const want = { b: file, e: "2", ...(part ? { d: part } : {}), s: `${target.table}:${row}` };
    await open(new URLSearchParams(want).toString(), query);
    await page.waitForTimeout(800);
    const got = Object.fromEntries(new URLSearchParams(new URL(page.url()).hash.slice(1))), at = await page.locator(".eventid small").innerText();
    const bad = Object.entries(want).filter(([k, v]) => got[k] !== v).map(([k, v]) => `${k}=${got[k]} (not ${v})`);
    log(`${tag}: link ${query ? "?" : "#"}${new URLSearchParams(want)} reopens ${bad.length ? `wrongly: ${bad.join(", ")}` : "its state"}; ${at}`);
    if (bad.length || !/^3 of|· 3 of/.test(at.trim())) fail(`a ${query ? "query" : "hash"} link did not reopen its state: ${bad.join(", ") || at}`);
  }
  const focused = async () => `${await page.locator(".focusbar b").innerText().catch(() => "")} (${decodeURIComponent(new URL(page.url()).hash.match(/s=([^&]+)/)?.[1] ?? "")})`;
  const first = await focused();
  await page.locator(".inspector [role=tab]", { hasText: "Related" }).click();
  await page.locator(".inspector .related .chip").first().click();
  await page.waitForTimeout(900);
  const jumped = await focused();
  await shot("4_jumped");
  await page.locator(".focusbar button", { hasText: "←" }).click({ timeout: 120000 }).catch(() => fail("no way back after a jump"));
  const back = await focused();
  log(`${tag}: focus ${first} -> ${jumped} -> back to ${back}`);
  if (first.startsWith(" ") || jumped === first || back !== first) fail("jumping to a related object and back did not move the focus");
  await page.keyboard.press("Escape");
  if (await page.locator(".inspector, .focusbar").count()) fail("Esc did not leave the selection");
  if (file === deep && small) log(`${tag}: too big for the interaction checks with software WebGL`);
  else if (file === deep) {
    await open(`b=${file}&e=1${all}&s=${target.table}:0`);
    await deepChecks(page, h, fail, shot);
  } else if (h.display.some((d) => d.grow) && !small) await checkReplay(page, h, fail); // the path building, also when not deep
}

// The focus is drawn with its bottom level (e.g. hits) only: no layer of an earlier reconstruction stage. ↓ adds one
// level in between (one more layer kind drawn, its pill lit) and turns a shower focus into an outline around it; ↑
// goes back.
/** Helix layers drawn: their paths end at finite points and have a picking polyline. */
async function checkHelices(page, fail, tag) {
  const helices = await page.evaluate(() => window.evdEngine.layers.filter((l) => l.path)
    .map((l) => ({ label: l.label, n: l.x.length, finite: l.x.filter(Number.isFinite).length, points: l.path.points })));
  for (const l of helices) {
    log(`${tag}: helix layer ${l.label}: ${l.n} paths, ${l.finite} with a finite end, ${l.points} picking points each`);
    if (l.n && !l.finite) fail(`helix layer ${l.label}: no path ends at a finite point`);
  }
}

/** A bundle that names a start domain (`view.domain`) opens on it: in the URL, drawing only its layers and those of
 *  shared domains or none. */
async function checkStart(page, h, fail, tag) {
  const start = h.view?.domain, names = (h.domains ?? []).map((d) => d.name);
  if (!start || names.length < 2 || !names.includes(start)) return;
  const shared = new Set(h.domains.filter((d) => d.shared).map((d) => d.name));
  const url = decodeURIComponent(new URL(page.url()).hash.match(/[#&]d=([^&]+)/)?.[1] ?? "");
  const tables = await page.evaluate(() => window.evdEngine.layers.map((l) => l.table));
  const other = tables.filter((t) => h.display.some((d) => d.table === t && d.domain && d.domain !== start && !shared.has(d.domain)));
  log(`${tag}: opens on ${url || "All"} (start domain ${start}), drawing ${tables.join(", ")}`);
  if (url !== start) fail(`did not open on its start domain ${start} (URL d=${url})`);
  if (other.length) fail(`the start domain ${start} draws layers of other domains: ${other.join(", ")}`);
  // Labels on the leading objects (layer hint labels) of the layers drawn; L hides them; N selects the leading one.
  const labelled = h.display.filter((d) => d.labels && tables.includes(d.table));
  if (!labelled.length) return;
  const shown = () => page.$$eval(".labels .label.lead", (l) => l.filter((x) => x.style.visibility === "visible").map((x) => x.innerText));
  const texts = await shown();
  log(`${tag}: labels ${texts.join(" | ")}`);
  if (!texts.length) fail(`no labels on the leading objects of ${labelled.map((d) => d.table).join(", ")}`);
  await page.keyboard.press("l");
  await page.waitForTimeout(300);
  if ((await shown()).length) fail("L did not hide the labels");
  await page.keyboard.press("l");
  await page.keyboard.press("n");
  await page.waitForTimeout(900);
  const s = decodeURIComponent(new URL(page.url()).hash.match(/s=([^&]+)/)?.[1] ?? "");
  log(`${tag}: N selected ${s}`);
  if (!labelled.some((d) => s.startsWith(`${d.table}:`))) fail(`N did not select a leading labelled object (s=${s})`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

/** With two or more domains: each one draws only its layers, those of shared domains and those without a domain,
 *  puts itself in the URL, hides the particle-type colour key if it colours layer by layer (`colourMode`), and opens
 *  its layers' tab (a shared domain its own tab; the parts of the detector the Detector tab, with its section open);
 *  another tab leaves the view as it is; All brings every layer back. */
async function checkDomains(page, h, fail, shot, tag) {
  const names = (h.domains ?? []).map((d) => d.name);
  if (names.length < 2) return;
  const shared = new Set(h.domains.filter((d) => d.shared).map((d) => d.name));
  const tables = () => page.evaluate(() => window.evdEngine.layers.map((l) => l.table));
  const before = await chooseDomain(page, "All").then(tables);
  for (const name of names) {
    await chooseDomain(page, name);
    await page.waitForTimeout(800);
    const drawn = await tables(), url = decodeURIComponent(new URL(page.url()).hash.match(/[#&]d=([^&]+)/)?.[1] ?? "");
    const other = drawn.filter((t) => h.display.some((d) => d.table === t && d.domain && d.domain !== name && !shared.has(d.domain)));
    const key = await page.locator(".colourkey .key li").count(), own = h.domains.find((d) => d.name === name).colourMode === "layers";
    log(`${tag}: domain ${name}: ${drawn.length} layers drawn (${before.length} in All), URL d=${url}, colour key ${key ? "shown" : "none"}`);
    if (other.length) fail(`domain ${name} draws layers of other domains: ${other.join(", ")}`);
    if (url !== name) fail(`domain ${name} is not in the URL`);
    if (own && key) fail(`domain ${name} colours layer by layer, but the particle-type colour key is shown`);
    const tabs = page.locator(".sidebar .tablist [role=tab]"), tabNames = await tabs.allInnerTexts();
    const tab = await page.locator(".sidebar .tablist [aria-selected=true]").innerText();
    const expected = shared.has(name) || !tabNames.includes("Detector") ? name : "Detector";
    if (tabNames.includes(expected) && tab !== expected) fail(`domain ${name} did not open its tab ${expected} (open: ${tab})`);
    if (expected === "Detector") {
      const open = await page.locator(".tabpanel details.part[open] > summary b").allInnerTexts();
      if (open.join() !== name) fail(`the Detector tab does not follow the bar to ${name} (open: ${open.join() || "none"})`);
    }
    await tabs.last().click({ timeout: 120000 });
    if (!new URL(page.url()).hash.includes(`d=${encodeURIComponent(name)}`)) fail(`the ${await tabs.last().innerText()} tab changed the view from ${name}`);
    await tabs.getByText(tab, { exact: true }).click({ timeout: 120000 });
    await shot(`1_domain_${name}`);
  }
  await chooseDomain(page, "All");
  if ((await tables()).length !== before.length) fail("All did not bring every layer back");
  if (h.display.some((d) => d.stage !== undefined) && !(await page.locator(".colourkey").count())) fail("All did not bring the colour key back");
}

/** Layers with object rows (`list`): the ticked ones list their objects; a click on a row selects that object (URL,
 *  inspector, the row marked). */
async function checkObjectRows(page, h, fail, shot, tag) {
  // The first ticked layer with object rows that this viewer draws (it leaves out reprs it does not know), in its tab.
  const tabOf = (d) => (h.domains ?? []).find((x) => x.name === d.domain)?.shared || (h.domains?.length ?? 0) < 2 ? d.domain ?? "Objects" : "Detector";
  let d;
  for (const x of h.display.filter((l) => l.list && l.visible)) {
    await page.getByRole("tab", { name: tabOf(x), exact: true }).click({ timeout: 120000 }).catch(() => {});
    if (await page.locator(".layer", { hasText: x.label }).count()) { d = x; break; }
  }
  if (!d) return log(`${tag}: no object rows drawn`);
  const rows = page.locator(".layer", { hasText: d.label }).locator("table.objects tbody tr:not(.more)");
  const n = await rows.count(), headline = await page.locator(".tabpanel .headline").innerText().catch(() => "");
  log(`${tag}: ${d.label}: ${n} object rows; headline "${headline}"`);
  if (!n) return fail(`${d.label} lists no objects (display hint list)`);
  if (!headline) fail("no headline above the object rows");
  await rows.first().hover({ timeout: 120000 });
  await page.waitForTimeout(400);
  const ring = await page.locator(".labels .label.hover").count();
  log(`${tag}: pointing at a row rings its object: ${ring ? "yes" : "no"}`);
  if (!ring) fail("pointing at an object row does not ring its object in the view");
  await rows.first().click({ timeout: 120000 }); // software WebGL: a PU200 scene keeps the page busy
  await page.waitForTimeout(900);
  const s = decodeURIComponent(new URL(page.url()).hash.match(/s=([^&]+)/)?.[1] ?? "");
  const marked = await rows.first().getAttribute("class");
  log(`${tag}: a click on the first ${d.label} row selected ${s}`);
  if (!s.startsWith(`${d.table}:`) || !(await page.locator(".inspector").count())) fail(`a click on a ${d.label} row did not select it (s=${s})`);
  if (!marked?.includes("selected")) fail("the selected object's row is not marked");
  await shot("1_rows");
  await page.keyboard.press("Escape");
}

/** With a domain bar: D keeps the selection and moves to the next domain it has objects in; a chip of the focus bar
 *  looks at its part of the detector, keeping the focus. */
async function checkDomainFocus(page, h, fail, shot, tag) {
  if ((h.domains?.length ?? 0) < 2 || !(await page.locator(".focusbar").count())) return;
  const state = () => { const p = new URLSearchParams(new URL(page.url()).hash.slice(1)); return [p.get("d"), p.get("s")]; };
  const [d0, s0] = state();
  await page.keyboard.press("d");
  await page.waitForTimeout(1200);
  const [d1, s1] = state();
  log(`${tag}: D with ${s0} selected: ${d0} -> ${d1}, selection ${s1}`);
  if (d1 === d0) fail("D did not change the domain with a selection");
  if (s1 !== s0) fail(`D did not keep the selection (${s0} -> ${s1})`);
  const chip = page.locator(".focusbar .level.part").first();
  if (await chip.count()) {
    const name = (await chip.innerText()).split(/\s/)[0];
    await chip.click();
    await page.waitForTimeout(1200);
    const [d2, s2] = state();
    log(`${tag}: chip ${name}: ${d1} -> ${d2}, selection ${s2}`);
    if (d2 !== name || s2 !== s0) fail(`the ${name} chip did not look at ${name} keeping the selection (d=${d2}, s=${s2})`);
    await shot("3c_chip");
  }
  await chooseDomain(page, "All");
}

/** Choose a domain (or All) in the domain bar: its buttons, or below 1100 px its drop-down list. */
async function chooseDomain(page, name) {
  const buttons = page.getByRole("group", { name: "Detector part" });
  if (await buttons.isVisible()) await buttons.getByRole("button", { name, exact: true }).click({ timeout: 120000 });
  else await page.locator("select.domainlist").selectOption(name === "All" ? "" : name, { timeout: 120000 });
  await page.waitForTimeout(800);
}

/** A selection draws its objects that a layer's filter hides (cuts still apply), and its levels drawn as lines (e.g. a
 *  vertex's tracks) with its smallest parts. Looks, in the page, for an object related through a plain relation to a
 *  row that a non-onSelection layer's filter hides but that passes the layer's cut; selects it and checks that row is
 *  drawn. Uses the app's own modules (dev server). */
async function checkFocusFilters(page, h, fail, tag) {
  if (!h.display.some((d) => d.filter && !d.onSelection)) return;
  const found = await page.evaluate(async () => {
    const url = (f) => performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.includes(f)); // ?t= after hot updates
    const store = await import(url("/src/model/store.ts")), custom = await import(url("/src/model/custom.ts"));
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = store.bundle.peek(), ev = store.event.peek(), cuts = store.cuts.peek(), out = [];
    for (const d of b.header.display.filter((x) => x.filter && !x.onSelection)) {
      const t = ev.tables[d.table], keep = t && custom.filterMask(t, custom.filters.peek()[d.table]);
      if (!keep) continue;
      const passes = (i) => !d.cut || Number(t.columns[d.cut.column][i]) >= (cuts[d.cut.group] ?? 0);
      for (const [name, r] of Object.entries(b.header.relations)) {
        const rel = ev.relations[name];
        if (!rel || r.association || r.inverseOf || r.to !== d.table || r.from === d.table) continue;
        let from = -1, row = -1;
        for (let f = 0; f + 1 < rel.offsets.length && from < 0; f++)
          for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++) if (!keep[rel.indices[k]] && passes(rel.indices[k])) { from = f; row = rel.indices[k]; break; }
        if (from < 0) continue;
        store.selection.value = { table: r.from, row: from };
        await frames();
        const layer = window.evdEngine.layers.find((l) => l.table === d.table);
        const lines = store.levels.peek().filter((l) => l.layers.every((x) => x.repr === "helix" || x.repr === "segments"));
        const undrawn = lines.flatMap((l) => l.layers).filter((x) => !window.evdEngine.layers.some((l) => l.table === x.table)).map((x) => x.table);
        out.push({ sel: `${r.from}:${from}`, table: d.table, row, drawn: !!layer?.passes(row), undrawn });
        store.selection.value = null;
        await frames();
        break;
      }
    }
    return out;
  });
  if (!found.length) log(`${tag}: no selection reaches a row hidden by a filter`);
  for (const f of found) {
    log(`${tag}: focus ${f.sel} reaches ${f.table} #${f.row}, hidden by the filter: ${f.drawn ? "drawn" : "not drawn"}${f.undrawn.length ? `; levels of lines not drawn: ${f.undrawn}` : ""}`);
    if (!f.drawn) fail(`selecting ${f.sel} does not draw ${f.table} #${f.row}, which the layer's filter hides`);
    if (f.undrawn.length) fail(`selecting ${f.sel} does not draw its levels of lines: ${f.undrawn.join(", ")}`);
  }
}

async function checkLevels(page, h, target, fail, shot, tag) {
  const drawn = () => page.evaluate(() => window.evdEngine.layers.map((l) => l.table).sort().join());
  const style = () => page.evaluate((t) => { // shower layers: surface style and transparency of the focus's layer
    const m = window.evdEngine.layers.find((l) => l.table === t)?.object.children?.[0]?.material;
    return m?.uniforms?.uStyle ? `${m.uniforms.uStyle.value}/${m.transparent}` : "";
  }, target.table);
  const style0 = await style();
  const before = await drawn(), pills = await page.locator(".focusbar .level").allInnerTexts();
  const earlier = h.display.filter((d) => target.stage !== undefined && d.stage !== undefined && d.stage < target.stage).map((d) => d.table);
  const early = before.split(",").filter((t) => earlier.includes(t));
  if (early.length) fail(`focus on ${target.table} draws earlier stages by default: ${early.join(", ")}`);
  if (pills.length < 2) return log(`${tag}: levels: ${pills.join(" › ") || "none"}`);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(600);
  const lit = await page.locator(".focusbar .level.on:not(:disabled)").allInnerTexts(), down = await drawn();
  log(`${tag}: levels: ${pills.join(" › ").replace(/\s+/g, " ")}; ↓ shows ${lit.join() || "nothing"}`);
  if (lit.length !== 1 || down === before) fail(`↓ did not show the first level (lit: ${lit.join() || "none"})`);
  if (!new URL(page.url()).hash.includes("lv=")) fail("the level shown is not in the URL (lv)");
  if (style0 && (await style()) === style0) fail("↓ did not draw the focus as an outline around the level");
  await shot("3b_level");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(600);
  if ((await drawn()) !== before) fail("↑ did not go back to the focus's default layers");
  if ((await style()) !== style0) fail("↑ did not give the focus its own surface back");
  // In the truth <-> reco pair view, the pair's particle shows the same picture as its candidate, with a level shown:
  // the same layers, with the same surfaces.
  const particle = page.locator(".inspector .truthline .chip").first();
  if (!(await page.locator(".pairline").count()) || !(await particle.count())) return;
  const looks = () => page.evaluate(() => window.evdEngine.layers.map((l) => {
    const m = l.object.children?.[0]?.material;
    return `${l.table}${m?.uniforms?.uStyle ? `/${m.uniforms.uStyle.value}/${m.transparent}` : ""}`;
  }).sort().join());
  // The level is built after the jump, from the particle's side.
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(900);
  const fromCandidate = await looks();
  await page.keyboard.press("ArrowUp");
  await particle.click();
  await page.waitForTimeout(1200);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(900);
  const fromTruth = await looks();
  log(`${tag}: the pair from its particle, a level shown: ${fromTruth === fromCandidate ? "the same picture" : `differs: ${fromTruth} vs ${fromCandidate}`}`);
  if (fromTruth !== fromCandidate) fail("the pair's particle and candidate draw different pictures");
  await page.locator(".focusbar button", { hasText: "←" }).click({ timeout: 120000 });
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(600);
}

async function deepChecks(page, h, fail, shot) {
  await page.getByTitle("Light theme").click();
  await shot("5_light");
  await page.getByTitle("Dark theme").click();
  // A press-drag-release rotates; it is not a click, so the selection stays.
  await page.mouse.move(700, 600); await page.mouse.down(); await page.mouse.move(780, 560, { steps: 8 }); await page.mouse.up();
  if (!(await page.locator(".inspector").count())) fail("a rotate drag cleared the selection");
  await page.keyboard.press("?");
  await shot("6_help");
  await page.keyboard.press("Escape");

  // From the first layer's ⋯: custom column r = hypot(x, y) on its table (abs of its first float column if it has no
  // x, y: tracks, jets); colour the layer by it; then a filter hiding every row, shown on the layer's row.
  const firstLayer = page.locator(".layer").first(), count = async () => (await firstLayer.locator(".count").innerText()).replace(/,/g, "");
  const table = (await firstLayer.locator("label").getAttribute("title")).split(":")[0], columns = h.tables[table]?.columns ?? {};
  const expr = "x" in columns && "y" in columns ? "hypot(x, y)" : `abs(${Object.keys(columns).find((c) => columns[c].type === "f32")})`;
  await firstLayer.locator(".more").click();
  await firstLayer.locator(".exprform .expr").fill(expr);
  await firstLayer.locator(".exprform .name").fill("r");
  log(`  expression preview: ${await firstLayer.locator(".exprform .feedback").innerText()}`);
  await firstLayer.getByRole("button", { name: "Add column" }).click();
  await firstLayer.locator(".colourby").selectOption("r");
  await page.waitForTimeout(500);
  log(`  legend coloured by r: ${await firstLayer.locator(".options .legend > span").last().innerText()}`);
  const before = await count();
  await firstLayer.locator(".exprform .expr").fill("r < 0");
  await firstLayer.getByRole("button", { name: "Filter", exact: true }).click();
  if (!(await firstLayer.locator(".sub.filter").count())) fail("the filter is not shown on the layer's row");
  const after = await count();
  log(`  first layer: ${before} without the filter, ${after} with r < 0`);
  if (!after.startsWith("0 /")) fail("the filter did not hide the rows");
  await shot("7_filter");
  // Remove it again: the replay below builds this layer's objects too (e.g. tracks, when the first layer is theirs).
  await firstLayer.locator(".sub.filter .icon-button").click({ timeout: 120000 });
  if ((await count()).startsWith("0 /")) fail(`removing the filter did not bring the rows back (${await count()})`); // the layer's default filter goes too

  await page.keyboard.press("Escape"); // the replay and tour start from the whole event
  await checkReplay(page, h, fail);

  // The tour replays the event, then selects its main showers one by one; any key stops it.
  const cam = () => page.evaluate(() => window.evdEngine.cam3d.position.toArray().map(Math.round).join());
  const c0 = await cam();
  await page.keyboard.press("p");
  const toured = await page.waitForSelector(".inspector", { timeout: 60000 }).then(() => true, () => false);
  const c1 = await cam();
  await shot("8_tour");
  await page.keyboard.press("Escape");
  log(`  tour: camera ${c0} -> ${c1}, selected an object: ${toured}`);
  if (c0 === c1 || !toured) fail("the tour did not move the camera or select a shower");
  if (await page.locator(".eventnav .icon-button.on").count()) fail("a key press did not stop the tour");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  await shot("9_next_event");
}

/** The replay (R): hit layers arrive in the physics phase; with paths built from their parts (display hint `grow`),
 *  the seeding, building and fitting captions come in order before any later step, and every path is complete by the
 *  fit. */
async function checkReplay(page, h, fail) {
  // Captions shown, recorded as they change (a MutationObserver on the view, installed before R), with the replay
  // clock: a poller missed short ones whenever software-WebGL frames were slow.
  await page.evaluate(() => {
    window.captions = [];
    const root = document.querySelector(".viewport");
    window.captionObserver = new MutationObserver(() => {
      const t = document.querySelector(".caption b")?.textContent, e = window.evdEngine;
      if (t && !t.startsWith("t =") && window.captions.at(-1)?.[0] !== t) window.captions.push([t, e.replayClock ? (performance.now() - e.replayClock.t0) / 1000 : 0]);
    });
    window.captionObserver.observe(root, { subtree: true, childList: true, characterData: true });
  });
  await page.keyboard.press("r");
  if (!(await page.evaluate(() => window.evdEngine.replaying))) fail("R did not start a replay");
  // Each hit layer arrives in the physics phase (its first 3 s, render/replay.ts TRAVEL) in any colour mode, not with
  // the clusters: half of its hits are shown by then. A layer has instances only for the rows the filter can show.
  const hitsAt = await page.evaluate(() => window.evdEngine.layers.filter((l) => l.key.endsWith(":cells") && !l.context && l.object.geometry.getAttribute("iT").array.length).map((l) => {
    const t = [...l.object.geometry.getAttribute("iT").array].sort((a, b) => a - b);
    return [l.label, t[t.length >> 1]];
  }));
  log(`  replay: half the hits shown after ${hitsAt.map(([l, t]) => `${t.toFixed(2)} s (${l})`).join(", ") || "- (no hit layer)"}`);
  for (const [l, t] of hitsAt) if (!(t < 3)) fail(`${l}: the hits appear after the physics phase of the replay (half by ${t.toFixed(2)} s)`);
  // Paths built from their parts (display hint `grow`): when each is complete (iL) and when its parts light up.
  const grown = h.display.filter((d) => d.grow).map((d) => [`${d.table}:${d.repr}`, h.relations[d.grow.parts]?.to]);
  const building = await page.evaluate((grown) => grown.map(([key, parts]) => {
    const layers = window.evdEngine.layers, g = layers.find((l) => l.key === key)?.object.geometry, growth = window.evdPlan?.growth;
    const appear = g?.getAttribute("iT").array ?? [], ends = g?.getAttribute("iL").array ?? [];
    const lit = layers.find((l) => l.table === parts)?.object.geometry.getAttribute("iL").array ?? [];
    // every drawn path grows from the building's start (not the 0.5 s of an appearing line) and is whole by the fit
    const late = growth ? [...ends].filter((t, i) => !(appear[i] < t && Math.abs(appear[i] - growth.build) < 1e-4 && t <= growth.complete + 1e-4)).length : -1;
    return { key, paths: ends.length, done: Math.max(...ends), late, lit: lit.filter((t) => t < 1e28).length, parts: lit.length };
  }), grown);
  await page.waitForFunction(() => !window.evdEngine.replaying, null, { timeout: 60000 }).catch(() => fail("the replay did not end"));
  const shown = await page.evaluate(() => { window.captionObserver.disconnect(); return window.captions; });
  // The plan's captions, every 10 ms of the replay clock: what a frame at that time shows. A frame slower than a short
  // step (the fit) skips it on screen; the plan still has it, and what was shown must follow the plan's order.
  const captions = await page.evaluate(() => {
    const p = window.evdPlan, out = [];
    for (let s = 0; p && s < p.seconds; s += 0.01) { const t = p.caption(s)?.title; if (t && !t.startsWith("t =") && out.at(-1)?.[0] !== t) out.push([t, s]); }
    return out;
  });
  log(`  replay captions: ${captions.map(([c]) => c).join(" | ")}; shown: ${shown.map(([c]) => c).join(" | ")}`);
  let k = 0; // what was shown is the plan's captions in order, maybe with some skipped
  for (const [c] of shown) { while (k < captions.length && captions[k][0] !== c) k++; if (k++ >= captions.length) { fail(`caption "${c}" shown out of the plan's order`); break; } }
  if (!shown.length && captions.length) fail("no replay caption shown");
  // Every path is built to its full length by the time the fit is shown, and the steps after it wait for it.
  for (const b of building) {
    const at = (word) => captions.findIndex(([c]) => c.startsWith(word)), fit = captions[at("Fitting")]?.[1];
    log(`  replay builds ${b.key}: ${b.paths} paths complete by ${b.done.toFixed(2)} s (the fit from ${fit?.toFixed(2) ?? "-"} s), ${b.lit} of ${b.parts} parts lit`);
    if (!(at("Seeding") >= 0 && at("Seeding") < at("Building") && at("Building") < at("Fitting"))) fail(`${b.key}: no seeding, building and fitting captions in order`);
    if (captions.some(([c], k) => k < at("Fitting") && /^(Clustering|Building (?!.* outwards)|.* → )/.test(c))) fail(`${b.key}: a later step started before the paths were built`);
    if (!b.paths || b.late) fail(`${b.key}: ${b.late < 0 ? "no plan" : `${b.late} paths`} not built from the building's start to whole by the fit`);
    if (b.parts && !b.lit) fail(`${b.key}: no part lit up`);
  }
}

/** The bundle's JSON header and file size: two range requests, or the whole file from a server without ranges. */
async function header(file) {
  const get = (from, to) => fetch(`${base}${file}`, { headers: { Range: `bytes=${from}-${to}` } });
  const head = await get(0, 11), buf = Buffer.from(await head.arrayBuffer()), n = buf.readUInt32LE(8);
  if (head.status === 200) return { ...JSON.parse(buf.subarray(12, 12 + n).toString()), size: buf.length };
  const size = Number(head.headers.get("Content-Range")?.split("/")[1]);
  // The index's offset and length are in the 16-byte trailer; it gives the number of events.
  const tail = Buffer.from(await (await get(size - 16, size - 1)).arrayBuffer()), at = Number(tail.readBigUInt64LE(0)), len = tail.readUInt32LE(8);
  const events = JSON.parse(Buffer.from(await (await get(at, at + len - 1)).arrayBuffer()).toString()).events.length;
  return { ...JSON.parse(Buffer.from(await (await get(12, 11 + n)).arrayBuffer()).toString()), size, events };
}
