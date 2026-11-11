// Browser check (headless Chromium, software WebGL) of every bundle in the site's index.json, or of those named.
// Each: layers draw, presets and colour modes apply (with a key), summary charts show where the profile defines them,
// selecting an object shows what is related and only its bottom level (↓ ↑ step through the others), a related
// object can be jumped to and back, Esc leaves. One bundle (`--deep`, default the smallest with reconstruction
// stages) also gets: themes, help, a rotate drag keeping the selection, a custom column used for colour and a filter,
// the replay and the tour. Any console error, or a bundle taking over BUNDLE_TIMEOUT, fails.
// Screenshots: <dir>/<bundle>_*.png (one small one for scenes over BIG objects). Progress: one timestamped line per step.
// Usage: node e2e/smoke.mjs <dev server URL> <screenshot dir> [--deep <bundle>] [bundle ...]  (dev builds expose the engine)
import { chromium } from "playwright";

const args = process.argv.slice(2), deepAt = args.indexOf("--deep");
const deepName = deepAt >= 0 ? args.splice(deepAt, 2)[1] : undefined;
const [base = "http://127.0.0.1:5173/", out = "e2e/shots", ...names] = args;
const files = names.length ? names : (await (await fetch(`${base}index.json`)).json()).bundles.map((b) => b.file);
const headers = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await header(f)])));
const deep = deepName ?? files.filter((f) => headers[f].display.some((d) => d.stage !== undefined)).sort((a, c) => headers[a].size - headers[c].size)[0];

const BUNDLE_TIMEOUT = 300_000; // ms: a bundle not checked by then fails, and the run goes on with the next
const BIG = 200_000; // objects drawn above which a bundle gets one small screenshot (software WebGL is slow)
const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const problems = [];
for (const file of files) {
  const tag = file.replace(/\.evdb$/, ""), t0 = Date.now(), state = { page: null };
  let timer;
  const result = await Promise.race([
    checkBundle(file, tag, state).then(() => "checked", (e) => `error: ${e.message.split("\n")[0]}`),
    new Promise((done) => (timer = setTimeout(() => done(`not finished after ${BUNDLE_TIMEOUT / 1000} s`), BUNDLE_TIMEOUT))),
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
  const open = async (hash) => { // a fresh page each time: software WebGL is slow to let go of a big scene
    await page?.close();
    page = state.page = await browser.newPage({ viewport: small ? { width: 720, height: 450 } : { width: 1440, height: 860 } });
    page.on("console", (m) => m.type() === "error" && fail(m.text()));
    page.on("pageerror", (e) => fail(e.message));
    await page.goto(`${base}#${hash}`, { timeout: 90000 });
    await page.waitForSelector(".eventid strong:has-text('Event')", { timeout: 90000 });
    await page.waitForTimeout(1200);
  };

  await open(`b=${file}&e=1`);
  const [drawn, objects] = await page.evaluate(() => [window.evdEngine.layers.length, window.evdEngine.layers.reduce((s, l) => s + l.x.length, 0)]);
  const rows = await page.$$eval(".layer:not(.off) label", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  log(`${tag}: ${drawn} layers, ${objects} objects drawn: ${rows.join(" | ")}`);
  if (!drawn) fail("no layer drawn");
  if ((small = objects > BIG)) await page.setViewportSize({ width: 720, height: 450 });
  await shot("1_layers");

  for (const name of await page.$$eval(".segmented.presets button", (b) => b.map((x) => x.textContent))) {
    const button = page.locator(".segmented.presets button", { hasText: name });
    await button.click();
    if (!(await button.getAttribute("class"))?.includes("on")) fail(`preset ${name} did not apply`);
  }

  // Colour modes: each applies; "Particle type" shows a key naming its colours. The last mode clicked is "Per layer", so
  // the default mode is selected again first.
  for (const name of await page.$$eval(".colourmode .segmented button", (b) => b.map((x) => x.textContent))) {
    const button = page.locator(".colourmode .segmented button", { hasText: name });
    await button.click();
    if (!(await button.getAttribute("class"))?.includes("on")) fail(`colour mode ${name} did not apply`);
    const keys = await page.locator(".colourmode .key li").count();
    log(`${tag}: colour mode ${name}: ${keys} key entries`);
    if (name !== "Per layer" && !keys) fail(`colour mode ${name}: no key`);
    await shot(`1_mode_${name.replace(/\W+/g, "_")}`);
  }
  await page.locator(".colourmode .segmented button").first().click().catch(() => {});

  await page.getByRole("tab", { name: "Event", exact: true }).click();
  const charts = await page.locator(".bars").count(), run = await page.locator(".card h3", { hasText: /^Run \d+/ }).count();
  log(`${tag}: ${charts} summary charts (profile defines ${h.summaries?.length ?? 0}), run information ${run ? "shown" : "none"}`);
  if (h.summaries?.length && !charts) fail("no summary charts");
  await shot("2_event");

  // Select an object that is made of others: from a relation into a drawn table, preferring later stages.
  const drawnTables = new Set(h.display.map((d) => d.table));
  const score = (d) => Object.values(h.relations).filter((r) => !r.association && r.from === d.table)
    .reduce((s, r) => Math.max(s, (drawnTables.has(r.to) ? 100 : 1) + (d.stage ?? 0)), 0);
  const target = h.display.filter((d) => d.visible && !d.context).sort((a, c) => score(c) - score(a))[0];
  if (!target || !score(target)) return log(`${tag}: nothing made of other objects to select`);
  await open(`b=${file}&e=1&s=${target.table}:0`);
  const related = await page.locator(".inspector [role=tab]", { hasText: "Related" }).innerText().catch(() => "");
  if (!/Related · [1-9]/.test(related)) fail(`selecting ${target.table} #0 shows nothing related (${related})`);
  // In the "Particle type" mode a selection shows its truth <-> reco pair (a candidate, and its particle with truth).
  if (await page.locator(".colourmode").count()) {
    const pair = await page.locator(".colourmode .pairline").innerText().catch(() => "");
    log(`${tag}: pair ${pair.replace(/\s+/g, " ")}`);
    if (!pair) fail("no truth <-> reco pair for the selection");
  }
  await shot("3_selected");
  // The levels need an object made of several kinds (row 0 may be e.g. a track-only candidate): the first such row.
  const pills = () => page.locator(".focusbar .level").count();
  let row = 0;
  if (target.stage !== undefined) for (let r = 1; r < 6 && (await pills()) < 2; r++) await open(`b=${file}&e=1&s=${target.table}:${(row = r)}`);
  if (row && (await pills()) < 2) await open(`b=${file}&e=1&s=${target.table}:${(row = 0)}`);
  await checkLevels(page, h, target, fail, shot, tag);
  const focused = async () => `${await page.locator(".focusbar b").innerText().catch(() => "")} (${decodeURIComponent(new URL(page.url()).hash.match(/s=([^&]+)/)?.[1] ?? "")})`;
  const first = await focused();
  await page.locator(".inspector [role=tab]", { hasText: "Related" }).click();
  await page.locator(".inspector .related .chip").first().click();
  await page.waitForTimeout(900);
  const jumped = await focused();
  await shot("4_jumped");
  // force: Playwright's "stable" check waits for animation frames, which software WebGL makes very slow on big scenes.
  await page.locator(".focusbar button", { hasText: "←" }).click({ force: true, timeout: 30000 }).catch(() => fail("no way back after a jump"));
  const back = await focused();
  log(`${tag}: focus ${first} -> ${jumped} -> back to ${back}`);
  if (first.startsWith(" ") || jumped === first || back !== first) fail("jumping to a related object and back did not move the focus");
  await page.keyboard.press("Escape");
  if (await page.locator(".inspector, .focusbar").count()) fail("Esc did not leave the selection");
  if (file === deep && small) log(`${tag}: too big for the interaction checks with software WebGL`);
  else if (file === deep) {
    await open(`b=${file}&e=1&s=${target.table}:0`);
    await deepChecks(page, fail, shot);
  }
}

// The focus is drawn with its bottom level (e.g. hits) only: no layer of an earlier reconstruction stage. ↓ adds one
// level in between (one more layer kind drawn, its pill lit) and turns a shower focus into an outline around it; ↑
// goes back.
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
  if (style0 && (await style()) === style0) fail("↓ did not draw the focus as an outline around the level");
  await shot("3b_level");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(600);
  if ((await drawn()) !== before) fail("↑ did not go back to the focus's default layers");
  if ((await style()) !== style0) fail("↑ did not give the focus its own surface back");
  // In the truth <-> reco pair view, the pair's particle shows the same layers as its candidate.
  const particle = page.locator(".inspector .truthline .chip").first();
  if (!(await page.locator(".pairline").count()) || !(await particle.count())) return;
  await particle.click();
  await page.waitForTimeout(900);
  const fromTruth = await drawn();
  log(`${tag}: the pair from its particle: ${fromTruth === before ? "same layers" : `other layers (${fromTruth})`}`);
  if (fromTruth !== before) fail("the pair's particle and candidate draw different layers");
  await page.locator(".focusbar button", { hasText: "←" }).click({ force: true, timeout: 30000 });
  await page.waitForTimeout(600);
}

async function deepChecks(page, fail, shot) {
  await page.getByTitle("Light theme").click();
  await shot("5_light");
  await page.getByTitle("Dark theme").click();
  // A press-drag-release rotates; it is not a click, so the selection stays.
  await page.mouse.move(700, 600); await page.mouse.down(); await page.mouse.move(780, 560, { steps: 8 }); await page.mouse.up();
  if (!(await page.locator(".inspector").count())) fail("a rotate drag cleared the selection");
  await page.keyboard.press("?");
  await shot("6_help");
  await page.keyboard.press("Escape");

  // Custom column r = hypot(x, y) on the first table; colour its layer by it; then a filter hiding every row.
  const firstLayer = page.locator(".layer").first(), count = async () => (await firstLayer.locator(".count").innerText()).replace(/,/g, "");
  await page.getByRole("tab", { name: "Columns", exact: true }).click();
  await page.locator(".exprform .name").fill("r");
  await page.locator(".exprform .expr").fill("hypot(x, y)");
  log(`  expression preview: ${await page.locator(".exprform .feedback").innerText()}`);
  await page.getByRole("button", { name: "Add column" }).click();
  await page.getByRole("tab", { name: "Layers", exact: true }).click();
  await firstLayer.locator(".colourby").selectOption("r");
  await page.waitForTimeout(500);
  log(`  legend coloured by r: ${await firstLayer.locator(".legend").innerText()}`);
  const before = await count();
  await page.getByRole("tab", { name: "Cuts", exact: true }).click();
  await page.locator(".exprform .expr").fill("r < 0");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await page.getByRole("tab", { name: "Layers", exact: true }).click();
  const after = await count();
  log(`  first layer: ${before} without the filter, ${after} with r < 0`);
  if (!after.startsWith("0 /")) fail("the filter did not hide the rows");
  await shot("7_filter");

  await page.keyboard.press("Escape"); // the replay and tour start from the whole event
  await page.keyboard.press("r");
  if (!(await page.evaluate(() => window.evdEngine.replaying))) fail("R did not start a replay");
  await page.evaluate(() => { // captions, recorded in the page (screenshots are too slow with software WebGL)
    window.captions = [];
    window.captionTimer = setInterval(() => {
      const t = document.querySelector(".caption b")?.textContent;
      if (t && !t.startsWith("t =") && window.captions.at(-1) !== t) window.captions.push(t);
    }, 50);
  });
  await page.waitForFunction(() => !window.evdEngine.replaying, null, { timeout: 60000 }).catch(() => fail("the replay did not end"));
  log(`  replay captions: ${await page.evaluate(() => { clearInterval(window.captionTimer); return window.captions.join(" | "); })}`);

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

/** The bundle's JSON header and file size: two range requests, or the whole file from a server without ranges. */
async function header(file) {
  const get = (from, to) => fetch(`${base}${file}`, { headers: { Range: `bytes=${from}-${to}` } });
  const head = await get(0, 11), buf = Buffer.from(await head.arrayBuffer()), n = buf.readUInt32LE(8);
  if (head.status === 200) return { ...JSON.parse(buf.subarray(12, 12 + n).toString()), size: buf.length };
  const size = Number(head.headers.get("Content-Range")?.split("/")[1]);
  return { ...JSON.parse(Buffer.from(await (await get(12, 11 + n)).arrayBuffer()).toString()), size };
}
