// Browser checks of the viewer: headless Chromium with software WebGL, against a development server (whose builds
// expose the engine to the checks as window.evdEngine).
//
//   node e2e/smoke.mjs <dev server URL> <screenshot dir> [--site] [--deep <bundle>] [bundle ...]
//
// - The site around the bundles (site.mjs), unless bundles are named; `--site` checks only that.
// - Every bundle of the site's index.json, or those named (bundle.mjs).
// - One bundle (`--deep`, by default the smallest with reconstruction stages) also gets the interaction checks: the
//   menu, the themes, help, a rotate drag, a custom column, the replay and the tour.
//
// Any console error fails the run. So does a bundle not checked within BUNDLE_TIMEOUT, or three times that for big
// files or events (software WebGL takes seconds per frame on their scenes, and clicks wait for frames); the run then
// goes on with the next bundle. Screenshots go to <dir>/site_*.png and <dir>/<bundle>_*.png; progress is one
// timestamped line per step.
import { chromium } from "playwright";
import { checkBundle } from "./bundle.mjs";
import { BUNDLE_TIMEOUT, bigEvents, header, log } from "./common.mjs";
import { checkSite } from "./site.mjs";

const args = process.argv.slice(2),
  deepAt = args.indexOf("--deep");
const deepName = deepAt >= 0 ? args.splice(deepAt, 2)[1] : undefined;
const siteAt = args.indexOf("--site"),
  siteOnly = siteAt >= 0 && !!args.splice(siteAt, 1);
const [base = "http://127.0.0.1:5173/", out = "e2e/shots", ...names] = args;
const listed = (await (await fetch(`${base}index.json`)).json()).bundles;
const files = siteOnly ? [] : names.length ? names : listed.map((b) => b.file);
const headers = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await header(base, f)])));
const deep =
  deepName ??
  files
    .filter((f) => headers[f].display.some((d) => d.stage !== undefined))
    .sort((a, c) => headers[a].size - headers[c].size)[0];

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
/** What every check needs: the browser, the server, where screenshots go, the problems found so far, and the bundles. */
const run = { browser, base, out, problems: [], listed, headers, deep };
const { problems } = run;

if (siteOnly || !names.length) {
  const t0 = Date.now();
  const result = await checkSite(run).then(
    () => "checked",
    (e) => `error: ${e.message.split("\n")[0]}`,
  );
  if (result !== "checked") problems.push(`site: ${result}`);
  log(`site: ${result} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
for (const file of files) {
  const tag = file.replace(/\.evdb$/, ""),
    t0 = Date.now(),
    state = { page: null };
  let timer;
  const result = await Promise.race([
    checkBundle(run, file, tag, state).then(
      () => "checked",
      (e) => `error: ${e.message.split("\n")[0]}`,
    ),
    new Promise((done) => {
      const ms = (bigEvents(headers[file]) ? 3 : 1) * BUNDLE_TIMEOUT;
      timer = setTimeout(() => done(`not finished after ${ms / 1000} s`), ms);
    }),
  ]);
  clearTimeout(timer);
  await state.page?.close().catch(() => {}); // also ends a check that timed out
  if (result !== "checked") problems.push(`${tag}: ${result}`);
  log(`${tag}: ${result} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
await browser.close();
console.log(problems.length ? `FAILED\n  ${problems.join("\n  ")}` : "ok");
process.exit(problems.length ? 1 : 0);
