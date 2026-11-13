// The data sets a person can open, beyond the site's shared list (index.json, store.ts `catalogue`): their own
// (data/u/<login>/index.json, written by `evd file.root`) and the ones they opened lately from links. Who they are
// comes from the site (`whoami`, answered behind the single sign-on) or, failing that, from the login they type once.
// Nothing here draws: the chooser (ui/Chooser.tsx) and the start panels (ui/Start.tsx) do.
import { signal } from "@preact/signals";
import { HttpError } from "../io/bundle";

/** The documentation site: every "how do I get data in" link points here. */
export const DOCS_URL = "https://mmarriot.github.io/evd/";
/** The one command that converts a file, publishes it in the user's area and prints its link. */
export const PUBLISH_COMMAND = "evd file.root";
/** Asked relative to the page: {"login": "..."} for the signed-in person. */
export const WHOAMI_URL = "whoami";
const LOGIN_KEY = "evd.login", RECENT_KEY = "evd.recent";
const RECENT_MAX = 12;

/** One entry of an index.json: the site's (written by `evdtools sync`; hand-written ones need only file and title) or
 *  a person's (`created` and `expires` as ISO times). `file` is relative to the site's root. */
export interface Listed {
  file: string; title: string; campaign?: string; campaign_title?: string; events?: number; data_time?: string;
  created?: string; expires?: string;
}
/** A data set opened from a link (or a local file dropped on the page, which cannot be opened again from here). */
export interface Recent { file: string; title: string; time: string; local?: boolean }
/** Who the page is for: `sso` when the site said so, `typed` when the person did. */
export interface Login { name: string; from: "sso" | "typed" }

export const login = signal<Login | null>(null);
/** The person's own data sets, newest first; empty until the login is known and their index is read. */
export const mine = signal<Listed[]>([]);
export const recent = signal<Recent[]>([]);

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** The browser's storage, which can be missing or refuse (private windows, tests): then nothing is remembered. */
export interface Storage { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }
export const browserStorage: Storage = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* not remembered */ } },
  remove: (key) => { try { localStorage.removeItem(key); } catch { /* nothing to forget */ } },
};

/** The login whose area a file is in ("data/u/alice/x.evdb" -> "alice"), or null for a shared data set. */
export const ownerOf = (file: string) => file.match(/^data\/u\/([^/]+)\/[^/]+$/)?.[1] ?? null;
export const userIndex = (name: string) => `data/u/${name}/index.json`;
/** A login as typed, tidied: lower case, no spaces, no "@cern.ch"; null if it cannot be a CERN login. */
export function cleanLogin(text: string): string | null {
  const name = text.trim().toLowerCase().replace(/@cern\.ch$/, "");
  return /^[a-z][a-z0-9_-]{1,31}$/.test(name) ? name : null;
}
/** A name for a data set no index lists: its file name without the extension, and whose area it is in. */
export function titleOf(file: string): string {
  const stem = file.split("/").pop()!.replace(/\.evdb$/, ""), owner = ownerOf(file);
  return owner ? `${stem} · ${owner}` : stem;
}

/** Who the page is for: the login typed before (at once, from storage), then the site's answer, which wins. A site
 *  without `whoami` (any failure, or an answer that is not {"login": ...}: a development server answers with the
 *  page itself) changes nothing, silently. */
export async function loadIdentity(fetcher: Fetch = fetch, storage: Storage = browserStorage) {
  const typed = cleanLogin(storage.get(LOGIN_KEY) ?? "");
  if (typed && !login.peek()) login.value = { name: typed, from: "typed" };
  try {
    const r = await fetcher(WHOAMI_URL, { cache: "no-store" });
    const name = r.ok ? cleanLogin(String((await r.json())?.login ?? "")) : null;
    if (name) login.value = { name, from: "sso" };
  } catch { /* no whoami here: the typed login, or none */ }
}

/** Remember the login the person typed (false: not a login). The site's own answer is not overridden. */
export function typeLogin(text: string, storage: Storage = browserStorage): boolean {
  const name = cleanLogin(text);
  if (!name || login.peek()?.from === "sso") return false;
  storage.set(LOGIN_KEY, name);
  login.value = { name, from: "typed" };
  mine.value = [];
  return true;
}
export function forgetLogin(storage: Storage = browserStorage) {
  if (login.peek()?.from === "sso") return;
  storage.remove(LOGIN_KEY);
  login.value = null;
  mine.value = [];
}

const newestFirst = (a: Listed, b: Listed) => (b.created ?? b.data_time ?? "").localeCompare(a.created ?? a.data_time ?? "");
/** Read a person's index: their data sets, newest first; [] when they have none (no index yet); null when it could
 *  not be read (offline, or not an index). */
export async function readIndex(name: string, fetcher: Fetch = fetch): Promise<Listed[] | null> {
  try {
    const r = await fetcher(userIndex(name), { cache: "no-store" });
    if (r.status === 404) return [];
    const bundles = r.ok ? (await r.json())?.bundles : null;
    return Array.isArray(bundles) ? bundles.filter((b) => typeof b?.file === "string" && typeof b?.title === "string").sort(newestFirst) : null;
  } catch { return null; }
}
/** Re-read my index (it changes when I publish, and as files expire); what is shown stays while it cannot be read. */
export async function refreshMine(fetcher: Fetch = fetch) {
  const who = login.peek();
  if (!who) return;
  const list = await readIndex(who.name, fetcher);
  if (list && login.peek()?.name === who.name) mine.value = list;
}

export function loadRecent(storage: Storage = browserStorage) {
  try {
    const saved = JSON.parse(storage.get(RECENT_KEY) ?? "[]");
    recent.value = Array.isArray(saved) ? saved.filter((r) => typeof r?.file === "string" && typeof r?.title === "string").slice(0, RECENT_MAX) : [];
  } catch { recent.value = []; }
}
const saveRecent = (list: Recent[], storage: Storage) => { recent.value = list; storage.set(RECENT_KEY, JSON.stringify(list)); };
/** Put a data set at the top of the recent ones (once; the oldest beyond RECENT_MAX are dropped). */
export function noteRecent(entry: Omit<Recent, "time">, now = new Date(), storage: Storage = browserStorage) {
  const same = (r: Recent) => r.file === entry.file && !!r.local === !!entry.local;
  saveRecent([{ ...entry, time: now.toISOString() }, ...recent.peek().filter((r) => !same(r))].slice(0, RECENT_MAX), storage);
}
export function forgetRecent(file: string, storage: Storage = browserStorage) {
  if (recent.peek().some((r) => r.file === file)) saveRecent(recent.peek().filter((r) => r.file !== file), storage);
}
/** Drop the recent data sets that a list now has (a link's data set opens before the lists are read). */
export function pruneRecent(listed: Iterable<string>, storage: Storage = browserStorage) {
  const kept = recentShown(recent.peek(), listed);
  if (kept.length !== recent.peek().length) saveRecent(kept, storage);
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
  const ms = msUntil(expires, now), days = Math.round(ms / DAY);
  if (Number.isNaN(ms)) return "";
  return ms < 0 ? "expired" : ms < DAY ? "expires today" : days === 1 ? "expires tomorrow" : `expires in ${days} days`;
}
/** "today" (within 24 h), "yesterday", "5 days ago", then the date; "" if `iso` is not a time. */
export function agoText(iso: string | undefined, now = new Date()): string {
  const ms = -msUntil(iso, now), days = Math.floor(ms / DAY);
  if (Number.isNaN(ms)) return "";
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : new Date(iso!).toISOString().slice(0, 10);
}

/** Whether every word of the filter is in the entry's title or file name, whatever the case. */
export function matches(filter: string, entry: { title: string; file: string }): boolean {
  const text = `${entry.title} ${entry.file}`.toLowerCase();
  return filter.toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

/** Why a data set did not open, in words for the person who followed a link to it. */
export interface Failure { kind: "gone" | "denied" | "offline" | "unreadable" | "error"; name: string; title: string; text: string; detail: string }
export function describeFailure(name: string, error: unknown): Failure {
  const detail = error instanceof Error ? error.message : String(error), owner = ownerOf(name);
  const stem = name.split("/").pop() ?? name;
  if (error instanceof HttpError && (error.status === 404 || error.status === 410)) {
    return {
      kind: "gone", name, detail, title: "This data set is no longer here",
      text: owner ? `${stem} was published by ${owner}. Published files are removed after a while, or its owner took it down. Ask ${owner} to publish it again, or choose another data set.`
        : `There is no ${stem} on this site: it was removed, or the link is not complete. Choose another data set.`,
    };
  }
  if (error instanceof HttpError && (error.status === 401 || error.status === 403))
    return { kind: "denied", name, detail, title: "You cannot open this data set", text: `The site refused ${stem} (HTTP ${error.status}). Reloading the page signs you in again; if it still refuses, ask whoever sent the link.` };
  if (error instanceof HttpError)
    return { kind: "error", name, detail, title: "The site could not send this data set", text: `Reading ${stem} failed (HTTP ${error.status}). Try again in a moment.` };
  if (error instanceof TypeError) // fetch: no answer at all (also an expired sign-on, redirected to the login page)
    return { kind: "offline", name, detail, title: "The site did not answer", text: `${stem} could not be read. Check the connection; if your CERN sign-on has expired, reloading the page signs you in again.` };
  if (/not an evd|no trailer|JSON|Unexpected/.test(detail))
    return { kind: "unreadable", name, detail, title: "This file cannot be read", text: `${stem} is not a complete data set for this viewer: it may still be uploading, or was written by something else. Try again in a minute, or convert it again.` };
  return { kind: "error", name, detail, title: "This data set did not open", text: `Opening ${stem} failed. Try again, or choose another data set.` };
}
