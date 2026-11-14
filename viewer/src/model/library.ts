// The data sets a person can open, beyond the site's shared list (index.json, store/open.ts `catalogue`): their own
// (data/u/<login>/index.json, written by `evd file.root`) and the ones they opened lately from links. Who they are
// comes from the site (`whoami`, answered behind the single sign-on) or, failing that, from the login they type once.
// Nothing here draws: the chooser (ui/Chooser.tsx) and the start panels (ui/Start.tsx) do.
import { signal } from "@preact/signals";
import { FormatError, HttpError, NetworkError } from "../io/bundle";

/** The documentation site: every "how do I get data in" link points here. */
export const DOCS_URL = "https://mmarriot.github.io/evd/";
/** The one command that converts a file, publishes it in the user's area and prints its link. */
export const PUBLISH_COMMAND = "evd file.root";
/** Asked relative to the page: {"login": "..."} for the signed-in person. */
export const WHOAMI_URL = "whoami";
const LOGIN_KEY = "evd.login",
  RECENT_KEY = "evd.recent";
const RECENT_MAX = 12;
const WHOAMI_WAIT = 4000; // ms: a site whose whoami hangs is a site without one

/** One entry of an index.json: the site's (written by `evdtools sync`; hand-written ones need only file and title) or
 *  a person's (ISO times: `published`, when it was put on the site; `created`, when it was converted; `expires`).
 *  `file` is relative to the site's root. */
export interface Listed {
  file: string;
  title: string;
  campaign?: string;
  campaign_title?: string;
  events?: number;
  data_time?: string;
  created?: string;
  published?: string;
  expires?: string;
}
/** A data set opened from a link (or a local file dropped on the page, which cannot be opened again from here). */
export interface Recent {
  file: string;
  title: string;
  time: string;
  local?: boolean;
}
/** Who the page is for: `sso` when the site said so, `typed` when the person did. */
export interface Login {
  name: string;
  from: "sso" | "typed";
}

export const login = signal<Login | null>(null);
/** The person's own data sets, newest first; empty until the login is known and their index is read. */
export const mine = signal<Listed[]>([]);
/** My index could not be read the last time (offline, or not an index): what is listed may be out of date, or missing. */
export const mineUnread = signal(false);
export const recent = signal<Recent[]>([]);

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** The browser's storage, which can be missing or refuse (private windows, tests): then nothing is remembered. */
export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
export const browserStorage: Storage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* not remembered */
    }
  },
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to forget */
    }
  },
};

/** A login as typed, tidied: lower case, no spaces, no "@cern.ch"; null if it cannot be a CERN login. */
export function cleanLogin(text: string): string | null {
  const name = text
    .trim()
    .toLowerCase()
    .replace(/@cern\.ch$/, "");
  return /^[a-z][a-z0-9_-]{1,31}$/.test(name) ? name : null;
}

// A link's `b=` and an index's `file` are text from somewhere else. A name is used as a file of this site only if it
// is plainly one: a relative path of ordinary segments. Anything the browser would resolve elsewhere than it reads
// ("..", a backslash, which browsers take for "/", an encoded dot, a leading "/", a scheme) or that names the same
// file twice ("?x=1", "#") is not.
/** The name, if it is a path of this site as the viewer writes them ("data/u/alice/x.evdb"); else null. */
export function siteFile(name: string): string | null {
  if (!name || /[\\?#%\u0000-\u001f\u007f]/.test(name) || /^[a-z][a-z0-9+.-]*:/i.test(name)) return null;
  return name.split("/").every((part) => part && part !== "." && part !== "..") ? name : null;
}
/** Where a name leads: a file of this site, a web address elsewhere (`external`: it still opens, marked as such,
 *  for whoever can reach it), or nowhere the viewer goes (`bad`). An address inside this site (under `base`, the
 *  page's own) is the site's file. */
export type Place = { kind: "site"; file: string } | { kind: "external"; url: string } | { kind: "bad" };
export function locate(
  name: string,
  base: string | undefined = typeof document === "undefined" ? undefined : document.baseURI,
): Place {
  const file = siteFile(name);
  if (file) return { kind: "site", file };
  if (!/^https?:\/\//i.test(name)) return { kind: "bad" };
  try {
    const url = new URL(name),
      here = base ? new URL(".", base) : null;
    if (url.username || url.password) return { kind: "bad" };
    if (here && url.origin === here.origin && url.pathname.startsWith(here.pathname) && !url.search && !url.hash) {
      const inside = siteFile(decodeURIComponent(url.pathname.slice(here.pathname.length)));
      if (inside) return { kind: "site", file: inside };
    }
    return { kind: "external", url: url.href };
  } catch {
    return { kind: "bad" };
  }
}
/** A name that leads nowhere the viewer goes. */
export class NameError extends Error {
  constructor(readonly given: string) {
    super(`not a data set's name: ${given.slice(0, 120)}`);
  }
}

/** The login whose area a file is in ("data/u/alice/x.evdb" -> "alice"); null for a shared data set, and for any
 *  name that is not exactly a file in a person's area (so nothing is said to be "published by" a name's look). */
export function ownerOf(file: string): string | null {
  const owner = siteFile(file)?.match(/^data\/u\/([^/]+)\/[^/]+$/)?.[1];
  return owner && cleanLogin(owner) === owner ? owner : null;
}
export const userIndex = (name: string) => `data/u/${name}/index.json`;
/** A name for a data set no index lists: its file name without the extension, and whose area (or which other site)
 *  it is in. */
export function titleOf(file: string): string {
  const stem =
      file
        .split(/[?#]/)[0]
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/\.evdb$/, "") ?? file,
    owner = ownerOf(file);
  const host = /^https?:\/\//i.test(file) ? file.split("/")[2] : null;
  return owner ? `${stem} · ${owner}` : host ? `${stem} · ${host}` : stem;
}

const text = (x: unknown) => (typeof x === "string" ? x : undefined);
/** An index entry as the viewer uses it, or null: `file` a file of this site (of `owner`'s area, for a person's
 *  index: nobody lists another's files, or an address elsewhere), `title` text; the rest kept only in its type. */
function cleanEntry(x: unknown, owner?: string): Listed | null {
  const e = (x ?? {}) as Record<string, unknown>,
    file = text(e.file),
    title = text(e.title);
  if (!file || !title || siteFile(file) !== file || (owner !== undefined && ownerOf(file) !== owner)) return null;
  return {
    file,
    title,
    campaign: text(e.campaign),
    campaign_title: text(e.campaign_title),
    data_time: text(e.data_time),
    created: text(e.created),
    published: text(e.published),
    expires: text(e.expires),
    events: typeof e.events === "number" && Number.isFinite(e.events) ? e.events : undefined,
  };
}
/** The entries of an index's `bundles` that are entries (see cleanEntry); null if it is not a list. */
export const cleanList = (bundles: unknown, owner?: string): Listed[] | null =>
  Array.isArray(bundles) ? bundles.map((x) => cleanEntry(x, owner)).filter((x): x is Listed => !!x) : null;

/** Who the page is for: the login typed before (at once, from storage), then the site's answer, which wins. A site
 *  without `whoami` (any failure, or an answer that is not {"login": ...}: a development server answers with the
 *  page itself) changes nothing, silently. */
export async function loadIdentity(fetcher: Fetch = fetch, storage: Storage = browserStorage) {
  const typed = cleanLogin(storage.get(LOGIN_KEY) ?? "");
  if (typed && !login.peek()) login.value = { name: typed, from: "typed" };
  try {
    const r = await fetcher(WHOAMI_URL, { cache: "no-store", signal: AbortSignal.timeout(WHOAMI_WAIT) });
    const answer = r.ok ? (await r.json())?.login : null,
      name = typeof answer === "string" ? cleanLogin(answer) : null;
    if (name) login.value = { name, from: "sso" };
  } catch {
    /* no whoami here (or none in time): the typed login, or none */
  }
}

/** Remember the login the person typed (false: not a login). The site's own answer is not overridden. */
export function typeLogin(text: string, storage: Storage = browserStorage): boolean {
  const name = cleanLogin(text);
  if (!name || login.peek()?.from === "sso") return false;
  storage.set(LOGIN_KEY, name);
  login.value = { name, from: "typed" };
  mine.value = [];
  mineUnread.value = false;
  return true;
}
export function forgetLogin(storage: Storage = browserStorage) {
  if (login.peek()?.from === "sso") return;
  storage.remove(LOGIN_KEY);
  login.value = null;
  mine.value = [];
  mineUnread.value = false;
}

/** When a data set came to the site: its publication, or for an index without it the conversion. */
export const publishedAt = (x: Listed) => x.published ?? x.created ?? x.data_time;
const newestFirst = (a: Listed, b: Listed) => (publishedAt(b) ?? "").localeCompare(publishedAt(a) ?? "");
/** Read a person's index: their data sets (their own, well-formed entries: cleanEntry), newest first; [] when they
 *  have none (no index yet); null when it could not be read (offline, or not an index). */
export async function readIndex(name: string, fetcher: Fetch = fetch): Promise<Listed[] | null> {
  try {
    const r = await fetcher(userIndex(name), { cache: "no-store" });
    if (r.status === 404) return [];
    return (r.ok ? cleanList((await r.json())?.bundles, name) : null)?.sort(newestFirst) ?? null;
  } catch {
    return null;
  }
}
/** Re-read my index (it changes when I publish, and as files expire); what is shown stays while it cannot be read. */
export async function refreshMine(fetcher: Fetch = fetch) {
  const who = login.peek();
  if (!who) return;
  const list = await readIndex(who.name, fetcher);
  if (login.peek()?.name !== who.name) return; // another login was typed meanwhile
  mineUnread.value = !list;
  if (list && JSON.stringify(list) !== JSON.stringify(mine.peek())) mine.value = list; // the same list: nothing re-runs
}

/** The recent data sets as stored, without what is not one: an entry names a file of this site, or a local file. */
function storedRecent(storage: Storage): Recent[] {
  try {
    const saved = JSON.parse(storage.get(RECENT_KEY) ?? "[]");
    const entry = (r: Recent) =>
      typeof r?.file === "string" &&
      typeof r?.title === "string" &&
      typeof r?.time === "string" &&
      (r.local === true || siteFile(r.file) === r.file);
    return Array.isArray(saved) ? saved.filter(entry).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
export function loadRecent(storage: Storage = browserStorage) {
  recent.value = storedRecent(storage);
}
/** The list to change: the stored one, which another tab may have added to since this one read it; this tab's own
 *  where nothing is stored (no storage). */
const latestRecent = (storage: Storage) => (storage.get(RECENT_KEY) === null ? recent.peek() : storedRecent(storage));
const saveRecent = (list: Recent[], storage: Storage) => {
  recent.value = list;
  storage.set(RECENT_KEY, JSON.stringify(list));
};
/** Put a data set at the top of the recent ones (once; the oldest beyond RECENT_MAX are dropped). Only a file of this
 *  site or a local file: an address elsewhere is not remembered. */
export function noteRecent(entry: Omit<Recent, "time">, now = new Date(), storage: Storage = browserStorage) {
  if (!entry.local && siteFile(entry.file) !== entry.file) return;
  const same = (r: Recent) => r.file === entry.file && !!r.local === !!entry.local;
  saveRecent(
    [{ ...entry, time: now.toISOString() }, ...latestRecent(storage).filter((r) => !same(r))].slice(0, RECENT_MAX),
    storage,
  );
}
export function forgetRecent(file: string, storage: Storage = browserStorage) {
  const list = latestRecent(storage);
  if (list.some((r) => r.file === file))
    saveRecent(
      list.filter((r) => r.file !== file),
      storage,
    );
}
/** Drop the recent data sets that a list now has (a link's data set opens before the lists are read). */
export function pruneRecent(listed: Iterable<string>, storage: Storage = browserStorage) {
  const list = latestRecent(storage),
    kept = recentShown(list, listed);
  if (kept.length !== list.length) saveRecent(kept, storage);
}
/** The recent data sets to list: those no other section lists (my own and the shared ones have their place). */
export function recentShown(list: Recent[], listed: Iterable<string>): Recent[] {
  const known = new Set(listed);
  return list.filter((r) => r.local || !known.has(r.file));
}

const DAY = 86_400_000;
const msUntil = (iso: string | undefined, now: Date) => (iso ? Date.parse(iso) : NaN) - now.getTime(); // NaN: not a time
/** "expires in 12 days", "expires tomorrow", "expires today" (within 24 h), "expired"; "" without an expiry. Days are
 *  rounded, so a file published a moment ago for 30 days expires "in 30 days", not 29. */
export function expiryText(expires: string | undefined, now = new Date()): string {
  const ms = msUntil(expires, now),
    days = Math.round(ms / DAY);
  if (Number.isNaN(ms)) return "";
  return ms < 0 ? "expired" : ms < DAY ? "expires today" : days === 1 ? "expires tomorrow" : `expires in ${days} days`;
}
/** "today" (within 24 h), "yesterday", "5 days ago", then the date; "" if `iso` is not a time. */
export function agoText(iso: string | undefined, now = new Date()): string {
  const ms = -msUntil(iso, now),
    days = Math.floor(ms / DAY);
  if (Number.isNaN(ms)) return "";
  return days <= 0
    ? "today"
    : days === 1
      ? "yesterday"
      : days < 30
        ? `${days} days ago`
        : new Date(iso!).toISOString().slice(0, 10);
}

/** Whether every word of the filter is in the entry's title or file name, whatever the case. */
export function matches(filter: string, entry: { title: string; file: string }): boolean {
  const text = `${entry.title} ${entry.file}`.toLowerCase();
  return filter
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

/** Why a data set did not open, in words for the person who followed a link to it (or dropped a file: `local`; or
 *  gave an address on another site: `external`). */
export interface Failure {
  kind: "gone" | "denied" | "offline" | "unreadable" | "badname" | "error";
  name: string;
  title: string;
  text: string;
  detail: string;
  local: boolean;
  external: boolean;
}
export function describeFailure(name: string, error: unknown, local = false): Failure {
  const detail = error instanceof Error ? error.message : String(error),
    owner = local ? null : ownerOf(name);
  const external = !local && locate(name).kind === "external",
    where = external ? "That address" : "The site";
  const stem = name.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? name; // the file's own name
  const say = (kind: Failure["kind"], title: string, text: string): Failure => ({
    kind,
    name,
    title,
    text,
    detail,
    local,
    external,
  });
  if (error instanceof NameError)
    return say(
      "badname",
      "This link does not name a data set",
      "The data set in the link is neither a file of this site nor a web address: the link may have been cut or changed on the way. Ask for it again, or choose a data set.",
    );
  if (local) {
    return error instanceof FormatError
      ? say(
          "unreadable",
          "This file is not a data set",
          `${name} is not an .evdb bundle, or it is incomplete: convert it again.`,
        )
      : say(
          "error",
          "This file could not be read",
          `${name} could not be read from your computer. Choose it again, or convert it again.`,
        );
  }
  if (error instanceof HttpError && (error.status === 404 || error.status === 410)) {
    return say(
      "gone",
      external ? "There is no such file at that address" : "This data set is no longer here",
      owner
        ? `${stem} was published by ${owner}. Published files are removed after a while, or its owner took it down. Ask ${owner} to publish it again, or choose another data set.`
        : external
          ? `${name} answers that it has no such file. Ask whoever sent the link, or choose another data set.`
          : `There is no ${stem} on this site: it was removed, or the link is not complete. Choose another data set.`,
    );
  }
  if (error instanceof HttpError && (error.status === 401 || error.status === 403))
    return say(
      "denied",
      "You cannot open this data set",
      `${where} refused ${stem} (HTTP ${error.status}).${external ? "" : " Reloading the page signs you in again; if it still refuses, ask whoever sent the link."}`,
    );
  if (error instanceof HttpError)
    return say(
      "error",
      `${where} could not send this data set`,
      `Reading ${stem} failed (HTTP ${error.status}). Try again in a moment.`,
    );
  if (error instanceof NetworkError) {
    // no answer the page may read
    return external
      ? say(
          "offline",
          "That address did not answer",
          `${name} could not be read: it is unreachable from here, or it does not let pages of other sites read it.`,
        )
      : say(
          "offline",
          "The site did not answer",
          `${stem} could not be read. Check the connection; if your CERN sign-on has expired, reloading the page signs you in again.`,
        );
  }
  if (error instanceof FormatError)
    return say(
      "unreadable",
      "This file cannot be read",
      `${stem} is not a complete data set for this viewer: it may still be uploading, or was written by something else. Try again in a minute, or convert it again.`,
    );
  return say("error", "This data set did not open", `Opening ${stem} failed. Try again, or choose another data set.`);
}
