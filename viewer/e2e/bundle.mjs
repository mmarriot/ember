// The checks of one bundle (checkBundle), each step logged and a failure noted, not thrown: messages, the event box,
// the start domain and labels, layers and helices, domains, object rows, presets, colour keys and truth colours,
// summary charts, what a selection draws, its card's chain and levels, links, looking at and opening chain objects, X
// and B, "only", the scorecard; for one bundle the interaction checks (deepChecks), and for one whose paths are built
// from their parts (`grow`) the replay (checkReplay). Each check's doc comment says what it expects.
import { readFileSync } from "node:fs";
import {
  BIG,
  bigEvents,
  drawnTables,
  eventRead,
  failOnErrors,
  hasDomainBar,
  hashParam,
  log,
  screenshot,
  succeeds,
} from "./common.mjs";

/** In an older bundle's header: a layer the viewer leaves out (io/bundle.ts oneSourcePerKind). */
const legacyCopy = (d) => d.alternative && d.source === "legacy";

/** Check bundle `file` (`tag`: its name in the progress lines and screenshots). `state.page`: the page open now, which
 *  the caller closes when the check ends or runs out of time. */
export async function checkBundle(run, file, tag, state) {
  const { browser, base, out, problems, headers, deep } = run;
  const h = headers[file],
    fail = (text) => problems.push(`${tag}: ${text}`);
  let page,
    small = false;
  const shot = async (name) => {
    if (small && name !== "1_layers") return;
    await page.waitForTimeout(500);
    await screenshot(page, out, tag, name);
  };
  const open = async (hash, query = false) => {
    // a fresh page each time: software WebGL is slow to let go of a big scene
    await page?.close();
    page = state.page = await browser.newPage({
      viewport: small ? { width: 720, height: 450 } : { width: 1440, height: 860 },
    });
    failOnErrors(page, base, fail);
    await page.goto(`${base}${query ? "?" : "#"}${hash}`, { timeout: 90000 });
    await eventRead(page);
    await page.waitForTimeout(1200);
  };

  await open(`b=${file}&e=1`);
  await checkStart(page, h, fail, tag);
  await checkMessage(page, fail, tag);
  await checkEventBox(page, fail, tag);
  const [drawn, objects] = await page.evaluate(() => [
    window.emberEngine.layers.length,
    window.emberEngine.layers.reduce((s, l) => s + l.x.length, 0),
  ]);
  const rows = await page.$$eval(".layer:not(.off) label", (r) =>
    r.map((x) => x.innerText.replace(/\s+/g, " ").trim()),
  );
  log(`${tag}: ${drawn} layers, ${objects} objects drawn: ${rows.join(" | ")}`);
  if (!drawn) fail("no layer drawn");
  // A big scene, or big events (whose start view may be light: only the physics objects): software WebGL is too slow
  // for the replay and full-size screenshots.
  if ((small = objects > BIG || bigEvents(h))) await page.setViewportSize({ width: 720, height: 450 });
  await shot("1_layers");
  await checkHelices(page, fail, tag);
  await checkDomains(page, h, fail, shot, tag);
  await checkUnclustered(page, h, fail, tag, small);
  await checkObjectRows(page, h, fail, shot, tag);

  const preset = page.locator(".sidebar .presets select");
  for (const [i, name] of (await preset.locator("option").allInnerTexts()).entries()) {
    await preset.selectOption(String(i), { timeout: 120000 });
    if ((await preset.inputValue()) !== String(i)) fail(`preset ${name} did not apply`);
  }

  // With reconstruction stages (so candidates), the colour key under the tabs names the particle types.
  const tabs = await page.$$eval(".sidebar .tablist [role=tab]", (t) => t.map((x) => x.textContent));
  const keys = await page.locator(".colourkey .key li").count();
  log(`${tag}: tabs ${tabs.join(" | ")}; colour key: ${keys} entries`);
  if (h.display.some((d) => d.stage !== undefined) && keys < 2) fail("no colour key for the candidates");
  // With truth particles, T colours by generator particle and says so in the key's title; T again goes back.
  if (h.display.some((d) => d.truth && d.particle)) {
    const title = () =>
      page
        .locator(".colourkey > summary")
        .innerText()
        .catch(() => "");
    await page.keyboard.press("t");
    await page.waitForTimeout(1500);
    const truthTitle = await title(),
      entries = await page.locator(".colourkey .key li").count();
    log(`${tag}: truth colours: "${truthTitle.split("\n")[0]}", ${entries} key entries`);
    if (!truthTitle.includes("generator particle") || entries < 3)
      fail(`T did not colour by generator particle (${truthTitle})`);
    if (!new URL(page.url()).hash.includes("c=truth")) fail("the truth colours are not in the URL (c=truth)");
    // Each kind's truth in one word on the side panel's headings; kinds without truth faint.
    const words = await page.locator(".sidebar .truthword").allInnerTexts(),
      faint = await page.locator(".sidebar .layer.faint").count();
    log(`${tag}: truth words ${[...new Set(words)].join(", ") || "none"}; ${faint} faint rows`);
    if (h.display.some((d) => d.truthGap) && !words.length)
      fail("no truth word on the side panel's kinds in the truth colours");
    await shot("1_truth");
    await page.keyboard.press("t");
    await page.waitForTimeout(1500);
    if ((await title()).includes("generator particle")) fail("T again did not go back to the reco colours");
  }
  if ((h.presets?.length ?? 0) > 1) await preset.selectOption("0", { timeout: 120000 }); // the default filters
  await checkFocusFilters(page, h, fail, tag);

  await page.getByRole("tab", { name: "Metadata", exact: true }).click();
  const charts = await page.locator(".bars").count(),
    runInfo = await page.locator(".tabpanel section h3", { hasText: /^Run \d+/, hasNotText: "Lumi" }).count();
  log(
    `${tag}: ${charts} summary charts (profile defines ${h.summaries?.length ?? 0}), run information ${runInfo ? "shown" : "none"}`,
  );
  if (h.summaries?.length && !charts) fail("no summary charts");
  await shot("2_event");

  // Select an object made of others: from a relation into a drawn table, preferring later stages, with rows in the
  // event opened (e=1, the second: an electron is linked to its tracks, but an event may have none).
  const drawnTables = new Set(h.display.filter((d) => !legacyCopy(d)).map((d) => d.table));
  const score = (d) =>
    Object.values(h.relations)
      .filter((r) => !r.association && r.from === d.table)
      .reduce((s, r) => Math.max(s, (drawnTables.has(r.to) ? 100 : 1) + (d.stage ?? 0)), 0);
  const inEvent = (d) => (h.counts[Math.min(1, h.counts.length - 1)]?.[d.table] ?? 0) > 0;
  const target = h.display.filter((d) => d.visible && !d.context && inEvent(d)).sort((a, c) => score(c) - score(a))[0];
  if (!target || !score(target)) return log(`${tag}: nothing made of other objects to select`);
  const all = hasDomainBar(h) ? "&d=All" : ""; // every level in the focus bar, as without domains
  await open(`b=${file}&e=1${all}&s=${target.table}:0`);
  // The selection's card shows its chain: itself and at least one step above or below it.
  const steps = await page.locator(".inspector .ladder .rung").count();
  if (steps < 2) fail(`selecting ${target.table} #0 shows no chain (${steps} steps)`);
  // In the "Particle type" mode a selection shows its truth <-> reco pair (a candidate, and its particle with truth).
  if (await page.locator(".colourkey").count()) {
    const pair = await page
      .locator(".inspector .pairline")
      .innerText()
      .catch(() => "");
    // No pair without truth (store/selection.ts pairView), nor for a kind with no truth of its own (truth/pair.ts
    // pairFor): a truthGap and neither a match to a truth layer nor a fact into it (e.g. a stock release's TICL
    // candidates). Ember derives none (docs/truth.md).
    const rels = Object.values(h.relations),
      truthTables = new Set(h.display.filter((d) => d.truth).map((d) => d.table));
    const truthRoot = [...truthTables].some((t) => rels.some((r) => r.association && (r.from === t || r.to === t)));
    const ownTruth =
      !target.truthGap ||
      rels.some(
        (r) => (r.match && r.from === target.table && truthTables.has(r.to)) || (r.fact && r.to === target.table),
      );
    const why = !truthRoot ? "none, as the bundle has no truth" : `none, as ${target.table} has no truth of its own`;
    log(`${tag}: pair ${pair.replace(/\s+/g, " ") || (truthRoot && ownTruth ? "none" : why)}`);
    if (!pair && truthRoot && ownTruth) fail("no truth <-> reco pair for the selection");
    if (pair && !truthRoot) fail("a truth <-> reco pair in a bundle without truth");
    // ... unless the card says the pair is its one matched part's (owner decision D4: a TICL candidate's trackster)
    const delegated = await page.locator(".inspector .delegated").count();
    if (pair && truthRoot && !ownTruth && !delegated)
      fail(`a truth <-> reco pair for ${target.table}, which has no truth of its own`);
  }
  await shot("3_selected");
  await checkReducedMotion(page, fail);
  // The levels need an object with a step to move the tick to (↓ ↑): row 0 may be e.g. a track-only candidate.
  const pills = () => page.locator(".inspector .rung .level:not(.always)").count();
  let row = 0;
  if (target.stage !== undefined)
    for (let r = 1; r < 6 && !(await pills()); r++) await open(`b=${file}&e=1${all}&s=${target.table}:${(row = r)}`);
  if (row && !(await pills())) await open(`b=${file}&e=1${all}&s=${target.table}:${(row = 0)}`);
  await checkLevels(page, h, target, fail, shot, tag);
  await checkDomainFocus(page, h, fail, shot, tag);
  // A link reopens its data set, event (its place in the file), domain and selection, also as a query (?b=…).
  const names = (h.domains ?? []).map((d) => d.name),
    part = names.find((n) => !h.domains.find((d) => d.name === n).shared);
  for (const query of [false, true]) {
    const want = { b: file, e: "2", ...(part ? { d: part } : {}), s: `${target.table}:${row}` };
    await open(new URLSearchParams(want).toString(), query);
    await page.waitForTimeout(800);
    const got = Object.fromEntries(new URLSearchParams(new URL(page.url()).hash.slice(1))),
      at = await page.locator(".eventid small").innerText();
    const bad = Object.entries(want)
      .filter(([k, v]) => got[k] !== v)
      .map(([k, v]) => `${k}=${got[k]} (not ${v})`);
    log(
      `${tag}: link ${query ? "?" : "#"}${new URLSearchParams(want)} reopens ${bad.length ? `wrongly: ${bad.join(", ")}` : "its state"}; ${at}`,
    );
    if (bad.length || !/^3 of|· 3 of/.test(at.trim()))
      fail(`a ${query ? "query" : "hash"} link did not reopen its state: ${bad.join(", ") || at}`);
  }
  // The card's object (its kind and name: a cluster and a hit can both be "#0") and the URL's selection.
  const focused = async () => {
    const names = await page
      .locator(".inspector > header .kind, .inspector h2")
      .allInnerTexts()
      .catch(() => []);
    return `${names.join(" ").replace(/\s+/g, " ")} (${hashParam(page, "s")})`;
  };
  const first = await focused(),
    card = (x) => x.slice(0, x.lastIndexOf(" (")); // without the URL's selection (a kind's name may hold brackets)
  // A chain step names its objects when few; a longer one unfolds to them. A click looks at one (the view and the URL's
  // selection move to it, the card stays); "Open" goes into its card; back returns to the first.
  if (!(await page.locator(".inspector .ladder .rhead .chip").count()))
    await page.locator(".inspector .ladder .rhead .count").first().click();
  await page
    .locator(".inspector .ladder .rhead .chip, .inspector .ladder .rlist .chip")
    .first()
    .click({ timeout: 120000 });
  await page.waitForTimeout(900);
  const looked = await focused(),
    looking = await page.locator(".inspector .looking").count();
  if (!looking || card(looked) !== card(first) || looked === first)
    fail(`a click on a chain object did not look at it and keep the card (${first} -> ${looked})`);
  await shot("4_looking");
  await page
    .locator(".inspector .looking .open")
    .click({ timeout: 120000 })
    .catch(() => fail("no way into the object looked at"));
  await page.waitForTimeout(900);
  const jumped = await focused();
  await shot("4_jumped");
  await page
    .locator(".inspector .backlink")
    .click({ timeout: 120000 })
    .catch(() => fail("no way back after opening an object's card"));
  const back = await focused();
  log(
    `${tag}: card ${first} -> looks at ${looked.slice(looked.lastIndexOf(" (") + 2, -1)} -> opens ${jumped} -> back to ${back}`,
  );
  if (first.startsWith(" ") || card(jumped) === card(first) || back !== first)
    fail("opening a chain object's card and going back did not move the card");
  // What a word means is one click away, and Esc closes the description alone.
  await page.locator(".inspector .ladder h4 .info").click();
  const described = await page.locator(".popover").count();
  await page.keyboard.press("Escape");
  if (!described || (await page.locator(".popover").count()) || !(await page.locator(".inspector").count()))
    fail("the chain's description did not open, or Esc did not close it alone");
  await checkCross(page, h, fail, tag);
  await page.keyboard.press("Escape");
  if (await page.locator(".inspector").count()) fail("Esc did not leave the selection");
  await checkOnly(page, h, fail, shot, tag);
  await checkScorecard(page, h, fail, shot, tag);
  if (file === deep && small) log(`${tag}: too big for the interaction checks with software WebGL`);
  else if (file === deep) {
    await open(`b=${file}&e=1${all}&s=${target.table}:0`);
    await deepChecks(page, h, fail, shot);
  } else if (h.display.some((d) => d.grow) && !small) await checkReplay(page, h, fail); // the path building, also when not deep
}

/** A message is readable: wider than a word (it once took the "i" button's 15 px). The event box's answer to text
 *  that names nothing is one. */
async function checkMessage(page, fail, tag) {
  await page.fill("input.jump", "no such thing");
  await page.press("input.jump", "Enter");
  const toast = page.locator(".toast").last(), // the newest
    width = await toast.evaluate((t) => t.getBoundingClientRect().width).catch(() => 0);
  log(`${tag}: a message ${Math.round(width)} px wide: ${await toast.innerText().catch(() => "none")}`);
  if (width < 200) fail(`a message is ${Math.round(width)} px wide`);
}

/** The top bar names the run, lumi section and event; the event box goes back to it by its run:lumi:event (from
 *  another event when the bundle has more than one). */
async function checkEventBox(page, fail, tag) {
  const shown = () => page.locator(".eventid strong").innerText(),
    first = await shown(),
    [run, lumi, event] = first.match(/\d+/g) ?? [],
    events = Number((await page.locator(".eventid small").innerText()).match(/of ([\d,]+)/)?.[1].replace(/,/g, ""));
  if (events > 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((was) => document.querySelector(".eventid strong")?.textContent !== was, first);
  }
  await page.fill("input.jump", `${run}:${lumi}:${event}`);
  await page.press("input.jump", "Enter");
  await page
    .waitForFunction((want) => document.querySelector(".eventid strong")?.textContent === want, first, {
      timeout: 60000,
    })
    .catch(() => {});
  const back = await shown();
  log(`${tag}: event box ${run}:${lumi}:${event} -> ${back}`);
  if (!/ LS \d+ /.test(first)) fail(`the top bar does not name the lumi section (${first})`);
  if (back !== first) fail(`the event box did not go back to ${run}:${lumi}:${event} (${back})`);
}

/** A bundle that names a start domain (`view.domain`) opens on it: in the URL, drawing only its layers and those of
 *  shared domains or none. Then labels on the leading objects (display hint `labels`): L hides them; N selects one. */
async function checkStart(page, h, fail, tag) {
  const start = h.view?.domain;
  if (!start || !hasDomainBar(h) || !h.domains.some((d) => d.name === start)) return;
  const shared = new Set(h.domains.filter((d) => d.shared).map((d) => d.name));
  const url = hashParam(page, "d");
  const tables = await drawnTables(page);
  const other = tables.filter((t) =>
    h.display.some((d) => d.table === t && d.domain && d.domain !== start && !shared.has(d.domain)),
  );
  log(`${tag}: opens on ${url || "All"} (start domain ${start}), drawing ${tables.join(", ")}`);
  if (url !== start) fail(`did not open on its start domain ${start} (URL d=${url})`);
  if (other.length) fail(`the start domain ${start} draws layers of other domains: ${other.join(", ")}`);
  const labelled = h.display.filter((d) => d.labels && tables.includes(d.table));
  if (!labelled.length) return;
  const shown = () =>
    page.$$eval(".labels .label.lead", (l) =>
      l.filter((x) => x.style.visibility === "visible").map((x) => x.innerText),
    );
  const texts = await shown();
  log(`${tag}: labels ${texts.join(" | ")}`);
  if (!texts.length) fail(`no labels on the leading objects of ${labelled.map((d) => d.table).join(", ")}`);
  await page.keyboard.press("l");
  await page.waitForTimeout(300);
  if ((await shown()).length) fail("L did not hide the labels");
  await page.keyboard.press("l");
  await page.keyboard.press("n");
  await page.waitForTimeout(900);
  const s = hashParam(page, "s");
  log(`${tag}: N selected ${s}`);
  if (!labelled.some((d) => s.startsWith(`${d.table}:`))) fail(`N did not select a leading labelled object (s=${s})`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

/** Helix layers drawn: their paths end at finite points and have a picking polyline. */
async function checkHelices(page, fail, tag) {
  const helices = await page.evaluate(() =>
    window.emberEngine.layers
      .filter((l) => l.path)
      .map((l) => ({
        label: l.label,
        n: l.x.length,
        finite: l.x.filter(Number.isFinite).length,
        points: l.path.points,
      })),
  );
  for (const l of helices) {
    log(`${tag}: helix layer ${l.label}: ${l.n} paths, ${l.finite} with a finite end, ${l.points} picking points each`);
    if (l.n && !l.finite) fail(`helix layer ${l.label}: no path ends at a finite point`);
  }
}

/** With a domain bar: each domain draws only its layers, those of shared domains and those without a domain, puts
 *  itself in the URL, hides the particle-type colour key if it colours layer by layer (`colourMode`), and opens its
 *  layers' tab (Reconstruction, with its section open and highlighted in the bar's order, where there is one); another
 *  tab leaves the view as it is; All brings every layer back. */
async function checkDomains(page, h, fail, shot, tag) {
  if (!hasDomainBar(h)) return;
  const shared = new Set(h.domains.filter((d) => d.shared).map((d) => d.name));
  const before = await chooseDomain(page, "All").then(() => drawnTables(page));
  for (const { name, colourMode } of h.domains) {
    await chooseDomain(page, name);
    await page.waitForTimeout(800);
    const drawn = await drawnTables(page),
      url = hashParam(page, "d");
    const other = drawn.filter((t) =>
      h.display.some((d) => d.table === t && d.domain && d.domain !== name && !shared.has(d.domain)),
    );
    const key = await page.locator(".colourkey .key li").count(),
      own = colourMode === "layers";
    log(
      `${tag}: domain ${name}: ${drawn.length} layers drawn (${before.length} in All), URL d=${url}, colour key ${key ? "shown" : "none"}`,
    );
    if (other.length) fail(`domain ${name} draws layers of other domains: ${other.join(", ")}`);
    if (url !== name) fail(`domain ${name} is not in the URL`);
    if (own && key) fail(`domain ${name} colours layer by layer, but the particle-type colour key is shown`);
    const tabs = page.locator(".sidebar .tablist [role=tab]"),
      tabNames = await tabs.allInnerTexts();
    const tab = await page.locator(".sidebar .tablist [aria-selected=true]").innerText();
    const expected = tabNames.includes("Reconstruction") ? "Reconstruction" : name;
    if (tabNames.includes(expected) && tab !== expected)
      fail(`domain ${name} did not open its tab ${expected} (open: ${tab})`);
    if (expected === "Reconstruction") {
      const open = await page.locator(".tabpanel details.part[open] > summary b").allInnerTexts(),
        here = await page.locator(".tabpanel details.part.here > summary b").allInnerTexts(),
        order = await page.locator(".tabpanel details.part > summary b").allInnerTexts(),
        bar = h.domains.map((d) => d.name).filter((n) => order.includes(n));
      if (open.join() !== name || here.join() !== name)
        fail(
          `the Reconstruction tab does not follow the bar to ${name} (open: ${open.join() || "none"}, highlighted: ${here.join() || "none"})`,
        );
      if (order.join() !== bar.join())
        fail(`the Reconstruction tab's parts moved: ${order.join()} (bar: ${bar.join()})`);
    }
    await tabs.last().click({ timeout: 120000 });
    if (!new URL(page.url()).hash.includes(`d=${encodeURIComponent(name)}`))
      fail(`the ${await tabs.last().innerText()} tab changed the view from ${name}`);
    await tabs.getByText(tab, { exact: true }).click({ timeout: 120000 });
    await shot(`1_domain_${name}`);
  }
  await chooseDomain(page, "All");
  if ((await drawnTables(page)).length !== before.length) fail("All did not bring every layer back");
  if (h.display.some((d) => d.stage !== undefined) && !(await page.locator(".colourkey").count()))
    fail("All did not bring the colour key back");
}

/** Objects no later step uses (hits in no cluster, layer clusters in no trackster): hidden by default where there is a
 *  domain bar (collision events), shown elsewhere; a chip on the layer's row shows or hides them ("in tracksters" |
 *  "all"). Checked on the drawn layers that have such a rule (in All, where checkDomains leaves the view): no unused
 *  object is drawn while hidden, but those of a selection (an object related to one, e.g. a truth particle); shown,
 *  every one that the layer's cut and filter keep is (none in the test-beam bundles, whose clustering takes every hit).
 *  Then the chip itself, in the part of the detector of the first such layer. */
async function checkUnclustered(page, h, fail, tag, small) {
  const state = (show) =>
    page.evaluate(async (show) => {
      const url = (f) =>
        performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .find((n) => n.includes(f));
      const store = await import(url("/src/model/store/index.ts")),
        custom = await import(url("/src/model/custom/settings.ts")),
        clustered = await import(url("/src/model/event/clustered.ts"));
      const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const h = store.bundle.peek().header,
        sources = clustered.clusterSources(h),
        defaults = clustered.hideUnclustered.peek();
      if (show) {
        clustered.hideUnclustered.value = {};
        await new Promise((r) => setTimeout(r, 1500));
      }
      const ev = store.event.peek(),
        hidden = clustered.hideUnclustered.peek(),
        drawn = {},
        kept = {}, // the unused objects that the layer's cut and own filter keep
        selected = []; // while hidden: a selection's unused object, and whether it is drawn
      for (const table of sources.keys()) {
        const l = window.emberEngine.layers.find((x) => x.table === table),
          t = ev.tables[table],
          flag = t?.columns[clustered.CLUSTERED],
          d = h.display.find((x) => x.table === table);
        if (!l || !flag) continue;
        const filter = custom.filterMask(t, custom.filters.peek()[table]),
          col = d.cut && t.columns[d.cut.column],
          min = d.cut ? (store.cuts.peek()[d.cut.group] ?? 0) : -Infinity,
          passing = (i) => (!filter || filter[i]) && (!col || col[i] >= min);
        drawn[table] = kept[table] = 0;
        for (let i = 0; i < flag.length; i++) {
          if (flag[i]) continue;
          if (l.passes(i)) drawn[table]++;
          if (passing(i)) kept[table]++;
        }
        if (!hidden[table]) continue;
        // an object that a plain relation (not a user's) links to an unused object that the cut and filter keep
        for (const [name, r] of Object.entries(h.relations)) {
          const rel = ev.relations[name];
          if (r.to !== table || r.from === table || sources.get(table).includes(name) || !rel) continue;
          let from = -1,
            row = -1;
          for (let f = 0; f + 1 < rel.offsets.length && from < 0; f++)
            for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++)
              if (!flag[rel.indices[k]] && passing(rel.indices[k])) {
                from = f;
                row = rel.indices[k];
                break;
              }
          if (from < 0) continue;
          store.selection.value = { table: r.from, row: from };
          await frames();
          const now = window.emberEngine.layers.find((x) => x.table === table);
          selected.push({ sel: `${r.from}:${from}`, obj: `${table}:${row}`, drawn: !!now?.passes(row) });
          store.selection.value = null;
          await frames();
          break;
        }
      }
      if (show) {
        clustered.hideUnclustered.value = defaults;
        await new Promise((r) => setTimeout(r, 1500));
      }
      return { tables: [...sources.keys()], hidden, drawn, kept, selected };
    }, show);
  const before = await state(false);
  if (!before.tables.length) return;
  const expected = hasDomainBar(h);
  log(`${tag}: unused objects of ${before.tables.join(", ")}: hidden ${JSON.stringify(before.hidden)}`);
  for (const t of before.tables)
    if (!!before.hidden[t] !== expected) fail(`${t}: unused objects ${expected ? "shown" : "hidden"} by default`);
  if (Object.entries(before.drawn).some(([t, n]) => before.hidden[t] && n > 0))
    fail(`unused objects drawn while hidden: ${JSON.stringify(before.drawn)}`);
  for (const s of before.selected) {
    log(`${tag}: selection ${s.sel} reaches the unused ${s.obj}: ${s.drawn ? "drawn" : "not drawn"}`);
    if (!s.drawn) fail(`the selection ${s.sel} does not draw its unused ${s.obj}`);
  }
  const shown = await state(true);
  log(
    `${tag}: unused objects drawn, all shown: ${JSON.stringify(shown.drawn)} (cuts keep ${JSON.stringify(shown.kept)})`,
  );
  if (JSON.stringify(shown.drawn) !== JSON.stringify(shown.kept))
    fail(
      `unused objects drawn once shown: ${JSON.stringify(shown.drawn)}, kept by cuts: ${JSON.stringify(shown.kept)}`,
    );
  // Each ticked such layer's chip, in its part of the detector: a click draws all its objects that the cuts keep,
  // another hides the unused ones again. Not for big events: each click rebuilds every layer, slow with software WebGL.
  if (!expected || small) return;
  const drawnUnused = (table) =>
    page.evaluate(async (table) => {
      const url = (f) =>
        performance
          .getEntriesByType("resource")
          .map((r) => r.name)
          .find((n) => n.includes(f));
      const store = await import(url("/src/model/store/index.ts")),
        clustered = await import(url("/src/model/event/clustered.ts"));
      const flag = store.event.peek().tables[table].columns[clustered.CLUSTERED],
        l = window.emberEngine.layers.find((x) => x.table === table);
      let n = 0;
      for (let i = 0; i < flag.length; i++) if (!flag[i] && l?.passes(i)) n++;
      return n;
    }, table);
  let at = "";
  for (const d of h.display.filter((x) => before.tables.includes(x.table) && x.visible && x.domain)) {
    if (!(d.table in shown.drawn)) continue; // not drawn in this event
    if (d.domain !== at) await chooseDomain(page, (at = d.domain));
    const chip = page
      .locator(".tabpanel details.part.here .layer", { hasText: d.label })
      .locator(".rowchip", { hasText: /^(in |all$)/ })
      .first();
    const text = (await chip.count()) ? await chip.innerText() : "";
    if (!text.startsWith("in ")) {
      if (shown.kept[d.table]) fail(`${d.label}: no chip that hides its unused objects (${text || "none"})`);
      continue;
    }
    await chip.click({ timeout: 120000 });
    await page.waitForTimeout(1500);
    const after = await chip.innerText(),
      all = await drawnUnused(d.table);
    await chip.click({ timeout: 120000 });
    await page.waitForTimeout(1500);
    const back = await chip.innerText(),
      none = await drawnUnused(d.table);
    log(`${tag}: ${d.label}'s chip: ${text} -> ${after} (${all} unused drawn) -> ${back} (${none})`);
    if (after !== "all" || back !== text) fail(`${d.label}'s chip does not switch: ${text} -> ${after} -> ${back}`);
    if (all !== shown.kept[d.table] || none !== 0)
      fail(
        `${d.label}'s chip: ${all} unused drawn on all (cuts keep ${shown.kept[d.table]}), ${none} once hidden again`,
      );
  }
  await chooseDomain(page, "All");
}

/** Layers with object rows (`list`): the ticked ones list their objects; pointing at a row rings its object; a click
 *  selects it (URL, card, the row marked); then H steps through how the rest of the event is drawn. */
async function checkObjectRows(page, h, fail, shot, tag) {
  // The first ticked layer with object rows that this viewer draws (it leaves out reprs it does not know), in its tab.
  const tabOf = (d) => (hasDomainBar(h) ? "Reconstruction" : (d.domain ?? "Objects"));
  let d;
  for (const x of h.display.filter((l) => l.list && l.visible)) {
    await page
      .getByRole("tab", { name: tabOf(x), exact: true })
      .click({ timeout: 120000 })
      .catch(() => {});
    if (await page.locator(".layer", { hasText: x.label }).count()) {
      d = x;
      break;
    }
  }
  if (!d) return log(`${tag}: no object rows drawn`);
  const rows = page.locator(".layer", { hasText: d.label }).locator("table.objects tbody tr:not(.more)");
  const n = await rows.count(),
    headline = await page
      .locator(".tabpanel .headline, .titlebox .headline")
      .first()
      .innerText()
      .catch(() => "");
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
  const s = hashParam(page, "s");
  const marked = await rows.first().getAttribute("class");
  log(`${tag}: a click on the first ${d.label} row selected ${s}`);
  if (!s.startsWith(`${d.table}:`) || !(await page.locator(".inspector").count()))
    fail(`a click on a ${d.label} row did not select it (s=${s})`);
  if (!marked?.includes("selected")) fail("the selected object's row is not marked");
  await shot("1_rows");
  const others = () =>
    page
      .locator(".viewchips .rest button.on")
      .innerText({ timeout: 5000 })
      .catch(() => "");
  const was = await others();
  await page.keyboard.press("h");
  await page.waitForTimeout(600);
  const now = await others();
  log(`${tag}: the rest of the event: ${was || "no choice shown"} -> H -> ${now}`);
  if (!was) fail("no choice of how the rest of the event is drawn while something is selected");
  else if (now === was) fail("H did not change how the rest of the event is drawn");
  for (let i = 0; i < 2; i++) await page.keyboard.press("h"); // back to the level it had
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  if (await page.locator(".viewchips .rest").count()) fail("the rest's choice stays without a selection");
}

/** A selection draws its objects that a ticked layer's filter hides (cuts still apply), and its levels drawn as lines
 *  that are ticked (e.g. a vertex's tracks): unticked ones it never draws. Finds, in the page (with the app's own
 *  modules), an object related through a plain relation to a row that a ticked non-onSelection layer's filter hides
 *  but its cut keeps; selects it and checks that row is drawn. */
async function checkFocusFilters(page, h, fail, tag) {
  if (!h.display.some((d) => d.filter && !d.onSelection)) return;
  const found = await page.evaluate(async () => {
    const url = (f) =>
      performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((n) => n.includes(f)); // the module's URL as loaded: ?t= after hot updates
    const store = await import(url("/src/model/store/index.ts")),
      custom = await import(url("/src/model/custom/settings.ts"));
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = store.bundle.peek(),
      ev = store.event.peek(),
      cuts = store.cuts.peek(),
      out = [],
      ticked = (x) => !!store.visible.peek()[store.layerKey(x)];
    for (const d of b.header.display.filter((x) => x.filter && !x.onSelection && ticked(x))) {
      const t = ev.tables[d.table],
        keep = t && custom.filterMask(t, custom.filters.peek()[d.table]);
      if (!keep) continue;
      const passes = (i) => !d.cut || Number(t.columns[d.cut.column][i]) >= (cuts[d.cut.group] ?? 0);
      for (const [name, r] of Object.entries(b.header.relations)) {
        const rel = ev.relations[name];
        if (!rel || r.association || r.inverseOf || r.to !== d.table || r.from === d.table) continue;
        let from = -1,
          row = -1;
        for (let f = 0; f + 1 < rel.offsets.length && from < 0; f++)
          for (let k = rel.offsets[f]; k < rel.offsets[f + 1]; k++)
            if (!keep[rel.indices[k]] && passes(rel.indices[k])) {
              from = f;
              row = rel.indices[k];
              break;
            }
        if (from < 0) continue;
        store.selection.value = { table: r.from, row: from };
        await frames();
        const layer = window.emberEngine.layers.find((l) => l.table === d.table);
        const lines = store.levels
          .peek()
          .filter((l) => l.layers.every((x) => x.repr === "helix" || x.repr === "segments"));
        const undrawn = lines
          .flatMap((l) => l.layers)
          .filter((x) => ticked(x) && !window.emberEngine.layers.some((l) => l.table === x.table))
          .map((x) => x.table);
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
    log(
      `${tag}: focus ${f.sel} reaches ${f.table} #${f.row}, hidden by the filter: ${f.drawn ? "drawn" : "not drawn"}${f.undrawn.length ? `; levels of lines not drawn: ${f.undrawn}` : ""}`,
    );
    if (!f.drawn) fail(`selecting ${f.sel} does not draw ${f.table} #${f.row}, which the layer's filter hides`);
    if (f.undrawn.length) fail(`selecting ${f.sel} does not draw its levels of lines: ${f.undrawn.join(", ")}`);
  }
}

/** The focus draws the ticked collections only: by default no layer of an earlier reconstruction stage. ↓ (or ↑ when a
 *  level in between is ticked already) moves the tick to another level (its pill lit, the layers drawn change, a shower
 *  focus with none ticked before becomes an outline around it); the other key moves it back. Then the pair's particle
 *  opens its own pair. */
async function checkLevels(page, h, target, fail, shot, tag) {
  const drawn = async () => (await drawnTables(page)).sort().join();
  const style = () =>
    page.evaluate((t) => {
      // shower layers: the surface style and transparency of the focus's layer
      const m = window.emberEngine.layers.find((l) => l.table === t)?.object.children?.[0]?.material;
      return m?.uniforms?.uStyle ? `${m.uniforms.uStyle.value}/${m.transparent}` : "";
    }, target.table);
  const style0 = await style();
  const before = await drawn(),
    pills = await page.locator(".inspector .rung.below .rkind, .inspector .rung.beside .rkind").allInnerTexts();
  const earlier = h.display
    .filter((d) => target.stage !== undefined && d.stage !== undefined && d.stage < target.stage)
    .map((d) => d.table);
  const early = before.split(",").filter((t) => earlier.includes(t));
  if (early.length) fail(`focus on ${target.table} draws earlier stages by default: ${early.join(", ")}`);
  if (!(await page.locator(".inspector .rung .level:not(.always)").count()))
    return log(`${tag}: levels: ${pills.join(" › ") || "none"} (none to step through)`);
  const lit0 = await page.locator(".inspector .rung.shown .rkind").allInnerTexts(),
    [there, back] = lit0.length ? ["ArrowUp", "ArrowDown"] : ["ArrowDown", "ArrowUp"];
  await page.keyboard.press(there);
  await page.waitForTimeout(600);
  const lit = await page.locator(".inspector .rung.shown .rkind").allInnerTexts(),
    moved = await drawn(),
    key = there === "ArrowUp" ? "↑" : "↓";
  log(
    `${tag}: levels: ${pills.join(" › ").replace(/\s+/g, " ")}; ticked ${lit0.join() || "none"}, ${key} ticks ${lit.join() || "nothing"}`,
  );
  if (lit.length !== 1 || lit[0] === lit0[0] || moved === before)
    fail(`${key} did not move the tick to another level (lit: ${lit.join() || "none"})`);
  if (!new URL(page.url()).hash.includes("lv=")) fail("the level ticked is not in the URL (lv)");
  if (style0 && !lit0.length && (await style()) === style0)
    fail("↓ did not draw the focus as an outline around the level");
  await shot("3b_level");
  await page.keyboard.press(back);
  await page.waitForTimeout(600);
  if ((await drawn()) !== before) fail("the other key did not move the tick back to the focus's first layers");
  if ((await style()) !== style0) fail("the other key did not give the focus its first surface back");
  // In the truth <-> reco pair view, the pair's particle opens its own pair, which names it on its truth line. (Not
  // the chip of the one-line answer, named by energy next to a calorimeter part.)
  const particle = page.locator(".inspector .truthline:not(.answer) .chip").first();
  if (!(await page.locator(".pairline").count()) || !(await particle.count())) return;
  const name = (await particle.innerText()).replace(/\s+/g, " ");
  await particle.click();
  await page.waitForTimeout(1200);
  const truthLine = (
    await page
      .locator(".inspector .pair .pairline")
      .first()
      .innerText()
      .catch(() => "")
  ).replace(/\s+/g, " ");
  log(`${tag}: the pair from its particle: ${truthLine || "none"}`);
  if (!truthLine.includes(name)) fail(`the particle ${name} does not open its own pair`);
  await page.locator(".inspector .looking .lookhead .link").click({ timeout: 120000 }); // stop looking at the particle
  await page.waitForTimeout(600);
}

/** With a domain bar: D keeps the selection and moves to the next domain it has objects in; a chip of the focus bar
 *  looks at its part of the detector, keeping the focus. */
async function checkDomainFocus(page, h, fail, shot, tag) {
  if (!hasDomainBar(h) || !(await page.locator(".inspector").count())) return;
  const state = () => {
    const p = new URLSearchParams(new URL(page.url()).hash.slice(1));
    return [p.get("d"), p.get("s")];
  };
  const [d0, s0] = state();
  await page.keyboard.press("d");
  await page.waitForTimeout(1200);
  const [d1, s1] = state();
  log(`${tag}: D with ${s0} selected: ${d0} -> ${d1}, selection ${s1}`);
  if (d1 === d0) fail("D did not change the domain with a selection");
  if (s1 !== s0) fail(`D did not keep the selection (${s0} -> ${s1})`);
  const chip = page.locator(".inspector .rung .rtools .link").first(); // a step in another domain
  if (await chip.count()) {
    const name = (await chip.innerText()).split(/\s/)[0];
    await chip.click({ timeout: 120000 }); // software WebGL: a PU200 scene keeps the page busy
    await page.waitForTimeout(1200);
    const [d2, s2] = state();
    log(`${tag}: chip ${name}: ${d1} -> ${d2}, selection ${s2}`);
    if (d2 !== name || s2 !== s0)
      fail(`the ${name} chip did not look at ${name} keeping the selection (d=${d2}, s=${s2})`);
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

/** Those who ask for less motion get the selection's card without its slide-in. */
async function checkReducedMotion(page, fail) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const animation = await page.$eval(".inspector", (card) => getComputedStyle(card).animationName);
  await page.emulateMedia({ reducedMotion: null });
  if (animation !== "none") fail(`the card slides in for those who ask for less motion (animation ${animation})`);
}

/** X crosses the reco <-> truth link from a selected object that has a match, and B comes back. */
async function checkCross(page, h, fail, tag) {
  const sel = () => hashParam(page, "s");
  const truth = new Set(h.display.filter((d) => d.truth).map((d) => d.table)),
    s0 = sel();
  const unticked = async (what) => {
    const u = await untickedDrawn(page);
    if (u.length) fail(`${what} draws collections that are not ticked: ${u.join(", ")}`);
    return u;
  };
  await unticked(`the selection ${s0}`);
  if (!(await page.locator(".inspector .rung.self .rlink.match .chip").count())) {
    // No match of its own (a TICL candidate): X goes to its part's particle, in the truth <-> reco pair view, where
    // unticked collections (its layer clusters, its candidate tracksters) used to come back.
    if (!(await page.getByRole("button", { name: "Go to truth (X)" }).count())) return;
    await page.keyboard.press("x");
    await page.waitForTimeout(900);
    if (await page.locator(".inspector .chooser").count()) {
      await page.keyboard.press("x"); // X again: the first part's particle
      await page.waitForTimeout(900);
    }
    const s1 = sel();
    if (s1 === s0) return log(`${tag}: X from ${s0} goes nowhere`);
    const u = await unticked(`X from ${s0} to ${s1}`);
    log(
      `${tag}: X from ${s0} -> ${s1}: ${u.length ? `draws unticked ${u.join(", ")}` : "draws only ticked collections"}`,
    );
    await page.keyboard.press("b");
    await page.waitForTimeout(900);
    if (sel() !== s0) fail(`B did not come back from ${s1} to ${s0}`);
    return;
  }
  await page.keyboard.press("x");
  await page.waitForTimeout(900);
  const s1 = sel(),
    across = truth.has(s1.split(":")[0]) !== truth.has(s0.split(":")[0]);
  const lanes = await page.locator(".inspector .ladder .rung").count();
  await unticked(`X from ${s0} to ${sel()}`);
  await page.keyboard.press("b");
  await page.waitForTimeout(900);
  log(`${tag}: X from ${s0} -> ${s1} (${lanes} steps on that side), B -> ${sel()}`);
  if (!across) fail(`X did not cross the reco <-> truth link (${s0} -> ${s1})`);
  if (!lanes) fail(`the other side of the link shows no steps (${s1})`);
  if (sel() !== s0) fail(`B did not come back from ${s1} to ${s0}`);
}

/** The tables of drawn layers that are not ticked, other than the selected object's and the focus's own, and the truth
 *  drawn for the Truth tab's picks (its particles and vertices): the only ones a selection may draw unticked
 *  (store/selection.ts focusRows). */
const untickedDrawn = (page) =>
  page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .find((n) => n.includes("/src/model/store/index.ts"));
    const store = await import(url),
      own = new Set([store.selection.peek()?.table, store.focus.peek()?.table]),
      picked = store.focusPicked.peek() ? [...(store.truthDrawn.peek()?.keys() ?? [])] : [];
    for (const t of picked) own.add(t);
    const ticks = store.visible.peek(),
      display = store.bundle.peek().header.display;
    return window.emberEngine.layers
      .map((l) => display.find((d) => d.table === l.table && store.layerKey(d) === l.key))
      .filter((d) => d && !ticks[store.layerKey(d)] && !own.has(d.table))
      .map((d) => d.table);
  });

/** "only" on a kind's heading draws that kind alone, keeps it in the URL, and "show everything" brings the rest back. */
async function checkOnly(page, h, fail, shot, tag) {
  const tables = async () => (await drawnTables(page)).sort().join();
  // the first heading on screen: a folded part keeps its sections, out of sight (the parts keep the bar's order)
  const button = page.locator(".sidebar .tabpanel section.kind:not(.folded) h3:visible .only").first();
  if (!(await button.count())) return;
  const before = await tables(),
    heading = button.locator("xpath=.."),
    group = (await heading.locator(".fold").innerText()).trim();
  await heading.hover({ timeout: 120000 }); // "only" shows where the pointer is
  await button.click({ timeout: 120000 });
  await page.waitForTimeout(1200);
  const alone = (await tables()).split(",").filter(Boolean),
    groupOf = Object.fromEntries(h.display.map((d) => [d.table, d.group]));
  const others = alone.filter((t) => groupOf[t].toLowerCase() !== group.toLowerCase());
  log(`${tag}: only ${group}: draws ${alone.join(", ") || "nothing"}`);
  if (others.length) fail(`only ${group} still draws ${others.join(", ")}`);
  if (!new URL(page.url()).hash.includes("only=")) fail("the kind looked at alone is not in the URL (only)");
  await shot("5_only");
  await page.locator(".solobar button").click({ timeout: 120000 });
  await page.waitForTimeout(1200);
  if ((await tables()) !== before) fail(`"show everything" did not bring the other layers back`);
}

/** With truth matches in the bundle, the Truth tab has the event's scorecard, folded in Details under the truth
 *  graph: a row per matched kind, and a count unfolds to its objects. */
async function checkScorecard(page, h, fail, shot, tag) {
  const truth = new Set(h.display.filter((d) => d.truth).map((d) => d.table));
  if (
    !Object.values(h.relations).some(
      (r) => r.match && truth.has(r.to) && h.display.some((d) => d.table === r.from && !legacyCopy(d)),
    )
  )
    return;
  await page.getByRole("tab", { name: "Truth", exact: true }).click();
  // unfold Details and the scorecard unless open already (the tab keeps its sections' state)
  if (await page.locator("section.details > details:not([open])").count())
    await page.locator("section.details > details > summary").click();
  if (await page.locator("section.scorecard details:not([open])").count())
    await page.locator("section.scorecard summary").click();
  const rows = await page.locator("table.score tbody tr:not(.list)").count(),
    number = page.locator("table.score .num:not(.zero)").first();
  if (!rows) return fail("no reco <-> truth scorecard in the Truth tab");
  if (await number.count()) {
    await number.click();
    if (!(await page.locator("table.score tr.list .chip").count()))
      fail("a scorecard count did not unfold to its objects");
  }
  log(`${tag}: scorecard: ${rows} matched kinds`);
  await shot("6_scorecard");
}

/** The interaction checks, for one bundle: the menu, the themes, help, a rotate drag keeping the selection, a custom
 *  column used for colour and as a filter, the replay and the tour. */
async function deepChecks(page, h, fail, shot) {
  // The menu: every control with its key; an item acts and closes it; Esc closes it and keeps the selection.
  const menu = page.locator(".menubutton"),
    item = (name) => page.locator(".menupanel [role^=menuitem]", { hasText: name });
  await menu.click();
  const items = await page.locator(".menupanel [role^=menuitem]").count(),
    keyed = await page.locator(".menupanel kbd").count();
  const labels = await item("Labels").getAttribute("aria-checked");
  await shot("5_menu");
  await item("Labels").click();
  await menu.click();
  const labelsAfter = await item("Labels").getAttribute("aria-checked");
  await page.keyboard.press("Escape");
  const closed = !(await page.locator(".menupanel").count()),
    kept = await page.locator(".inspector").count();
  log(
    `  menu: ${items} items, ${keyed} with a key; Labels ${labels} -> ${labelsAfter}; Esc closes it: ${closed}, keeps the selection: ${!!kept}`,
  );
  if (items < 10 || keyed < 8) fail(`the menu lists ${items} items, ${keyed} with a key`);
  if (labels === labelsAfter) fail("the menu's Labels item did not toggle the labels");
  if (!closed || !kept) fail("Esc did not close the menu alone");
  await page.keyboard.press("l"); // labels back on
  await page.locator(".actions [title='Light theme']").click();
  await shot("5_light");
  await page.locator(".actions [title='Dark theme']").click();
  // A press-drag-release rotates; it is not a click, so the selection stays.
  await page.mouse.move(700, 600);
  await page.mouse.down();
  await page.mouse.move(780, 560, { steps: 8 });
  await page.mouse.up();
  if (!(await page.locator(".inspector").count())) fail("a rotate drag cleared the selection");
  await page.keyboard.press("?");
  await shot("6_help");
  await page.keyboard.press("Escape");
  // Save picture: the preview with the label and the key over the view; a PNG of the size chosen that says, in its
  // text fields, where it comes from.
  await menu.click();
  await item("Save picture").click();
  await page.waitForSelector(".picture-preview");
  await page.waitForTimeout(500);
  await shot("6_picture");
  const lines = await page.locator(".picture-form .line").count();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    page.getByRole("button", { name: "Save PNG" }).click(),
  ]);
  const png = readFileSync(await download.path());
  log(`  picture: ${download.suggestedFilename()}, ${png.length} bytes; ${lines} lines to edit`);
  if (png.readUInt32BE(0) !== 0x89504e47) fail("the saved picture is not a PNG");
  if (!png.includes("iTXtSource")) fail("the saved picture does not say where it comes from");
  await page.keyboard.press("Escape");

  // From the first layer's ⋯: custom column r = hypot(x, y) on its table (abs of its first float column if it has no
  // x, y: tracks, jets); colour the layer by it; then a filter hiding every row, shown on the layer's row.
  const firstLayer = page.locator(".layer").first(),
    count = async () => (await firstLayer.locator(".count").innerText()).replace(/,/g, "");
  const table = (await firstLayer.locator("label").getAttribute("title")).split(":")[0],
    columns = h.tables[table]?.columns ?? {};
  const expr =
    "x" in columns && "y" in columns
      ? "hypot(x, y)"
      : `abs(${Object.keys(columns).find((c) => columns[c].type === "f32")})`;
  await firstLayer.locator(".row").hover(); // ⋯ shows where the pointer is
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
  if (!(await firstLayer.locator(".rowchip.filter").count())) fail("the filter is not shown on the layer's row");
  const after = await count();
  log(`  first layer: ${before} without the filter, ${after} with r < 0`);
  if (!after.startsWith("0 /")) fail("the filter did not hide the rows");
  await shot("7_filter");
  // Remove it again: the replay below builds this layer's objects too (e.g. tracks, when the first layer is theirs).
  await firstLayer.locator(".rowchip.filter").click({ timeout: 120000 }); // its chip opens the filter, with its removal
  await page.locator(".popover .remove").click({ timeout: 120000 });
  if ((await count()).startsWith("0 /")) fail(`removing the filter did not bring the rows back (${await count()})`); // the layer's default filter goes too

  await page.keyboard.press("Escape"); // the replay and tour start from the whole event
  await checkReplay(page, h, fail);

  // The tour builds the event up step by step (control/tour.ts: its captions in the order of window.emberTourPlan), or
  // for a bundle without the kinds the steps name, replays it and selects its main showers; any key stops it.
  const cam = () => page.evaluate(() => window.emberEngine.cam3d.position.toArray().map(Math.round).join());
  const c0 = await cam();
  await page.evaluate(() => {
    window.tourCaptions = [];
    new MutationObserver(() => {
      const t = document.querySelector(".caption.tour b")?.textContent;
      if (t && window.tourCaptions.at(-1) !== t) window.tourCaptions.push(t);
    }).observe(document.querySelector(".viewport"), { subtree: true, childList: true, characterData: true });
  });
  await page.keyboard.press("p");
  const staged = await succeeds(page.waitForFunction(() => window.tourCaptions.length >= 3, null, { timeout: 90000 }));
  const toured = staged || (await succeeds(page.waitForSelector(".inspector", { timeout: 60000 })));
  const c1 = await cam();
  await shot("8_tour");
  const [shown, plan] = await page.evaluate(() => [window.tourCaptions, window.emberTourPlan ?? []]);
  await page.keyboard.press("Escape");
  log(
    `  tour: camera ${c0} -> ${c1}; steps shown: ${shown.join(" | ") || "-"}; plan: ${plan.join(" | ") || "- (replay and showers)"}`,
  );
  if (c0 === c1 || !toured) fail("the tour did not move the camera, or show its steps or a shower");
  if (plan.length && shown.some((c, k) => c !== plan[k])) fail("the tour's steps are not shown in the plan's order");
  if (await page.locator(".eventnav .icon-button.on").count()) fail("a key press did not stop the tour");
  if (await page.locator(".caption.tour").count()) fail("the tour's caption stayed after it stopped");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1500);
  await shot("9_next_event");
}

/** The replay (R): hit layers arrive in the physics phase; with paths built from their parts (display hint `grow`),
 *  the seeding, building and fitting captions come in order before any later step, and every path is complete by the
 *  fit. */
async function checkReplay(page, h, fail) {
  // Captions shown, recorded as they change by a MutationObserver installed before R, with the replay clock (a poller
  // missed short ones whenever software-WebGL frames were slow).
  await page.evaluate(() => {
    window.captions = [];
    const root = document.querySelector(".viewport");
    window.captionObserver = new MutationObserver(() => {
      const t = document.querySelector(".caption b")?.textContent,
        e = window.emberEngine;
      if (t && !t.startsWith("t =") && window.captions.at(-1)?.[0] !== t)
        window.captions.push([t, e.replayClock ? (performance.now() - e.replayClock.t0) / 1000 : 0]);
    });
    window.captionObserver.observe(root, { subtree: true, childList: true, characterData: true });
  });
  await page.keyboard.press("r");
  if (!(await page.evaluate(() => window.emberEngine.replaying))) fail("R did not start a replay");
  // Each hit layer arrives in the physics phase (the first 3 s, render/replay.ts TRAVEL) in any colour mode, not with
  // the clusters: half of its hits by then. A layer has instances only for the rows the filter can show.
  const hitsAt = await page.evaluate(() =>
    window.emberEngine.layers
      .filter((l) => l.key.endsWith(":cells") && !l.context && l.object.geometry.getAttribute("iT").array.length)
      .map((l) => {
        const t = [...l.object.geometry.getAttribute("iT").array].sort((a, b) => a - b);
        return [l.label, t[t.length >> 1]];
      }),
  );
  log(
    `  replay: half the hits shown after ${hitsAt.map(([l, t]) => `${t.toFixed(2)} s (${l})`).join(", ") || "- (no hit layer)"}`,
  );
  for (const [l, t] of hitsAt)
    if (!(t < 3)) fail(`${l}: the hits appear after the physics phase of the replay (half by ${t.toFixed(2)} s)`);
  // Paths built from their parts (display hint `grow`): when each is complete (iL) and when its parts light up.
  const grown = h.display.filter((d) => d.grow).map((d) => [`${d.table}:${d.repr}`, h.relations[d.grow.parts]?.to]);
  const building = await page.evaluate(
    (grown) =>
      grown.map(([key, parts]) => {
        const layers = window.emberEngine.layers,
          g = layers.find((l) => l.key === key)?.object.geometry,
          growth = window.emberPlan?.growth;
        const appear = g?.getAttribute("iT").array ?? [],
          ends = g?.getAttribute("iL").array ?? [];
        const lit = layers.find((l) => l.table === parts)?.object.geometry.getAttribute("iL").array ?? [];
        // every path grows from the building's start (not the 0.5 s of an appearing line) and is whole by the fit
        const late = growth
          ? [...ends].filter(
              (t, i) => !(appear[i] < t && Math.abs(appear[i] - growth.build) < 1e-4 && t <= growth.complete + 1e-4),
            ).length
          : -1;
        return {
          key,
          paths: ends.length,
          done: Math.max(...ends),
          late,
          lit: lit.filter((t) => t < 1e28).length,
          parts: lit.length,
        };
      }),
    grown,
  );
  await page
    .waitForFunction(() => !window.emberEngine.replaying, null, { timeout: 60000 })
    .catch(() => fail("the replay did not end"));
  const shown = await page.evaluate(() => {
    window.captionObserver.disconnect();
    return window.captions;
  });
  // The plan's captions, sampled every 10 ms of the replay clock. A frame slower than a short step (the fit) skips it
  // on screen, so what was shown must follow the plan's order, maybe with gaps.
  const captions = await page.evaluate(() => {
    const p = window.emberPlan,
      out = [];
    for (let s = 0; p && s < p.seconds; s += 0.01) {
      const t = p.caption(s)?.title;
      if (t && !t.startsWith("t =") && out.at(-1)?.[0] !== t) out.push([t, s]);
    }
    return out;
  });
  log(`  replay captions: ${captions.map(([c]) => c).join(" | ")}; shown: ${shown.map(([c]) => c).join(" | ")}`);
  let k = 0;
  for (const [c] of shown) {
    while (k < captions.length && captions[k][0] !== c) k++;
    if (k++ >= captions.length) {
      fail(`caption "${c}" shown out of the plan's order`);
      break;
    }
  }
  if (!shown.length && captions.length) fail("no replay caption shown");
  // Every path is built to its full length by the time the fit is shown, and the steps after it wait for it.
  for (const b of building) {
    const at = (word) => captions.findIndex(([c]) => c.startsWith(word)),
      fit = captions[at("Fitting")]?.[1];
    log(
      `  replay builds ${b.key}: ${b.paths} paths complete by ${b.done.toFixed(2)} s (the fit from ${fit?.toFixed(2) ?? "-"} s), ${b.lit} of ${b.parts} parts lit`,
    );
    if (!(at("Seeding") >= 0 && at("Seeding") < at("Building") && at("Building") < at("Fitting")))
      fail(`${b.key}: no seeding, building and fitting captions in order`);
    if (captions.some(([c], k) => k < at("Fitting") && /^(Clustering|Building (?!.* outwards)|.* → )/.test(c)))
      fail(`${b.key}: a later step started before the paths were built`);
    if (!b.paths || b.late)
      fail(
        `${b.key}: ${b.late < 0 ? "no plan" : `${b.late} paths`} not built from the building's start to whole by the fit`,
      );
    if (b.parts && !b.lit) fail(`${b.key}: no part lit up`);
  }
}
