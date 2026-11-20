// The site around the bundles: the data set chooser with my files, the recent ones and the shared ones, its filter and
// keys; a link to someone else's file; the login typed where the site does not say who is signed in; the start panel
// of a site without data; a link to a file that is gone, or to one that is not a bundle; links that are not trusted;
// a local file, dropped or picked; the share pop-up.
//
// It brings its own people and files: two people (tester, who is signed in, and alice) and their files are answers
// given to the page's requests for whoami and data/u/..., so it runs against any development server. Their bundles
// are the site's smallest one under other names. Some of the names end in .evdb, as bundles did before the project
// was called Ember: those still list, open from a link and open when dropped.
import { eventRead, expected404, header, log } from "./common.mjs";

/** Check the site around the bundles (see above). `run`: what every check needs (smoke.mjs). */
export async function checkSite(run) {
  const { browser, base, out, problems, listed } = run;
  const fail = (text) => problems.push(`site: ${text}`);
  const headers = Object.fromEntries(await Promise.all(listed.map(async (b) => [b.file, await header(base, b.file)])));
  const sizes = Object.fromEntries(listed.map((b) => [b.file, headers[b.file].size]));
  const small = [...listed].sort((a, c) => sizes[a.file] - sizes[c.file])[0],
    other = listed.find((b) => b !== small);
  if (!small) return fail("no bundle in index.json to check the site with");
  const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
  const indexes = {
    tester: {
      updated: days(0),
      bundles: [
        {
          file: "data/u/tester/reco_test.ember",
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
    page.on("console", (m) => m.type() === "error" && !expected404(m, base) && fail(m.text()));
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
      (url) => /\/data\/u\/[^/]+\/[^/]+\.(ember|evdb)$/.test(url.pathname),
      (r) => {
        const url = new URL(r.request().url());
        return url.pathname.endsWith("/gone.ember")
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
    const plain = (b) => (headers[b.file].domains ?? []).length < 2,
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
    if (!page.url().includes("b=data/u/tester/reco_test.ember"))
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
    for (const part of ["ember file.root", ".ember", "link", "Documentation"])
      if (!text.includes(part)) fail(`the start panel does not mention "${part}"`);
    if (await page.isVisible(".sidebar")) fail("the empty side panel shows next to the start panel");
    if ((await page.title()) !== "Ember") fail(`with nothing open the page is titled "${await page.title()}"`);
    if (!(await page.getAttribute(".startpanel a", "href"))?.startsWith("http"))
      fail("the start panel's documentation link goes nowhere");
    await page.click(".command .link");
    if ((await page.evaluate(() => navigator.clipboard.readText()).catch(() => null)) !== "ember file.root")
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
    const page = await visit("#b=data/u/alice/gone.ember&e=3", { theme, width });
    await page.waitForSelector(".startpanel [role=alert]", { timeout: 30000 });
    const text = await page.textContent(".startpanel");
    for (const part of ["no longer here", "published by alice", "ember file.root", "HTTP 404"])
      if (!text.includes(part)) fail(`a link to a file that is gone does not say "${part}": ${text}`);
    if (await page.$(".toast-error")) fail("a file that is gone is also reported as a passing message");
    await shot(page, `gone_${theme}_${width}`);
    await page.click(".startpanel .primary");
    await page.waitForSelector(".chooserpanel");
    await page.fill(".chooserpanel .filter", small.title);
    await page.keyboard.press("Enter");
    await shown(page);
    if (await page.$(".startpanel")) fail("the panel about the missing file stays after another data set opened");
    if (await page.evaluate(() => (localStorage.getItem("evd.recent") ?? "").includes("gone.ember")))
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
    if (await page.$(".toast-error"))
      fail(`an overtaken open left a message: ${await page.textContent(".toast-error")}`);
    await page.context().close();
  }

  // Review, finding 2. The name in a link is not trusted. A name that is not a file of this site nor a web address is
  // refused, and says nothing about a publisher; an address on another site opens marked as such: no publisher, not
  // under Recent, and a share pop-up that says who it opens for.
  for (const name of [
    "data/u/alice/..%5Ctester%5Creco_test.ember",
    "data/u/../x.ember",
    `${small.file}%3Fx=1`,
    "%2Fetc%2Fx.ember",
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
    if (requests.some((u) => /\.(ember|evdb)/.test(u)))
      fail(`the name ${name} in a link was fetched: ${requests.filter((u) => /\.(ember|evdb)/.test(u)).join(", ")}`);
    if (await page.evaluate(() => localStorage.getItem("evd.recent")))
      fail(`the name ${name} in a link was remembered under Recent`);
    await page.context().close();
  }
  {
    const elsewhere = "http://elsewhere.example/data/u/alice/shown_to_all.ember";
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
          { file: "http://elsewhere.example/first.ember", title: "An address, not a file of mine", created: days(0) },
          {
            file: "data/u/tester/reco_test.ember",
            title: "My rereco test",
            events: null,
            created: days(-1),
            expires: 7,
          },
          { file: "data/u/alice/for_the_meeting.evdb", title: "Someone else's file in my list" },
          { file: "data/u/tester/../../index.ember", title: "Climbing out" },
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
      people: { tester: { bundles: [{ file: "data/u/tester/x.ember", title: "X", events: null }] } },
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
    const accept = await picker.element().getAttribute("accept");
    if (accept !== ".ember,.evdb") fail(`the file chooser offers "${accept}", not .ember and .evdb files`);
    await picker.setFiles({ name: "from_my_disk.ember", mimeType: "application/octet-stream", buffer: bytes });
    await page
      .waitForFunction(() => document.querySelector(".dataset .name")?.textContent === "from_my_disk.ember", null, {
        timeout: 30000,
      })
      .catch(() => fail("a local file does not open from the chooser"));
    await shown(page);
    if (!(await page.$(".dataset .tag"))) fail("a local file is not marked as local on the chooser's button");
    if (page.url().includes("b=")) fail(`a local file is in the address, which cannot open it: ${page.url()}`);
    await page.click(".share");
    const text = await page.textContent(".popover");
    if (!/A local file has no link/i.test(text) || !text.includes("ember file.root"))
      fail(`sharing a local file says: ${text}`);
    await shot(page, "local");
    await page.keyboard.press("Escape");
    await page.click(".dataset");
    const row = await page.$eval(".dataset-row.off", (r) => r.textContent).catch(() => "");
    if (!/from_my_disk\.ember.*drop it/.test(row)) fail(`a local file under Recent reads "${row}"`);
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
      data.items.add(new File(["these are my notes, not a bundle"], "notes.ember"));
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
    if (requests.some((u) => u.includes("notes.ember"))) fail("a local file's name was fetched from the site");
    await shot(page, "local_failed");
    await page.context().close();
  }
}
