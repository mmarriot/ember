// Browser check (headless Chromium, software WebGL) of every bundle in the site's index.json, or of those named.
// Each: layers draw (helices end at finite points), a start domain opens, domains draw only their layers (and shared
// ones) and open their tab, labels show (L hides them) and N selects, object rows ring and select, D and the focus
// bar's chips keep the selection, the URL keeps the level and the truth colours, presets apply, a bundle with candidates has a colour key, T colours by generator particle where there is truth, summary charts show where the profile defines them,
// a selection draws its objects that a layer's filter hides and its levels of lines (a vertex's tracks),
// selecting an object shows its chain (what it is part of and made of, each step with its truth link) and only its
// bottom level (↓ ↑ step through the others), a click on an object of the chain looks at it and keeps the card, Open
// goes into it and back returns, a description opens on request, X crosses to its truth
// match and B comes back, Esc leaves, "only" draws one kind alone, the Truth tab has the event's scorecard. One bundle (`--deep`, default the smallest with reconstruction
// stages) also gets: the menu, themes, help, a rotate drag keeping the selection, a custom column used for colour and a filter,
// the replay and the tour; the replay also for any bundle whose paths are built from their parts (`grow`: captions in order, paths complete by the fit). Any console error, or a bundle taking over BUNDLE_TIMEOUT (three times that for files over
// BIG_FILE or events over BIG_EVENT: software WebGL takes seconds per frame on their scenes, and clicks wait for frames), fails.
// Before the bundles (when none is named; `--site`: only this), the site around them (checkSite): the data set chooser
// with my files, the recent ones and the shared ones, its filter and keys; a link to someone else's file; the login
// typed where the site does not say who is signed in; the start panel of a site without data; a link to a file that
// is gone; a local file; the share pop-up. It brings its own people and files (answers given to the page for whoami
// and data/u/...), so it runs against any development server.
// Screenshots: <dir>/<bundle>_*.png (one small one for scenes over BIG objects), <dir>/site_*.png. Progress: one timestamped line per step.
// Usage: node e2e/smoke.mjs <dev server URL> <screenshot dir> [--site] [--deep <bundle>] [bundle ...]  (dev builds expose the engine)
import { chromium } from "playwright";

const args = process.argv.slice(2),
  deepAt = args.indexOf("--deep");
const deepName = deepAt >= 0 ? args.splice(deepAt, 2)[1] : undefined;
const siteAt = args.indexOf("--site"),
  siteOnly = siteAt >= 0 && !!args.splice(siteAt, 1);
const [base = "http://127.0.0.1:5173/", out = "e2e/shots", ...names] = args;
const listed = (await (await fetch(`${base}index.json`)).json()).bundles;
const files = siteOnly ? [] : names.length ? names : listed.map((b) => b.file);
const headers = Object.fromEntries(await Promise.all(files.map(async (f) => [f, await header(f)])));
const deep =
  deepName ??
  files
    .filter((f) => headers[f].display.some((d) => d.stage !== undefined))
    .sort((a, c) => headers[a].size - headers[c].size)[0];

const BUNDLE_TIMEOUT = 300_000,
  BIG_FILE = 500e6,
  BIG_EVENT = 10e6; // ms: a bundle not checked by then fails, and the run goes on with the next; bytes
/** A bundle whose events are big (PU200: ~30 MB each), however many it holds: software WebGL is slow on its scenes. */
const bigEvents = (h) => h.size > BIG_FILE || h.size / Math.max(1, h.events) > BIG_EVENT;
const BIG = 200_000; // objects drawn above which a bundle gets one small screenshot (software WebGL is slow)
const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const problems = [];
/** The browser's own line for a request answered 404, where that is an answer the page expects: a site without
 *  `whoami`, a person without files (no index), a link to a file that is gone. */
const expected404 = (m) =>
  /status of 404/.test(m.text()) &&
  /\/whoami$|\/index\.json$|\/gone\.evdb$/.test(new URL(m.location().url || base).pathname);
if (siteOnly || !names.length) {
  const t0 = Date.now();
  const result = await checkSite().then(
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
    checkBundle(file, tag, state).then(
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

/** Wait until a bundle is open and the event asked for was read: the top bar names an event as soon as the bundle's
 *  header is in, while the event itself (35 MB at PU200) is still on its way, which the progress bar shows. */
async function eventRead(page) {
  await page.waitForSelector(".eventid strong:has-text('· Event')", { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector(".topbar .progress"), null, { timeout: 90000 });
}

/** The site around the bundles: who the page is for, the data sets it lists, what it says with nothing to show, and
 *  sharing. Two people (tester, who is signed in, and alice) and their files are answers given to the page; their
 *  bundles are the site's smallest one under other names. */
async function checkSite() {
  const fail = (text) => problems.push(`site: ${text}`);
  const headers_ = Object.fromEntries(await Promise.all(listed.map(async (b) => [b.file, await header(b.file)])));
  const sizes = Object.fromEntries(listed.map((b) => [b.file, headers_[b.file].size]));
  const small = [...listed].sort((a, c) => sizes[a.file] - sizes[c.file])[0],
    other = listed.find((b) => b !== small);
  if (!small) return fail("no bundle in index.json to check the site with");
  const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
  const indexes = {
    tester: {
      updated: days(0),
      bundles: [
        {
          file: "data/u/tester/reco_test.evdb",
          title: "My rereco test",
          events: 12,
          created: days(-1),
          expires: days(29),
        },
        {
          file: "data/u/tester/older.evdb",
          title: "An older conversion",
          events: 3,
          created: days(-29.5),
          expires: days(0.5),
        },
      ],
    },
    alice: {
      updated: days(0),
      bundles: [
        {
          file: "data/u/alice/for_the_meeting.evdb",
          title: "Events for the meeting",
          events: 7,
          created: days(-10),
          expires: days(20),
        },
      ],
    },
  };
  const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  /** A page of the site as `who` sees it: signed in as them ("": the site has no whoami), with `shared` as the site's
   *  list (default: its own). */
  const visit = async (
    hash,
    { who = "tester", shared, width = 1440, theme = "dark", people = indexes, setup } = {},
  ) => {
    const context = await browser.newContext({ viewport: { width, height: 860 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    page.on("console", (m) => m.type() === "error" && !expected404(m) && fail(m.text()));
    page.on("pageerror", (e) => fail(e.message));
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("evd.theme", t);
      } catch {
        /* the default theme */
      }
    }, theme);
    await page.route(
      (url) => url.pathname.endsWith("/whoami"),
      (r) => r.fulfill(who ? json({ login: who }) : json({}, 404)),
    );
    await page.route(
      (url) => /\/data\/u\/[^/]+\/index\.json$/.test(url.pathname),
      (r) => {
        const index = people[new URL(r.request().url()).pathname.split("/").at(-2)];
        return r.fulfill(index ? json(index) : json({}, 404));
      },
    );
    await page.route(
      (url) => /\/data\/u\/[^/]+\/[^/]+\.evdb$/.test(url.pathname),
      (r) => {
        const url = new URL(r.request().url());
        return url.pathname.endsWith("/gone.evdb")
          ? r.fulfill({ status: 404, body: "" })
          : r.continue({ url: `${base}${small.file}${url.search}` });
      },
    );
    if (shared)
      await page.route(
        (url) => url.pathname.endsWith("/index.json") && !url.pathname.includes("/data/u/"),
        (r) => r.fulfill(json({ bundles: shared })),
      );
    if (setup) await setup(page); // a scenario's own answers, which go before the ones above
    await page.goto(`${base}${hash}`, { timeout: 90000 });
    return page;
  };
  const shown = async (page) => {
    await eventRead(page);
    await page.waitForTimeout(800);
  };
  const shot = async (page, name) => {
    await page.waitForTimeout(300);
    await page
      .screenshot({ path: `${out}/site_${name}.png`, timeout: 60000 })
      .catch(() => log(`site: screenshot ${name} timed out`));
  };
  const sectionNames = (page) => page.$$eval(".sectionhead > span:first-child", (h) => h.map((x) => x.textContent));
  const rowTitles = (page) => page.$$eval(".dataset-row .title", (r) => r.map((x) => x.textContent));
  const label = (page) => page.textContent(".dataset .name");

  // The chooser, signed in: the button names the data set open; the panel lists my files (newest first, with their
  // expiry), then the site's, with the open one marked; the filter narrows them; ↓ and Enter open one; Esc closes.
  for (const [theme, width] of [
    ["dark", 1440],
    ["light", 900],
  ]) {
    const page = await visit(`#b=${small.file}&e=0`, { theme, width });
    await shown(page);
    if ((await label(page)) !== small.title)
      fail(`the chooser's button says "${await label(page)}", not the data set's title "${small.title}"`);
    if (!(await page.title()).startsWith(small.title))
      fail(`the page's title "${await page.title()}" does not start with the data set's`);
    const before = await page.$eval(".chooser", (c) => c.getBoundingClientRect().width);
    // The button keeps its width from one data set to another, whatever the lengths of their names and event titles
    // (two that differ in both; of the same kind: the detector's parts add their buttons to the bar).
    const plain = (b) => (headers_[b.file].domains ?? []).length < 2,
      twin =
        plain(small) &&
        listed.filter((b) => b !== small && plain(b)).sort((a, c) => c.title.length - a.title.length)[0];
    if (twin && width > 900) {
      await page.click(".dataset");
      await page.fill(".chooserpanel .filter", twin.title);
      await page.keyboard.press("Enter");
      await page.waitForFunction((t) => document.querySelector(".dataset .name")?.textContent === t, twin.title, {
        timeout: 30000,
      });
      await shown(page);
      const wide = await page.$eval(".chooser", (c) => c.getBoundingClientRect().width);
      if (Math.abs(wide - before) > 0.5)
        fail(
          `the chooser's button is ${before} px for "${small.title}" and ${wide} px for "${twin.title}" at ${width} px: the top bar moves between data sets`,
        );
      await page.click(".dataset");
      await page.fill(".chooserpanel .filter", small.title);
      await page.keyboard.press("Enter");
      await page.waitForFunction((t) => document.querySelector(".dataset .name")?.textContent === t, small.title, {
        timeout: 30000,
      });
      await shown(page);
    } else if (width > 900) log("site: no second data set without detector parts to compare the chooser's width with");
    await page.click(".dataset");
    await page.waitForSelector(".chooserpanel");
    const sections = await sectionNames(page),
      titles = await rowTitles(page);
    if (sections[0] !== "My files · tester") fail(`the first section is "${sections[0]}", not my files`);
    if (titles[0] !== "My rereco test" || titles[1] !== "An older conversion")
      fail(`my files are not listed newest first: ${titles.slice(0, 2).join(" | ")}`);
    const notes = await page.$$eval(".dataset-row small", (r) => r.map((x) => x.textContent));
    if (!/12 events · expires in 29 days/.test(notes[0]) || !/expires today/.test(notes[1]))
      fail(`my files do not say their events and expiry: ${notes.slice(0, 2).join(" | ")}`);
    if (sections.includes("Recent")) fail("a recent section with nothing opened from a link");
    for (const b of listed) if (!titles.includes(b.title)) fail(`the shared data set "${b.title}" is not listed`);
    if (titles.includes("Events for the meeting")) fail("someone else's file is listed without a link to it");
    const current = await page.$$eval(".dataset-row[aria-current]", (r) =>
      r.map((x) => x.querySelector(".title").textContent),
    );
    if (current.length !== 1 || current[0] !== small.title)
      fail(`the open data set is not the one marked: ${current.join(" | ")}`);
    if (!(await page.evaluate(() => document.activeElement?.classList.contains("filter"))))
      fail("the filter does not have the focus when the chooser opens");
    await shot(page, `chooser_${theme}_${width}`);
    await page.keyboard.type("zzz nothing");
    if (!(await page.$(".datasets .none")) || (await rowTitles(page)).length)
      fail("a filter matching nothing still lists data sets, or does not say so");
    await page.fill(".chooserpanel .filter", "rereco");
    if ((await rowTitles(page)).join() !== "My rereco test")
      fail(`the filter "rereco" lists: ${(await rowTitles(page)).join(" | ")}`);
    await page.keyboard.press("Enter");
    await shown(page);
    if (await page.$(".chooserpanel")) fail("the chooser stays open after a data set is chosen");
    if ((await label(page)) !== "My rereco test") fail(`after choosing my file the button says "${await label(page)}"`);
    if (!page.url().includes("b=data/u/tester/reco_test.evdb"))
      fail(`the address does not name my file readably: ${page.url()}`);
    // Tab walks the panel's controls; once the focus is out of it, it closes (it would stay open over the view).
    await page.click(".dataset");
    for (let k = 0; k < 8 && (await page.$(".chooserpanel")); k++) await page.keyboard.press("Tab");
    if (await page.$(".chooserpanel")) fail("the chooser stays open after Tab took the focus out of it");
    if (await page.evaluate(() => !!document.activeElement?.closest(".chooser")))
      fail("after tabbing out of the chooser the focus is still in it");
    // The lists hold only options: headings, the login and "not you?" are outside them.
    await page.click(".dataset");
    const strays = await page.$$eval(".chooserpanel [role=listbox] > :not([role=option])", (x) => x.length);
    if (strays) fail(`${strays} elements that are not options are inside the chooser's lists`);
    await page.keyboard.press("Escape");
    // ↓ walks the rows, Esc closes and gives the focus back to the button; the view's keys then work again.
    await page.click(".dataset");
    await page.keyboard.press("ArrowDown");
    const active = await page.$eval(".dataset-row.active .title", (x) => x.textContent);
    if (active !== "An older conversion") fail(`↓ from my first file went to "${active}"`);
    await page.keyboard.press("Escape");
    if (await page.$(".chooserpanel")) fail("Esc does not close the chooser");
    if (!(await page.evaluate(() => document.activeElement?.classList.contains("dataset"))))
      fail("Esc does not give the focus back to the chooser's button");
    if (!(await page.$(".eventid strong:has-text('· Event')"))) fail("Esc in the chooser left the event");
    await page.context().close();
  }

  // A link to someone else's file: it opens for me, named from its owner's index; it is under Recent from then on (and
  // can be forgotten there); the share pop-up holds the link, says it was copied and what it opens, and when it ends.
  {
    const page = await visit("#b=data/u/alice/for_the_meeting.evdb&e=1");
    await shown(page);
    await page
      .waitForFunction(() => document.querySelector(".dataset .name")?.textContent === "Events for the meeting", null, {
        timeout: 10000,
      })
      .catch(() => {});
    if ((await label(page)) !== "Events for the meeting")
      fail(`a link to someone's file is named "${await label(page)}", not by its title in their index`);
    await page.click(".share");
    await page.waitForSelector(".sharepop");
    const link = await page.inputValue(".sharepop input"),
      text = await page.textContent(".popover");
    if (link !== page.url() || !link.includes("b=data/u/alice/for_the_meeting.evdb&e=1"))
      fail(`the share pop-up's link is not this view's: ${link}`);
    await page
      .waitForSelector(".sharepop .status.ok", { timeout: 5000 })
      .catch(() => fail("the share pop-up does not say the link was copied"));
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (clip !== link) fail(`the clipboard holds "${clip}", not the link`);
    for (const part of ["Events for the meeting", "event 2 of", "view", "alice's file", "expires in 20 days"])
      if (!text.includes(part)) fail(`the share pop-up does not say "${part}": ${text}`);
    await shot(page, "share");
    await page.keyboard.press("Escape");
    if (await page.$(".sharepop")) fail("Esc does not close the share pop-up");
    await page.click(".dataset");
    const about = await page.textContent(".about");
    if (!/published by alice/.test(about) || !/expires in 20 days/.test(about))
      fail(`the chooser does not say whose file is open and when it expires: ${about}`);
    if (!(await sectionNames(page)).includes("Recent")) fail("a file opened from a link is not under Recent");
    const recent = await page.$eval(".dataset-row[aria-current]", (r) => r.textContent);
    if (!/Events for the meeting.*from alice · opened today/.test(recent)) fail(`the recent row reads "${recent}"`);
    await page.click(".about .link");
    const details = await page.$$eval(".about table td:first-child", (c) => c.map((x) => x.textContent));
    for (const k of ["Events", "Published by", "Expires", "Converter", "File"])
      if (!details.includes(k)) fail(`the data set's details lack "${k}": ${details.join(", ")}`);
    await shot(page, "recent");
    // Delete in a filter being typed deletes a character, not the recent data set; with nothing typed it forgets it.
    await page.fill(".chooserpanel .filter", "meeting");
    await page.keyboard.press("Home");
    await page.keyboard.press("Delete");
    if ((await page.inputValue(".chooserpanel .filter")) !== "eeting")
      fail(`Delete in the filter left "${await page.inputValue(".chooserpanel .filter")}"`);
    if (!(await page.evaluate(() => (localStorage.getItem("evd.recent") ?? "").includes("for_the_meeting"))))
      fail("Delete in the filter removed the recent data set");
    await page.fill(".chooserpanel .filter", "");
    await page.keyboard.press("ArrowDown"); // from my first file to my second,
    await page.keyboard.press("ArrowDown"); // to the recent one
    if (!(await page.$(".dataset-row.active .icon-button")))
      fail(`↓ ↓ from my first file is not on the recent data set: ${await page.textContent(".dataset-row.active")}`);
    await page.keyboard.press("Delete");
    if (await page.evaluate(() => JSON.parse(localStorage.getItem("evd.recent") ?? "[]").length))
      fail("Delete with no filter typed does not forget the recent data set under the keys");
    await page.keyboard.press("Escape");
    await page.reload();
    await shown(page); // the link's data set again: under Recent again
    await page.click(".dataset");
    await page.click(".dataset-row[aria-current] .icon-button");
    if ((await sectionNames(page)).includes("Recent")) fail("removing the only recent data set leaves the section");
    if (await page.evaluate(() => JSON.parse(localStorage.getItem("evd.recent") ?? "[]").length))
      fail("a recent data set removed is still remembered");
    await page.context().close();
  }

  // A site that does not say who is signed in: the chooser asks for the login once, lists that person's files and
  // remembers it; "not you?" forgets it.
  {
    const page = await visit(`#b=${small.file}&e=0`, { who: "" });
    await shown(page);
    await page.click(".dataset");
    if (!(await page.$(".whoami input"))) fail("without whoami the chooser does not ask for the login");
    await page.fill(".whoami input", "not a login");
    await page.keyboard.press("Enter");
    if (!(await page.$(".whoami [role=alert]"))) fail("a login that cannot be one is taken without a word");
    await shot(page, "login");
    await page.fill(".whoami input", "Tester");
    await page.keyboard.press("Enter");
    await page
      .waitForSelector(".dataset-row .title:has-text('My rereco test')", { timeout: 10000 })
      .catch(() => fail("my files are not listed after typing my login"));
    if ((await page.evaluate(() => localStorage.getItem("evd.login"))) !== "tester")
      fail("the typed login is not remembered (evd.login)");
    await page.click(".sectionhead .link");
    if (!(await page.$(".whoami input")) || (await page.evaluate(() => localStorage.getItem("evd.login"))))
      fail("“not you?” does not forget the login");
    await page.context().close();
  }

  // A site with no data set: the start panel says what this is and how data gets in, in place of the empty side panel;
  // its command can be copied.
  for (const [theme, width] of [
    ["dark", 1440],
    ["light", 900],
  ]) {
    const page = await visit("", { who: "", shared: [], theme, width });
    await page.waitForSelector(".startpanel .card", { timeout: 30000 });
    const text = await page.textContent(".startpanel");
    for (const part of ["evd file.root", ".evdb", "link", "Documentation"])
      if (!text.includes(part)) fail(`the start panel does not mention "${part}"`);
    if (await page.isVisible(".sidebar")) fail("the empty side panel shows next to the start panel");
    if ((await page.title()) !== "Event display") fail(`with nothing open the page is titled "${await page.title()}"`);
    if (!(await page.getAttribute(".startpanel a", "href"))?.startsWith("http"))
      fail("the start panel's documentation link goes nowhere");
    await page.click(".command .link");
    if ((await page.evaluate(() => navigator.clipboard.readText()).catch(() => null)) !== "evd file.root")
      fail("the start panel's command is not copied");
    await shot(page, `start_${theme}_${width}`);
    await page.context().close();
  }

  // A link to a file that is gone: the page says so in full (whose it was, what to do); choosing a data set from there
  // opens it and the panel goes.
  for (const [theme, width] of [
    ["dark", 1440],
    ["light", 900],
  ]) {
    const page = await visit("#b=data/u/alice/gone.evdb&e=3", { theme, width });
    await page.waitForSelector(".startpanel [role=alert]", { timeout: 30000 });
    const text = await page.textContent(".startpanel");
    for (const part of ["no longer here", "published by alice", "evd file.root", "HTTP 404"])
      if (!text.includes(part)) fail(`a link to a file that is gone does not say "${part}": ${text}`);
    if (await page.$(".toast.error")) fail("a file that is gone is also reported as a passing message");
    await shot(page, `gone_${theme}_${width}`);
    await page.click(".startpanel .primary");
    await page.waitForSelector(".chooserpanel");
    await page.fill(".chooserpanel .filter", small.title);
    await page.keyboard.press("Enter");
    await shown(page);
    if (await page.$(".startpanel")) fail("the panel about the missing file stays after another data set opened");
    if (await page.evaluate(() => (localStorage.getItem("evd.recent") ?? "").includes("gone.evdb")))
      fail("a file that is gone is kept under Recent");
    await page.context().close();
  }
  // A file that is there but is not a bundle (here: the site's index): unreadable. Trying a link again is loading the
  // page again, which keeps the link's event and view (the address still holds the link).
  {
    const page = await visit("#b=index.json&e=2&v=side");
    await page.waitForSelector(".startpanel [role=alert]", { timeout: 30000 });
    const text = await page.textContent(".startpanel"),
      buttons = await page.$$eval(".startpanel .buttons button", (b) => b.map((x) => x.textContent));
    if (!text.includes("cannot be read") || !buttons.includes("Reload the page") || buttons.includes("Try again"))
      fail(`a link to a file that is not a bundle is reported as: ${text} [${buttons.join(" | ")}]`);
    if (!page.url().endsWith("#b=index.json&e=2&v=side"))
      fail(`a link that did not open is no longer in the address: ${page.url()}`);
    await page.context().close();
  }

  // Review, finding 1. An open overtaken by a later one changes nothing: a link whose file is slow to answer, another
  // data set chosen meanwhile; when the link's file arrives it must not take the view back, nor apply the link's
  // event and view to the data set chosen. While the link is on its way, the address still holds it.
  if (other) {
    const slow = small,
      quick = other,
      link = `#b=${slow.file}&e=1&v=side`;
    const page = await visit(link, {
      setup: (p) =>
        p.route(
          (url) => url.pathname.endsWith(`/${slow.file}`),
          async (r) => {
            if (r.request().headers().range === "bytes=0-0") await new Promise((done) => setTimeout(done, 5000));
            await r.continue().catch(() => {}); // the page may be gone by then
          },
        ),
    });
    await page.waitForSelector(".dataset");
    await page.waitForTimeout(500);
    if (!page.url().endsWith(link))
      fail(`the address was rewritten while the link's data set was on its way: ${page.url()}`);
    await page.click(".dataset");
    await page.fill(".chooserpanel .filter", quick.title);
    await page.keyboard.press("Enter");
    await page
      .waitForFunction((t) => document.querySelector(".dataset .name")?.textContent === t, quick.title, {
        timeout: 60000,
      })
      .catch(() => fail("the data set chosen while a link was opening did not open"));
    await shown(page);
    const chosen = page.url();
    await page.waitForTimeout(7000); // the link's file has answered by now
    if ((await label(page)) !== quick.title)
      fail(
        `a link that was slow to open replaced the data set chosen after it: the button says "${await label(page)}"`,
      );
    if (page.url() !== chosen)
      fail(`the slow link changed the address of the data set chosen after it: ${chosen} -> ${page.url()}`);
    if (await page.$(".toast.error"))
      fail(`an overtaken open left a message: ${await page.textContent(".toast.error")}`);
    await page.context().close();
  }

  // Review, finding 2. The name in a link is not trusted. A name that is not a file of this site nor a web address is
  // refused, and says nothing about a publisher; an address on another site opens marked as such: no publisher, not
  // under Recent, and a share pop-up that says who it opens for.
  for (const name of [
    "data/u/alice/..%5Ctester%5Creco_test.evdb",
    "data/u/../x.evdb",
    `${small.file}%3Fx=1`,
    "%2Fetc%2Fx.evdb",
  ]) {
    const requests = [],
      page = await visit(`#b=${name}&e=0`, { setup: (p) => p.on("request", (r) => requests.push(r.url())) });
    await page.waitForSelector(".startpanel [role=alert]", { timeout: 30000 });
    const text = await page.textContent(".startpanel");
    if (
      !text.includes("does not name a data set") ||
      /published by|alice|tester/.test(text.replace(decodeURIComponent(name), ""))
    )
      fail(`the name ${name} in a link is reported as: ${text}`);
    if (requests.some((u) => /\.evdb/.test(u)))
      fail(`the name ${name} in a link was fetched: ${requests.filter((u) => /\.evdb/.test(u)).join(", ")}`);
    if (await page.evaluate(() => localStorage.getItem("evd.recent")))
      fail(`the name ${name} in a link was remembered under Recent`);
    await page.context().close();
  }
  {
    const elsewhere = "http://elsewhere.example/data/u/alice/shown_to_all.evdb";
    const page = await visit(`#b=${elsewhere}&e=1`, {
      setup: (p) =>
        p.route(
          (url) => url.hostname === "elsewhere.example",
          async (r) => {
            const answer = await r.fetch({ url: `${base}${small.file}` }); // another site that lets pages of this one read it
            await r.fulfill({
              response: answer,
              headers: {
                ...answer.headers(),
                "access-control-allow-origin": "*",
                "access-control-expose-headers": "Content-Range, ETag, Last-Modified",
              },
            });
          },
        ),
    });
    const opened = await eventRead(page).then(
      () => true,
      () => false,
    );
    if (!opened)
      fail(`an address on another site did not open: ${await page.textContent(".startpanel").catch(() => "")}`);
    else {
      if ((await page.textContent(".dataset .tag").catch(() => "")) !== "external")
        fail("a data set from another site is not marked external on the chooser's button");
      await page.click(".dataset");
      const about = await page.textContent(".about");
      if (!about.includes("not on this site") || /published by/.test(about))
        fail(`a data set from another site is described as: ${about}`);
      if ((await sectionNames(page)).includes("Recent"))
        fail("a data set from another site is remembered under Recent");
      await page.keyboard.press("Escape");
      await page.click(".share");
      const text = await page.textContent(".popover");
      if (
        !text.includes("can also reach the data set's own address") ||
        text.includes("for anyone who can open this site")
      )
        fail(`sharing a data set from another site says: ${text}`);
      await shot(page, "external");
    }
    await page.context().close();
  }

  // Review, finding 4. A list is somebody's file: entries that are not entries are left out, and the chooser comes up
  // whatever they hold. A site without shared data sets opens my newest file, not an address my index names.
  {
    const people = {
      tester: {
        bundles: [
          { file: "http://elsewhere.example/first.evdb", title: "An address, not a file of mine", created: days(0) },
          {
            file: "data/u/tester/reco_test.evdb",
            title: "My rereco test",
            events: null,
            created: days(-1),
            expires: 7,
          },
          { file: "data/u/alice/for_the_meeting.evdb", title: "Someone else's file in my list" },
          { file: "data/u/tester/../../index.evdb", title: "Climbing out" },
          { title: "No file" },
          null,
        ],
      },
    };
    const requests = [],
      page = await visit("", { shared: [], people, setup: (p) => p.on("request", (r) => requests.push(r.url())) });
    await shown(page);
    if ((await label(page)) !== "My rereco test")
      fail(`with a malformed index a bare address opened "${await label(page)}", not my own well-formed file`);
    if (requests.some((u) => u.includes("elsewhere.example"))) fail("an address named in my index was fetched");
    await page.click(".dataset");
    if (!(await page.waitForSelector(".chooserpanel", { timeout: 3000 }).catch(() => null)))
      fail("the chooser does not come up with a malformed entry in my index");
    else if ((await rowTitles(page)).join() !== "My rereco test")
      fail(`with a malformed index my files are: ${(await rowTitles(page)).join(" | ")}`);
    await page.context().close();
  }
  // The same for a login typed in a browser: "not you?" must be there to get out of a list that cannot be shown.
  {
    const page = await visit(`#b=${small.file}&e=0`, {
      who: "",
      people: { tester: { bundles: [{ file: "data/u/tester/x.evdb", title: "X", events: null }] } },
    });
    await shown(page);
    await page.evaluate(() => localStorage.setItem("evd.login", "tester"));
    await page.reload();
    await shown(page);
    await page.click(".dataset");
    if (!(await page.waitForSelector(".sectionhead .link", { timeout: 3000 }).catch(() => null)))
      fail("with a malformed entry in my index the chooser has no “not you?”");
    await page.context().close();
  }

  // A site whose whoami never answers still opens its newest data set at a bare address, without waiting for it; and
  // "b=" with nothing after it is a bare address.
  {
    const page = await visit("#b=&e=0", {
      who: "tester",
      setup: (p) =>
        p.route(
          (url) => url.pathname.endsWith("/whoami"),
          () => {
            /* never answered */
          },
        ),
    });
    const t0 = Date.now(),
      opened = await page
        .waitForFunction((t) => document.querySelector(".dataset .name")?.textContent === t, listed[0].title, {
          timeout: 3500,
        })
        .then(
          () => true,
          () => false,
        );
    if (!opened)
      fail(
        `with a whoami that hangs, a bare address had not opened the newest shared data set after ${Date.now() - t0} ms: ${await label(page)}`,
      );
    await page.context().close();
  }

  // A local file (picked in the chooser, as a drop does): opened where it is, marked local, with no address; the
  // share button says why it has no link and how to get one; it is under Recent as a file to drop again.
  {
    const page = await visit(`#b=${(other ?? small).file}&e=0`);
    await shown(page);
    // Dragged over the page, the page says it can be dropped; dropped, it opens.
    const drag = (type, name) =>
      page.evaluate(
        async ([type, name, url]) => {
          const data = new DataTransfer();
          data.items.add(new File([await (await fetch(url)).blob()], name));
          window.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
        },
        [type, name, `${base}${small.file}`],
      );
    await drag("dragenter", "dropped.evdb");
    if (!(await page.waitForSelector(".drophint", { timeout: 3000 }).catch(() => null)))
      fail("a file dragged over the page gets no hint that it can be dropped");
    await shot(page, "drop");
    await drag("drop", "dropped.evdb");
    await page
      .waitForFunction(() => document.querySelector(".dataset .name")?.textContent === "dropped.evdb", null, {
        timeout: 30000,
      })
      .catch(() => fail("a dropped file does not open"));
    if (await page.$(".drophint")) fail("the drop hint stays after the drop");
    await shown(page);
    const bytes = Buffer.from(await (await fetch(`${base}${small.file}`)).arrayBuffer());
    await page.click(".dataset");
    const [picker] = await Promise.all([page.waitForEvent("filechooser"), page.click(".chooserpanel footer button")]);
    await picker.setFiles({ name: "from_my_disk.evdb", mimeType: "application/octet-stream", buffer: bytes });
    await page
      .waitForFunction(() => document.querySelector(".dataset .name")?.textContent === "from_my_disk.evdb", null, {
        timeout: 30000,
      })
      .catch(() => fail("a local file does not open from the chooser"));
    await shown(page);
    if (!(await page.$(".dataset .tag"))) fail("a local file is not marked as local on the chooser's button");
    if (page.url().includes("b=")) fail(`a local file is in the address, which cannot open it: ${page.url()}`);
    await page.click(".share");
    const text = await page.textContent(".popover");
    if (!/A local file has no link/i.test(text) || !text.includes("evd file.root"))
      fail(`sharing a local file says: ${text}`);
    await shot(page, "local");
    await page.keyboard.press("Escape");
    await page.click(".dataset");
    const row = await page.$eval(".dataset-row.off", (r) => r.textContent).catch(() => "");
    if (!/from_my_disk\.evdb.*drop it/.test(row)) fail(`a local file under Recent reads "${row}"`);
    // Filtered down to rows that cannot be opened, none is under the keys, and Enter does nothing.
    await page.fill(".chooserpanel .filter", "from_my_disk");
    if (await page.$(".dataset-row.active"))
      fail("a row that cannot be opened (a local file's) is the one under the keys");
    await page.keyboard.press("Enter");
    if (!(await page.$(".chooserpanel"))) fail("Enter on a row that cannot be opened closed the chooser");
    await page.context().close();
  }

  // Review, finding 3. A local file that is not a bundle, with nothing else on screen: the page says what to do with
  // the file (convert it again), offers another file, and no "try again" that would fetch its name from the site.
  {
    const requests = [],
      page = await visit("", { who: "", shared: [], setup: (p) => p.on("request", (r) => requests.push(r.url())) });
    await page.waitForSelector(".startpanel .card", { timeout: 30000 });
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["these are my notes, not a bundle"], "notes.evdb"));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    await page
      .waitForSelector(".startpanel [role=alert]", { timeout: 10000 })
      .catch(() => fail("a local file that is not a bundle gets no panel"));
    const text = await page.textContent(".startpanel"),
      buttons = await page.$$eval(".startpanel .buttons button", (b) => b.map((x) => x.textContent));
    if (!text.includes("convert it again") || /upload/.test(text))
      fail(`a local file that is not a bundle is reported as: ${text}`);
    if (buttons.some((b) => /again|Reload/i.test(b)) || !buttons.includes("Choose another file"))
      fail(`a local file that did not open offers: ${buttons.join(" | ")}`);
    if (requests.some((u) => u.includes("notes.evdb"))) fail("a local file's name was fetched from the site");
    await shot(page, "local_failed");
    await page.context().close();
  }
}

async function checkBundle(file, tag, state) {
  const h = headers[file],
    fail = (text) => problems.push(`${tag}: ${text}`);
  let page,
    small = false;
  const shot = async (name) => {
    // a record, not a check
    if (small && name !== "1_layers") return;
    await page.waitForTimeout(500);
    await page
      .screenshot({ path: `${out}/${tag}_${name}.png`, timeout: 60000 })
      .catch(() => log(`${tag}: screenshot ${name} timed out`));
  };
  const open = async (hash, query = false) => {
    // a fresh page each time: software WebGL is slow to let go of a big scene
    await page?.close();
    page = state.page = await browser.newPage({
      viewport: small ? { width: 720, height: 450 } : { width: 1440, height: 860 },
    });
    page.on("console", (m) => m.type() === "error" && !expected404(m) && fail(m.text()));
    page.on("pageerror", (e) => fail(e.message));
    await page.goto(`${base}${query ? "?" : "#"}${hash}`, { timeout: 90000 });
    await eventRead(page);
    await page.waitForTimeout(1200);
  };

  await open(`b=${file}&e=1`);
  await checkStart(page, h, fail, tag);
  const [drawn, objects] = await page.evaluate(() => [
    window.evdEngine.layers.length,
    window.evdEngine.layers.reduce((s, l) => s + l.x.length, 0),
  ]);
  const rows = await page.$$eval(".layer:not(.off) label", (r) =>
    r.map((x) => x.innerText.replace(/\s+/g, " ").trim()),
  );
  log(`${tag}: ${drawn} layers, ${objects} objects drawn: ${rows.join(" | ")}`);
  if (!drawn) fail("no layer drawn");
  // A big scene (or a big file, whose start view may be light, e.g. only the physics objects): software WebGL is too
  // slow for the replay and full-size screenshots.
  if ((small = objects > BIG || bigEvents(h))) await page.setViewportSize({ width: 720, height: 450 });
  await shot("1_layers");
  await checkHelices(page, fail, tag);
  await checkDomains(page, h, fail, shot, tag);
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

  await page.getByRole("tab", { name: "Event", exact: true }).click();
  const charts = await page.locator(".bars").count(),
    run = await page.locator(".tabpanel section h3", { hasText: /^Run \d+/, hasNotText: "Lumi" }).count();
  log(
    `${tag}: ${charts} summary charts (profile defines ${h.summaries?.length ?? 0}), run information ${run ? "shown" : "none"}`,
  );
  if (h.summaries?.length && !charts) fail("no summary charts");
  await shot("2_event");

  // Select an object that is made of others: from a relation into a drawn table, preferring later stages.
  const drawnTables = new Set(h.display.map((d) => d.table));
  const score = (d) =>
    Object.values(h.relations)
      .filter((r) => !r.association && r.from === d.table)
      .reduce((s, r) => Math.max(s, (drawnTables.has(r.to) ? 100 : 1) + (d.stage ?? 0)), 0);
  const target = h.display.filter((d) => d.visible && !d.context).sort((a, c) => score(c) - score(a))[0];
  if (!target || !score(target)) return log(`${tag}: nothing made of other objects to select`);
  const all = (h.domains?.length ?? 0) >= 2 ? "&d=All" : ""; // every level in the focus bar, as without domains
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
    // A kind with no truth of its own opens no pair (src/model/match.ts truthStatus, opensPair): with a truth root in
    // the bundle, a truthGap and neither a match to a truth layer, a fact into it nor a derived match (e.g. a stock
    // release's TICL candidates).
    const rels = Object.values(h.relations),
      truthTables = new Set(h.display.filter((d) => d.truth).map((d) => d.table));
    const truthRoot = [...truthTables].some((t) => rels.some((r) => r.association && (r.from === t || r.to === t)));
    const ownTruth =
      !truthRoot ||
      !target.truthGap ||
      !!target.truthGap.derived ||
      rels.some(
        (r) => (r.match && r.from === target.table && truthTables.has(r.to)) || (r.fact && r.to === target.table),
      );
    log(
      `${tag}: pair ${pair.replace(/\s+/g, " ") || (ownTruth ? "none" : `none, as ${target.table} has no truth of its own`)}`,
    );
    if (!pair && ownTruth) fail("no truth <-> reco pair for the selection");
    if (pair && !ownTruth) fail(`a truth <-> reco pair for ${target.table}, which has no truth of its own`);
  }
  await shot("3_selected");
  // The levels need an object with a step that is drawn on request ("show"): row 0 may be e.g. a track-only candidate.
  const pills = () => page.locator(".inspector .rung .level").count();
  let row = 0;
  if (target.stage !== undefined)
    for (let r = 1; r < 6 && !(await pills()); r++) await open(`b=${file}&e=1${all}&s=${target.table}:${(row = r)}`);
  if (row && !(await pills())) await open(`b=${file}&e=1${all}&s=${target.table}:${(row = 0)}`);
  await checkLevels(page, h, target, fail, shot, tag);
  await checkDomainFocus(page, h, fail, shot, tag);
  // A shared link reopens its state: data set, event (its place in the file), domain and selection, also written as a
  // query (?b=…) rather than the hash.
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
  const focused = async () =>
    `${(
      await page
        .locator(".inspector > header .kind, .inspector h2")
        .allInnerTexts()
        .catch(() => [])
    )
      .join(" ")
      .replace(/\s+/g, " ")} (${decodeURIComponent(new URL(page.url()).hash.match(/s=([^&]+)/)?.[1] ?? "")})`;
  const first = await focused(),
    card = (x) => x.slice(0, x.lastIndexOf(" (")); // without the URL's selection (a kind's name may hold brackets)
  // A step of the chain names its objects when few; a longer one unfolds to them. A click looks at one: the view (and
  // the URL's selection) moves to it and the card stays; "Open" goes into its card; back returns to the first.
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

// The focus is drawn with its bottom level (e.g. hits) only: no layer of an earlier reconstruction stage. ↓ adds one
// level in between (one more layer kind drawn, its pill lit) and turns a shower focus into an outline around it; ↑
// goes back.
/** Helix layers drawn: their paths end at finite points and have a picking polyline. */
async function checkHelices(page, fail, tag) {
  const helices = await page.evaluate(() =>
    window.evdEngine.layers
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

/** A bundle that names a start domain (`view.domain`) opens on it: in the URL, drawing only its layers and those of
 *  shared domains or none. */
async function checkStart(page, h, fail, tag) {
  const start = h.view?.domain,
    names = (h.domains ?? []).map((d) => d.name);
  if (!start || names.length < 2 || !names.includes(start)) return;
  const shared = new Set(h.domains.filter((d) => d.shared).map((d) => d.name));
  const url = decodeURIComponent(new URL(page.url()).hash.match(/[#&]d=([^&]+)/)?.[1] ?? "");
  const tables = await page.evaluate(() => window.evdEngine.layers.map((l) => l.table));
  const other = tables.filter((t) =>
    h.display.some((d) => d.table === t && d.domain && d.domain !== start && !shared.has(d.domain)),
  );
  log(`${tag}: opens on ${url || "All"} (start domain ${start}), drawing ${tables.join(", ")}`);
  if (url !== start) fail(`did not open on its start domain ${start} (URL d=${url})`);
  if (other.length) fail(`the start domain ${start} draws layers of other domains: ${other.join(", ")}`);
  // Labels on the leading objects (layer hint labels) of the layers drawn; L hides them; N selects the leading one.
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
    const drawn = await tables(),
      url = decodeURIComponent(new URL(page.url()).hash.match(/[#&]d=([^&]+)/)?.[1] ?? "");
    const other = drawn.filter((t) =>
      h.display.some((d) => d.table === t && d.domain && d.domain !== name && !shared.has(d.domain)),
    );
    const key = await page.locator(".colourkey .key li").count(),
      own = h.domains.find((d) => d.name === name).colourMode === "layers";
    log(
      `${tag}: domain ${name}: ${drawn.length} layers drawn (${before.length} in All), URL d=${url}, colour key ${key ? "shown" : "none"}`,
    );
    if (other.length) fail(`domain ${name} draws layers of other domains: ${other.join(", ")}`);
    if (url !== name) fail(`domain ${name} is not in the URL`);
    if (own && key) fail(`domain ${name} colours layer by layer, but the particle-type colour key is shown`);
    const tabs = page.locator(".sidebar .tablist [role=tab]"),
      tabNames = await tabs.allInnerTexts();
    const tab = await page.locator(".sidebar .tablist [aria-selected=true]").innerText();
    const expected = shared.has(name) || !tabNames.includes("Detector") ? name : "Detector";
    if (tabNames.includes(expected) && tab !== expected)
      fail(`domain ${name} did not open its tab ${expected} (open: ${tab})`);
    if (expected === "Detector") {
      const open = await page.locator(".tabpanel details.part[open] > summary b").allInnerTexts();
      if (open.join() !== name)
        fail(`the Detector tab does not follow the bar to ${name} (open: ${open.join() || "none"})`);
    }
    await tabs.last().click({ timeout: 120000 });
    if (!new URL(page.url()).hash.includes(`d=${encodeURIComponent(name)}`))
      fail(`the ${await tabs.last().innerText()} tab changed the view from ${name}`);
    await tabs.getByText(tab, { exact: true }).click({ timeout: 120000 });
    await shot(`1_domain_${name}`);
  }
  await chooseDomain(page, "All");
  if ((await tables()).length !== before.length) fail("All did not bring every layer back");
  if (h.display.some((d) => d.stage !== undefined) && !(await page.locator(".colourkey").count()))
    fail("All did not bring the colour key back");
}

/** Layers with object rows (`list`): the ticked ones list their objects; a click on a row selects that object (URL,
 *  inspector, the row marked). */
async function checkObjectRows(page, h, fail, shot, tag) {
  // The first ticked layer with object rows that this viewer draws (it leaves out reprs it does not know), in its tab.
  const tabOf = (d) =>
    (h.domains ?? []).find((x) => x.name === d.domain)?.shared || (h.domains?.length ?? 0) < 2
      ? (d.domain ?? "Objects")
      : "Detector";
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
      .locator(".tabpanel .headline")
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
  const s = decodeURIComponent(new URL(page.url()).hash.match(/s=([^&]+)/)?.[1] ?? "");
  const marked = await rows.first().getAttribute("class");
  log(`${tag}: a click on the first ${d.label} row selected ${s}`);
  if (!s.startsWith(`${d.table}:`) || !(await page.locator(".inspector").count()))
    fail(`a click on a ${d.label} row did not select it (s=${s})`);
  if (!marked?.includes("selected")) fail("the selected object's row is not marked");
  await shot("1_rows");
  await page.keyboard.press("Escape");
}

/** X crosses the reco <-> truth link from a selected object that has a match, and B comes back. */
async function checkCross(page, h, fail, tag) {
  const sel = () => decodeURIComponent(new URL(page.url()).hash.match(/s=([^&]+)/)?.[1] ?? "");
  const truth = new Set(h.display.filter((d) => d.truth).map((d) => d.table)),
    s0 = sel();
  if (!(await page.locator(".inspector .rung.self .rlink.match .chip").count())) return;
  await page.keyboard.press("x");
  await page.waitForTimeout(900);
  const s1 = sel(),
    across = truth.has(s1.split(":")[0]) !== truth.has(s0.split(":")[0]);
  const lanes = await page.locator(".inspector .ladder .rung").count();
  await page.keyboard.press("b");
  await page.waitForTimeout(900);
  log(`${tag}: X from ${s0} -> ${s1} (${lanes} steps on that side), B -> ${sel()}`);
  if (!across) fail(`X did not cross the reco <-> truth link (${s0} -> ${s1})`);
  if (!lanes) fail(`the other side of the link shows no steps (${s1})`);
  if (sel() !== s0) fail(`B did not come back from ${s1} to ${s0}`);
}

/** "only" on a kind's heading draws that kind alone, keeps it in the URL, and "show everything" brings the rest back. */
async function checkOnly(page, h, fail, shot, tag) {
  const tables = () =>
    page.evaluate(() =>
      window.evdEngine.layers
        .map((l) => l.table)
        .sort()
        .join(),
    );
  const button = page.locator(".sidebar .tabpanel section.kind:not(.folded) h3 .only").first();
  if (!(await button.count())) return;
  const before = await tables(),
    group = (await button.locator("xpath=..").locator(".fold").innerText()).trim();
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

/** With truth matches in the bundle, the Truth tab opens with the event's scorecard: a row per matched kind, and a
 *  count unfolds to its objects. */
async function checkScorecard(page, h, fail, shot, tag) {
  const truth = new Set(h.display.filter((d) => d.truth).map((d) => d.table));
  if (
    !Object.values(h.relations).some(
      (r) => r.match && truth.has(r.to) && h.display.some((d) => d.table === r.from && !d.alternative),
    )
  )
    return;
  await page.getByRole("tab", { name: "Truth", exact: true }).click();
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

/** With a domain bar: D keeps the selection and moves to the next domain it has objects in; a chip of the focus bar
 *  looks at its part of the detector, keeping the focus. */
async function checkDomainFocus(page, h, fail, shot, tag) {
  if ((h.domains?.length ?? 0) < 2 || !(await page.locator(".inspector").count())) return;
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
  const chip = page.locator(".inspector .rung .rtools .link").first(); // a step in another part of the detector
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

/** A selection draws its objects that a layer's filter hides (cuts still apply), and its levels drawn as lines (e.g. a
 *  vertex's tracks) with its smallest parts. Looks, in the page, for an object related through a plain relation to a
 *  row that a non-onSelection layer's filter hides but that passes the layer's cut; selects it and checks that row is
 *  drawn. Uses the app's own modules (dev server). */
async function checkFocusFilters(page, h, fail, tag) {
  if (!h.display.some((d) => d.filter && !d.onSelection)) return;
  const found = await page.evaluate(async () => {
    const url = (f) =>
      performance
        .getEntriesByType("resource")
        .map((r) => r.name)
        .find((n) => n.includes(f)); // ?t= after hot updates
    const store = await import(url("/src/model/store.ts")),
      custom = await import(url("/src/model/custom.ts"));
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = store.bundle.peek(),
      ev = store.event.peek(),
      cuts = store.cuts.peek(),
      out = [];
    for (const d of b.header.display.filter((x) => x.filter && !x.onSelection)) {
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
        const layer = window.evdEngine.layers.find((l) => l.table === d.table);
        const lines = store.levels
          .peek()
          .filter((l) => l.layers.every((x) => x.repr === "helix" || x.repr === "segments"));
        const undrawn = lines
          .flatMap((l) => l.layers)
          .filter((x) => !window.evdEngine.layers.some((l) => l.table === x.table))
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

async function checkLevels(page, h, target, fail, shot, tag) {
  const drawn = () =>
    page.evaluate(() =>
      window.evdEngine.layers
        .map((l) => l.table)
        .sort()
        .join(),
    );
  const style = () =>
    page.evaluate((t) => {
      // shower layers: surface style and transparency of the focus's layer
      const m = window.evdEngine.layers.find((l) => l.table === t)?.object.children?.[0]?.material;
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
  if (!(await page.locator(".inspector .rung .level").count()))
    return log(`${tag}: levels: ${pills.join(" › ") || "none"} (none drawn on request)`);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(600);
  const lit = await page.locator(".inspector .rung.shown .rkind").allInnerTexts(),
    down = await drawn();
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
  const looks = () =>
    page.evaluate(() =>
      window.evdEngine.layers
        .map((l) => {
          const m = l.object.children?.[0]?.material;
          return `${l.table}${m?.uniforms?.uStyle ? `/${m.uniforms.uStyle.value}/${m.transparent}` : ""}`;
        })
        .sort()
        .join(),
    );
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
  log(
    `${tag}: the pair from its particle, a level shown: ${fromTruth === fromCandidate ? "the same picture" : `differs: ${fromTruth} vs ${fromCandidate}`}`,
  );
  if (fromTruth !== fromCandidate) fail("the pair's particle and candidate draw different pictures");
  await page.locator(".inspector .looking .lookhead .link").click({ timeout: 120000 }); // stop looking at the particle
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(600);
}

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
  await menu.click();
  await item("Light theme").click();
  await shot("5_light");
  await menu.click();
  await item("Dark theme").click();
  // A press-drag-release rotates; it is not a click, so the selection stays.
  await page.mouse.move(700, 600);
  await page.mouse.down();
  await page.mouse.move(780, 560, { steps: 8 });
  await page.mouse.up();
  if (!(await page.locator(".inspector").count())) fail("a rotate drag cleared the selection");
  await page.keyboard.press("?");
  await shot("6_help");
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

  // The tour builds the event up step by step (ui/tour.ts: its captions in the order of the plan, window.evdTourPlan),
  // or for a bundle without the kinds the steps name, replays it and selects its main showers; any key stops it.
  const cam = () => page.evaluate(() => window.evdEngine.cam3d.position.toArray().map(Math.round).join());
  const c0 = await cam();
  await page.evaluate(() => {
    window.tourCaptions = [];
    new MutationObserver(() => {
      const t = document.querySelector(".caption.tour b")?.textContent;
      if (t && window.tourCaptions.at(-1) !== t) window.tourCaptions.push(t);
    }).observe(document.querySelector(".viewport"), { subtree: true, childList: true, characterData: true });
  });
  await page.keyboard.press("p");
  const staged = await page
    .waitForFunction(() => window.tourCaptions.length >= 3, null, { timeout: 90000 })
    .then(
      () => true,
      () => false,
    );
  const toured =
    staged ||
    (await page.waitForSelector(".inspector", { timeout: 60000 }).then(
      () => true,
      () => false,
    ));
  const c1 = await cam();
  await shot("8_tour");
  const [shown, plan] = await page.evaluate(() => [window.tourCaptions, window.evdTourPlan ?? []]);
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
  // Captions shown, recorded as they change (a MutationObserver on the view, installed before R), with the replay
  // clock: a poller missed short ones whenever software-WebGL frames were slow.
  await page.evaluate(() => {
    window.captions = [];
    const root = document.querySelector(".viewport");
    window.captionObserver = new MutationObserver(() => {
      const t = document.querySelector(".caption b")?.textContent,
        e = window.evdEngine;
      if (t && !t.startsWith("t =") && window.captions.at(-1)?.[0] !== t)
        window.captions.push([t, e.replayClock ? (performance.now() - e.replayClock.t0) / 1000 : 0]);
    });
    window.captionObserver.observe(root, { subtree: true, childList: true, characterData: true });
  });
  await page.keyboard.press("r");
  if (!(await page.evaluate(() => window.evdEngine.replaying))) fail("R did not start a replay");
  // Each hit layer arrives in the physics phase (its first 3 s, render/replay.ts TRAVEL) in any colour mode, not with
  // the clusters: half of its hits are shown by then. A layer has instances only for the rows the filter can show.
  const hitsAt = await page.evaluate(() =>
    window.evdEngine.layers
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
        const layers = window.evdEngine.layers,
          g = layers.find((l) => l.key === key)?.object.geometry,
          growth = window.evdPlan?.growth;
        const appear = g?.getAttribute("iT").array ?? [],
          ends = g?.getAttribute("iL").array ?? [];
        const lit = layers.find((l) => l.table === parts)?.object.geometry.getAttribute("iL").array ?? [];
        // every drawn path grows from the building's start (not the 0.5 s of an appearing line) and is whole by the fit
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
    .waitForFunction(() => !window.evdEngine.replaying, null, { timeout: 60000 })
    .catch(() => fail("the replay did not end"));
  const shown = await page.evaluate(() => {
    window.captionObserver.disconnect();
    return window.captions;
  });
  // The plan's captions, every 10 ms of the replay clock: what a frame at that time shows. A frame slower than a short
  // step (the fit) skips it on screen; the plan still has it, and what was shown must follow the plan's order.
  const captions = await page.evaluate(() => {
    const p = window.evdPlan,
      out = [];
    for (let s = 0; p && s < p.seconds; s += 0.01) {
      const t = p.caption(s)?.title;
      if (t && !t.startsWith("t =") && out.at(-1)?.[0] !== t) out.push([t, s]);
    }
    return out;
  });
  log(`  replay captions: ${captions.map(([c]) => c).join(" | ")}; shown: ${shown.map(([c]) => c).join(" | ")}`);
  let k = 0; // what was shown is the plan's captions in order, maybe with some skipped
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

/** The bundle's JSON header and file size: two range requests, or the whole file from a server without ranges. */
async function header(file) {
  const get = (from, to) => fetch(`${base}${file}`, { headers: { Range: `bytes=${from}-${to}` } });
  const head = await get(0, 11),
    buf = Buffer.from(await head.arrayBuffer()),
    n = buf.readUInt32LE(8);
  if (head.status === 200) return { ...JSON.parse(buf.subarray(12, 12 + n).toString()), size: buf.length };
  const size = Number(head.headers.get("Content-Range")?.split("/")[1]);
  // The index's offset and length are in the 16-byte trailer; it gives the number of events.
  const tail = Buffer.from(await (await get(size - 16, size - 1)).arrayBuffer()),
    at = Number(tail.readBigUInt64LE(0)),
    len = tail.readUInt32LE(8);
  const events = JSON.parse(Buffer.from(await (await get(at, at + len - 1)).arrayBuffer()).toString()).events.length;
  return { ...JSON.parse(Buffer.from(await (await get(12, 11 + n)).arrayBuffer()).toString()), size, events };
}
