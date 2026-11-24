// What the browser checks share: time limits, progress lines, page helpers, and reading a bundle's header.

/** A bundle not checked within BUNDLE_TIMEOUT ms fails, and the run goes on with the next one; one with big events
 *  (bigEvents) gets three times as long. */
export const BUNDLE_TIMEOUT = 300_000,
  BIG_FILE = 500e6;
export const BIG = 200_000; // objects drawn above which a bundle gets one small screenshot (software WebGL is slow)
/** A bundle whose events are big (PU200: ~600k HGCal hits): software WebGL is slow on their scenes. Counted in rows,
 *  not bytes: a PU200 event is 5 MB in a bundle of today and was 30 MB before, with the same hits to draw. */
export const bigEvents = (h) => h.size > BIG_FILE || h.rows > BIG;
/** Whether a bundle header has a domain bar (two or more domains). */
export const hasDomainBar = (h) => (h.domains?.length ?? 0) >= 2;

/** A progress line, after the time of day (UTC). */
export const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);

/** Whether `promise` resolves (true) or rejects (false). */
export const succeeds = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

/** Report every console error and uncaught exception of `page` with `fail`, but the 404s the page expects: a site
 *  without `whoami`, a person without files (no index), a link to a file that is gone. */
export function failOnErrors(page, base, fail) {
  const expected404 = (m) =>
    /status of 404/.test(m.text()) &&
    /\/whoami$|\/index\.json$|\/gone\.ember$/.test(new URL(m.location().url || base).pathname);
  page.on("console", (m) => m.type() === "error" && !expected404(m) && fail(m.text()));
  page.on("pageerror", (e) => fail(e.message));
}

/** Save a screenshot to `<dir>/<prefix>_<name>.png`: a record, not a check, so a timeout is only logged. */
export const screenshot = (page, dir, prefix, name) =>
  page
    .screenshot({ path: `${dir}/${prefix}_${name}.png`, timeout: 60000 })
    .catch(() => log(`${prefix}: screenshot ${name} timed out`));

/** Wait until a bundle is open and the event asked for was read: the top bar names an event as soon as the bundle's
 *  header is in, while the event itself (35 MB at PU200) may still be on its way, which the progress bar shows. */
export async function eventRead(page) {
  await page.waitForSelector(".eventid strong:has-text('· Event')", { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector(".topbar .progress"), null, { timeout: 90000 });
}

/** The value of `key` in the page's address (#…&key=value&…), decoded; "" if absent. */
export const hashParam = (page, key) =>
  decodeURIComponent(new URL(page.url()).hash.match(new RegExp(`[#&]${key}=([^&]+)`))?.[1] ?? "");

/** The tables of the layers the engine draws now. */
export const drawnTables = (page) => page.evaluate(() => window.emberEngine.layers.map((l) => l.table));

/** The bundle's JSON header, with its file size, number of events, largest event (rows) and rows per table per event
 *  (from the index): three range requests, or the whole file from a server without ranges. */
export async function header(base, file) {
  const get = (from, to) => fetch(`${base}${file}`, { headers: { Range: `bytes=${from}-${to}` } });
  const head = await get(0, 11),
    buf = Buffer.from(await head.arrayBuffer()),
    n = buf.readUInt32LE(8);
  const whole = head.status === 200,
    size = whole ? buf.length : Number(head.headers.get("Content-Range")?.split("/")[1]),
    bytes = async (from, to) =>
      whole ? buf.subarray(from, to + 1) : Buffer.from(await (await get(from, to)).arrayBuffer());
  // The index's offset and length are in the 16-byte trailer; it lists the events, with their rows per table.
  const tail = await bytes(size - 16, size - 1),
    at = Number(tail.readBigUInt64LE(0)),
    len = tail.readUInt32LE(8);
  const index = JSON.parse((await bytes(at, at + len - 1)).toString()).events,
    counts = index.map((e) => e.counts ?? {}),
    rows = counts.reduce(
      (most, c) =>
        Math.max(
          most,
          Object.values(c).reduce((a, k) => a + k, 0),
        ),
      0,
    );
  return { ...JSON.parse((await bytes(12, 11 + n)).toString()), size, events: index.length, rows, counts };
}
