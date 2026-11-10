// Per-profile browser check (headless Chromium, software WebGL): each bundle opens in its profile's starting view,
// draws its layers, shows its summary charts, its presets apply, and (where there are layer clusters) selecting one
// highlights its hits. Exits non-zero on any failure or console error.
// Usage: node e2e/profiles.mjs <viewer URL> <screenshot dir> [bundle ...]   (default: the MCT and test-beam bundles)
import { chromium } from "playwright";

const [base = "http://127.0.0.1:5173/", out = "e2e/shots", ...names] = process.argv.slice(2);
const bundles = names.length ? names : ["mct_22000077.evdb", "tb_117135.evdb", "tb2025_112054.evdb", "mct_splats_22000077.evdb"];
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const problems = [];
for (const name of bundles) {
  const tag = name.replace(/\.evdb$/, "");
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on("console", (m) => m.type() === "error" && problems.push(`${tag}: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${tag}: ${e.message}`));
  const ready = async () => { await page.waitForSelector(".eventid strong:has-text('Event')", { timeout: 60000 }); await page.waitForTimeout(1500); };
  await page.goto(`${base}#b=${name}&e=1`);
  await ready();
  const counts = await page.$$eval(".layer", (rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
  console.log(`${tag} layers: ${counts.join(" | ")}`);
  const hasLayer = (label) => counts.some((c) => c.startsWith(label));
  console.log(`${tag}: per-run readout layer ${hasLayer("Readout channels") ? "shown" : "none in this bundle"}`);
  await page.screenshot({ path: `${out}/${tag}_layers.png` });
  await page.getByRole("tab", { name: "Event" }).click();
  await page.waitForTimeout(400);
  const charts = await page.$$eval(".bars", (b) => b.length);
  if (!charts) problems.push(`${tag}: no summary charts`);
  await page.screenshot({ path: `${out}/${tag}_event.png` });
  const runCard = await page.locator(".card h3", { hasText: /^Run \d+/ }).count();
  console.log(`${tag}: run information ${runCard ? "shown" : "none in this bundle"}`);
  await page.getByRole("tab", { name: "Layers" }).click();
  for (const name of await page.$$eval(".segmented.presets button", (b) => b.map((x) => x.textContent))) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(400);
  }
  if (hasLayer("Layer clusters")) { // selecting a layer cluster highlights its hits
    await page.goto(`${base}#b=${name}&e=1&s=HGCLayerClusters:0`);
    await page.reload();
    await ready();
    const related = await page.locator(".inspector .tabs button, .inspector [role=tab]").filter({ hasText: "Related" }).innerText().catch(() => "");
    if (!/Related · [1-9]/.test(related)) problems.push(`${tag}: selecting a layer cluster shows nothing related (${related})`);
    await page.screenshot({ path: `${out}/${tag}_selected.png` });
  }
  await page.close();
}
await browser.close();
console.log(problems.length ? `FAILED\n${problems.join("\n")}` : "ok");
process.exit(problems.length ? 1 : 0);
