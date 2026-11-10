// Smoke test in headless Chromium (software WebGL): load a bundle, check SoA and legacy rechits agree under the
// shared cut, select and zoom to a trackster, switch views, themes and tabs, open help, add a custom column, colour
// and filter by it, run the tour, step events.
// Usage: node e2e/smoke.mjs <viewer URL> <screenshot dir>
import { chromium } from "playwright";

const [base = "http://127.0.0.1:5173/", out = "e2e/shots"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(e.message));
const ready = () => page.waitForSelector(".eventid strong:has-text('Event')", { timeout: 60000 }).then(() => page.waitForTimeout(900));
const shot = async (name) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png` }); };

await page.goto(`${base}#b=ttbar_v6_gpu.evdb&e=0`);
await ready();
await shot("1_overview");
await page.getByTitle("Light theme").click();
await shot("1b_overview_light");
await page.getByTitle("Dark theme").click();

// SoA and legacy rechits under the same (default) cut: legacy starts hidden (SoA preferred); turn it on, compare counts.
const legacyHits = page.locator(".layer").filter({ has: page.locator(".name", { hasText: /^HGCal$/ }) }).locator("input");
if (await legacyHits.isChecked()) problems.push("legacy rechits should start hidden when SoA rechits exist");
await legacyHits.click();
await page.waitForTimeout(800);
const counts = await page.$$eval(".layer", (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
console.log("layer rows:", counts.filter((c) => /CE-|HGCal/.test(c)).join(" | "));
await page.getByRole("tab", { name: "Cuts" }).click();
await shot("2_cuts_tab");
await page.getByRole("tab", { name: "Layers" }).click();
await legacyHits.click(); // legacy off again

await page.goto(`${base}#b=ttbar_v6_gpu.evdb&e=0&s=TICLSoATracksters:0`);
await page.reload();
await ready();
await page.keyboard.press("f");
await shot("3_trackster_selected");
const dist = await page.evaluate(() => { const e = window.evdEngine; return e.cam3d.position.distanceTo(e.ctl3d.target); });
if (!(dist > 50)) problems.push(`camera too close to its target after zoom-to (${dist} cm)`);
// Rotating must not change the selection: a press-drag-release is not a click.
await page.mouse.move(700, 600); await page.mouse.down(); await page.mouse.move(780, 560, { steps: 8 }); await page.mouse.up();
if (!(await page.locator(".inspector").count())) problems.push("a rotate drag cleared the selection");
await page.getByRole("tab", { name: /Related/ }).click();
await page.keyboard.press("4");
await shot("4_rz_related_tab");

await page.keyboard.press("Escape");
await page.keyboard.press("1");
await page.keyboard.press("?");
await shot("5_help");
await page.keyboard.press("Escape");
// Custom column r = hypot(x, y) on the CE-E rechits; colour that layer by it; then hide rechits at r >= 100 cm.
const ceeCount = async () => (await page.locator(".layer", { hasText: "CE-E" }).locator(".count").innerText()).split("/")[0].trim();
await page.getByRole("tab", { name: "Columns" }).click();
await page.locator(".exprform .name").fill("r");
await page.locator(".exprform .expr").fill("hypot(x, y)");
console.log("expression preview:", await page.locator(".exprform .feedback").innerText());
await page.getByRole("button", { name: "Add column" }).click();
await page.getByRole("tab", { name: "Layers" }).click();
await page.locator(".layer", { hasText: "CE-E" }).locator(".colourby").selectOption("r");
await page.waitForTimeout(500);
console.log("legend after colouring by r:", await page.locator(".layer", { hasText: "CE-E" }).locator(".legend").innerText());
const before = await ceeCount();
await page.getByRole("tab", { name: "Cuts" }).click();
await page.locator(".exprform .expr").fill("r < 100");
await page.getByRole("button", { name: "Apply filter" }).click();
await shot("6_filter");
await page.getByRole("tab", { name: "Layers" }).click();
const after = await ceeCount();
console.log(`CE-E rechits shown: ${before} without filter, ${after} with r < 100`);
if (!(Number(after.replace(/,/g, "")) < Number(before.replace(/,/g, "")))) problems.push("the filter did not reduce the CE-E rechits");
await shot("7_custom_colour");

// Replay (R): runs, then ends with everything drawn again.
await page.keyboard.press("r");
const replaying = await page.evaluate(() => window.evdEngine.replaying);
// The captions seen during the replay, recorded in the page (screenshots are too slow with software WebGL).
await page.evaluate(() => {
  window.captions = [];
  window.captionTimer = setInterval(() => {
    const t = document.querySelector(".caption b")?.textContent;
    if (t && !t.startsWith("t =") && window.captions.at(-1) !== t) window.captions.push(t);
  }, 50);
});
await page.waitForFunction(() => document.querySelector(".caption b")?.textContent?.includes("→ candidates"), null, { timeout: 30000 })
  .then(() => page.screenshot({ path: `${out}/6_replay_candidates.png` }), () => problems.push("the replay did not reach the candidates"));
await page.waitForFunction(() => !window.evdEngine.replaying, null, { timeout: 20000 });
console.log(`replay: started ${replaying}, finished; captions: ${await page.evaluate(() => { clearInterval(window.captionTimer); return window.captions.join(" | "); })}`);
if (!replaying) problems.push("R did not start a replay");

// Tour: the camera swoops in while the event replays (about 15 s with all stages), then it selects the most energetic
// final object; any key stops it.
const cam = () => page.evaluate(() => window.evdEngine.cam3d.position.toArray().map((v) => Math.round(v)));
const c0 = await cam();
await page.keyboard.press("p");
const toured = await page.waitForSelector(".inspector", { timeout: 40000 }).then(() => 1, () => 0);
const c1 = await cam();
await shot("8_tour");
await page.keyboard.press("Escape");
console.log(`tour: camera ${c0} -> ${c1}, selected an object: ${toured > 0}, stopped: ${!(await page.locator(".eventnav .icon-button.on").count())}`);
if (c0.join() === c1.join() || !toured) problems.push("the tour did not move the camera or select a shower");
if (await page.locator(".eventnav .icon-button.on").count()) problems.push("a key press did not stop the tour");

await page.getByRole("tab", { name: "Event" }).click();
await page.keyboard.press("ArrowRight");
await ready();
await shot("9_next_event_info");
console.log(problems.length ? `console errors:\n  ${problems.join("\n  ")}` : "no console errors");
await browser.close();
process.exit(problems.length ? 1 : 0);
