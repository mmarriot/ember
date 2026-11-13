import { beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../io/bundle";
import {
  agoText, cleanLogin, describeFailure, expiryText, forgetLogin, forgetRecent, type Listed, loadIdentity, loadRecent, login, matches, mine, noteRecent,
  ownerOf, pruneRecent, readIndex, recent, recentShown, refreshMine, type Storage, titleOf, typeLogin, userIndex,
} from "./library";

/** A storage in memory, and a server of fixed answers by URL (anything else: 404, as a site answers). */
function memory(initial: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => { data[k] = v; }, remove: (k) => { delete data[k]; } };
}
const server = (answers: Record<string, unknown>) => async (url: string) =>
  url in answers ? new Response(typeof answers[url] === "string" ? (answers[url] as string) : JSON.stringify(answers[url])) : new Response("", { status: 404 });
const offline = async (): Promise<Response> => { throw new TypeError("Failed to fetch"); };
const NOW = new Date("2026-11-13T12:00:00Z"), at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

beforeEach(() => { login.value = null; mine.value = []; recent.value = []; });

describe("whose files", () => {
  it("names the owner of a file in a person's area, and of nothing else", () => {
    expect(ownerOf("data/u/alice/ttbar.evdb")).toBe("alice");
    expect(ownerOf("data/simulation/ttbar.evdb")).toBeNull();
    expect(ownerOf("data/u/alice/deeper/x.evdb")).toBeNull();
    expect(userIndex("alice")).toBe("data/u/alice/index.json");
    expect(titleOf("data/u/alice/ttbar_pu200.evdb")).toBe("ttbar_pu200 · alice");
    expect(titleOf("data/simulation/ttbar.evdb")).toBe("ttbar");
  });

  it("tidies a typed login and refuses what cannot be one", () => {
    expect(cleanLogin("  JSmith ")).toBe("jsmith");
    expect(cleanLogin("jsmith@cern.ch")).toBe("jsmith");
    for (const bad of ["", "a", "john smith", "../etc", "a/b", "1abc", "x".repeat(40)]) expect(cleanLogin(bad)).toBeNull();
  });

  it("takes the site's answer over the login typed before", async () => {
    await loadIdentity(server({ whoami: { login: "alice" } }), memory({ "evd.login": "bob" }));
    expect(login.value).toEqual({ name: "alice", from: "sso" });
  });

  it("falls back on the typed login, silently, when the site has no whoami or answers with something else", async () => {
    for (const fetcher of [server({}), server({ whoami: "<!doctype html><html></html>" }), server({ whoami: { user: "x" } }), server({ whoami: { login: "../x" } }), offline]) {
      login.value = null;
      await loadIdentity(fetcher, memory({ "evd.login": "bob" }));
      expect(login.value).toEqual({ name: "bob", from: "typed" });
      login.value = null;
      await loadIdentity(fetcher, memory());
      expect(login.value).toBeNull();
    }
  });

  it("remembers a typed login until it is forgotten, and leaves the site's alone", () => {
    const storage = memory();
    expect(typeLogin("not a login", storage)).toBe(false);
    expect(typeLogin("Bob", storage)).toBe(true);
    expect([login.value, storage.data["evd.login"]]).toEqual([{ name: "bob", from: "typed" }, "bob"]);
    forgetLogin(storage);
    expect([login.value, storage.data["evd.login"]]).toEqual([null, undefined]);
    login.value = { name: "alice", from: "sso" };
    expect(typeLogin("bob", storage)).toBe(false);
    forgetLogin(storage);
    expect(login.value?.name).toBe("alice");
  });
});

describe("my files", () => {
  const index = { updated: at(0), bundles: [
    { file: "data/u/bob/old.evdb", title: "Old", events: 5, created: at(-20), expires: at(10) },
    { file: "data/u/bob/new.evdb", title: "New", events: 10, created: at(-1), expires: at(29) },
    { title: "no file" },
  ] };

  it("lists a person's index newest first, without entries that are not data sets", async () => {
    expect((await readIndex("bob", server({ "data/u/bob/index.json": index })))!.map((x) => x.title)).toEqual(["New", "Old"]);
  });

  it("is empty for a person without an index, and unknown when it cannot be read", async () => {
    expect(await readIndex("bob", server({}))).toEqual([]);
    expect(await readIndex("bob", offline)).toBeNull();
    expect(await readIndex("bob", server({ "data/u/bob/index.json": "<html>" }))).toBeNull();
  });

  it("keeps what is listed while the index cannot be read, and lists nothing without a login", async () => {
    await refreshMine(server({ "data/u/bob/index.json": index }));
    expect(mine.value).toEqual([]);
    login.value = { name: "bob", from: "typed" };
    await refreshMine(server({ "data/u/bob/index.json": index }));
    expect(mine.value.length).toBe(2);
    await refreshMine(offline);
    expect(mine.value.length).toBe(2);
    await refreshMine(server({})); // every file expired: the index is gone
    expect(mine.value).toEqual([]);
  });
});

describe("recent data sets", () => {
  it("puts the last one opened first, once, and keeps the newest twelve", () => {
    const storage = memory();
    for (let i = 0; i < 14; i++) noteRecent({ file: `data/u/alice/${i}.evdb`, title: `Set ${i}` }, NOW, storage);
    noteRecent({ file: "data/u/alice/5.evdb", title: "Set 5" }, NOW, storage);
    expect(recent.value.length).toBe(12);
    expect(recent.value.slice(0, 2).map((r) => r.title)).toEqual(["Set 5", "Set 13"]);
    expect(recent.value.filter((r) => r.title === "Set 5").length).toBe(1);
    recent.value = [];
    loadRecent(storage); // as the next visit finds them
    expect(recent.value[0]).toEqual({ file: "data/u/alice/5.evdb", title: "Set 5", time: NOW.toISOString() });
    forgetRecent("data/u/alice/5.evdb", storage);
    expect(JSON.parse(storage.data["evd.recent"]).some((r: { title: string }) => r.title === "Set 5")).toBe(false);
  });

  it("starts empty when nothing, or something else, is stored", () => {
    for (const stored of [{}, { "evd.recent": "not json" }, { "evd.recent": '{"a": 1}' }, { "evd.recent": '[{"file": 3}]' }]) {
      recent.value = [{ file: "x", title: "x", time: "" }];
      loadRecent(memory(stored as Record<string, string>));
      expect(recent.value).toEqual([]);
    }
  });

  it("shows only the data sets no other list has: mine and the shared ones have their place", () => {
    const storage = memory();
    noteRecent({ file: "ttbar.evdb", title: "ttbar" }, NOW, storage); // a link to a shared one, opened before the lists were read
    noteRecent({ file: "data/u/alice/x.evdb", title: "Alice's" }, NOW, storage);
    noteRecent({ file: "local.evdb", title: "local.evdb", local: true }, NOW, storage);
    expect(recentShown(recent.value, ["ttbar.evdb", "local.evdb"]).map((r) => r.title)).toEqual(["local.evdb", "Alice's"]);
    pruneRecent(["ttbar.evdb"], storage);
    expect(JSON.parse(storage.data["evd.recent"]).map((r: { title: string }) => r.title)).toEqual(["local.evdb", "Alice's"]);
  });
});

describe("times in words", () => {
  it("says when a file expires", () => {
    expect(expiryText(at(30), NOW)).toBe("expires in 30 days");
    expect(expiryText(at(29.6), NOW)).toBe("expires in 30 days");
    expect(expiryText(at(2.2), NOW)).toBe("expires in 2 days");
    expect(expiryText(at(1.2), NOW)).toBe("expires tomorrow");
    expect(expiryText(at(0.4), NOW)).toBe("expires today");
    expect(expiryText(at(-0.1), NOW)).toBe("expired");
    expect(expiryText(undefined, NOW)).toBe("");
    expect(expiryText("soon", NOW)).toBe("");
  });

  it("says how long ago a data set was opened", () => {
    expect(agoText(at(-0.2), NOW)).toBe("today");
    expect(agoText(at(-1.5), NOW)).toBe("yesterday");
    expect(agoText(at(-6.1), NOW)).toBe("6 days ago");
    expect(agoText(at(-45), NOW)).toBe("2026-09-29");
    expect(agoText(undefined, NOW)).toBe("");
  });
});

describe("the filter", () => {
  const entry: Listed = { file: "data/testbeam/run_112054.evdb", title: "Test beam 2025 · e- 150 GeV" };
  it("wants every word, in the title or the file name, whatever the case", () => {
    expect(matches("beam 150", entry)).toBe(true);
    expect(matches("TEST 112054", entry)).toBe(true);
    expect(matches("beam pion", entry)).toBe(false);
  });
});

describe("a data set that did not open", () => {
  it("is gone when the site has no such file, with its publisher to ask where it was one's own", () => {
    const f = describeFailure("data/u/alice/ttbar.evdb", new HttpError("data/u/alice/ttbar.evdb", 404));
    expect([f.kind, f.title]).toEqual(["gone", "This data set is no longer here"]);
    expect(f.text).toMatch(/published by alice.*Ask alice/);
    expect(describeFailure("data/sim/x.evdb", new HttpError("data/sim/x.evdb", 404)).text).toMatch(/no x\.evdb on this site/);
  });

  it("tells a refusal, a silent site and a file that is not a bundle apart", () => {
    expect(describeFailure("x.evdb", new HttpError("x.evdb", 403)).kind).toBe("denied");
    expect(describeFailure("x.evdb", new HttpError("x.evdb", 500)).kind).toBe("error");
    expect(describeFailure("x.evdb", new TypeError("Failed to fetch")).kind).toBe("offline");
    expect(describeFailure("x.evdb", new Error("not an evd/1 bundle")).kind).toBe("unreadable");
    expect(describeFailure("x.evdb", new Error("bundle has no trailer (incomplete?)")).kind).toBe("unreadable");
    expect(describeFailure("x.evdb", "odd").detail).toBe("odd");
  });
});
