// What the browser checks share: the clock in the progress lines, the time limits, reading a bundle's header, and
// waiting for an event to be read.

/** A bundle not checked within BUNDLE_TIMEOUT ms fails, and the run goes on with the next one. A file over BIG_FILE
 *  bytes, or with events over BIG_EVENT bytes each, gets three times as long. */
export const BUNDLE_TIMEOUT = 300_000,
  BIG_FILE = 500e6,
  BIG_EVENT = 10e6;
/** A bundle whose events are big (PU200: ~30 MB each), however many it holds: software WebGL is slow on its scenes. */
export const bigEvents = (h) => h.size > BIG_FILE || h.size / Math.max(1, h.events) > BIG_EVENT;
export const BIG = 200_000; // objects drawn above which a bundle gets one small screenshot (software WebGL is slow)
/** A progress line, after the time of day (UTC). */
export const log = (text) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);

/** The browser's own line for a request answered 404, where that is an answer the page expects: a site without
 *  `whoami`, a person without files (no index), a link to a file that is gone. */
export const expected404 = (m, base) =>
  /status of 404/.test(m.text()) &&
  /\/whoami$|\/index\.json$|\/gone\.ember$/.test(new URL(m.location().url || base).pathname);

/** Wait until a bundle is open and the event asked for was read: the top bar names an event as soon as the bundle's
 *  header is in, while the event itself (35 MB at PU200) is still on its way, which the progress bar shows. */
export async function eventRead(page) {
  await page.waitForSelector(".eventid strong:has-text('· Event')", { timeout: 90000 });
  await page.waitForFunction(() => !document.querySelector(".topbar .progress"), null, { timeout: 90000 });
}

/** The bundle's JSON header and file size: two range requests, or the whole file from a server without ranges. */
export async function header(base, file) {
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
