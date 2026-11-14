import { beforeEach, describe, expect, it } from "vitest";
import { FormatError, HttpError, NetworkError } from "../io/bundle";
import {
  agoText,
  cleanList,
  cleanLogin,
  describeFailure,
  expiryText,
  forgetLogin,
  forgetRecent,
  type Listed,
  loadIdentity,
  loadRecent,
  locate,
  login,
  matches,
  mine,
  mineUnread,
  NameError,
  noteRecent,
  ownerOf,
  pruneRecent,
  readIndex,
  recent,
  recentShown,
  refreshMine,
  siteFile,
  type Storage,
  titleOf,
  typeLogin,
  userIndex,
} from "./library";

/** A storage in memory, and a server of fixed answers by URL (anything else: 404, as a site answers). */
function memory(initial: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: (k) => data[k] ?? null,
    set: (k, v) => {
      data[k] = v;
    },
    remove: (k) => {
      delete data[k];
    },
  };
}
const server = (answers: Record<string, unknown>) => async (url: string) =>
  url in answers
    ? new Response(typeof answers[url] === "string" ? (answers[url] as string) : JSON.stringify(answers[url]))
    : new Response("", { status: 404 });
const offline = async (): Promise<Response> => {
  throw new TypeError("Failed to fetch");
};
const NOW = new Date("2026-11-13T12:00:00Z"),
  at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

beforeEach(() => {
  login.value = null;
  mine.value = [];
  mineUnread.value = false;
  recent.value = [];
});

describe("a name from a link or an index", () => {
  it("is a file of this site only as a plain relative path", () => {
    for (const ok of ["ttbar.evdb", "data/sim/ttbar_0PU.evdb", "data/u/alice/my file (2).evdb", "index.json"])
      expect(siteFile(ok)).toBe(ok);
    for (const bad of [
      "",
      "/data/x.evdb",
      "//elsewhere.example/x.evdb",
      "data//x.evdb",
      "data/./x.evdb",
      "data/u/../x.evdb",
      "..",
      "data\\x.evdb",
      "data/u/alice/..\\tester\\x.evdb",
      "data/x.evdb?x=1",
      "data/x.evdb#top",
      "data/%2e%2e/x.evdb",
      "https://elsewhere.example/x.evdb",
      "javascript:alert(1)",
      "data:text/plain,x",
      "data/x\n.evdb",
    ])
      expect(siteFile(bad)).toBeNull();
  });

  it("leads to this site, to an address elsewhere, or nowhere", () => {
    const base = "https://evd.example/site/index.html";
    expect(locate("data/u/alice/x.evdb", base)).toEqual({ kind: "site", file: "data/u/alice/x.evdb" });
    expect(locate("https://elsewhere.example/a/x.evdb?sig=1", base)).toEqual({
      kind: "external",
      url: "https://elsewhere.example/a/x.evdb?sig=1",
    });
    // This site, spelt in full.
    expect(locate("https://evd.example/site/data/u/alice/x.evdb", base)).toEqual({
      kind: "site",
      file: "data/u/alice/x.evdb",
    });
    expect(locate("https://evd.example/other/x.evdb", base).kind).toBe("external");
    expect(locate("https://evd.example/site/data/x.evdb?x=1", base).kind).toBe("external");
    for (const bad of [
      "data/u/../x.evdb",
      "/etc/passwd",
      "//elsewhere.example/x.evdb",
      "ftp://elsewhere.example/x.evdb",
      "javascript:alert(1)",
      "https://user:pw@elsewhere.example/x.evdb",
      "https://",
      "data\\x.evdb",
    ])
      expect(locate(bad, base)).toEqual({ kind: "bad" });
  });

  it("is titled by its file, and by where it is when that is not this site's shared list", () => {
    expect(titleOf("https://elsewhere.example/a/x.evdb?sig=1")).toBe("x · elsewhere.example");
  });
});

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
    for (const bad of ["", "a", "john smith", "../etc", "a/b", "1abc", "x".repeat(40)])
      expect(cleanLogin(bad)).toBeNull();
  });

  it("takes the site's answer over the login typed before", async () => {
    await loadIdentity(server({ whoami: { login: "alice" } }), memory({ "evd.login": "bob" }));
    expect(login.value).toEqual({ name: "alice", from: "sso" });
  });

  it("falls back on the typed login, silently, when the site has no whoami or answers with something else", async () => {
    const odd = [
      { user: "x" },
      { login: "../x" },
      { login: ["alice"] },
      { login: { toString: 1 } },
      { login: 7 },
      null,
      [],
      "alice",
    ];
    for (const fetcher of [
      server({}),
      server({ whoami: "<!doctype html><html></html>" }),
      ...odd.map((whoami) => server({ whoami: JSON.stringify(whoami) })),
      offline,
    ]) {
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
  const index = {
    updated: at(0),
    bundles: [
      { file: "data/u/bob/old.evdb", title: "Old", events: 5, created: at(-20), expires: at(10) },
      { file: "data/u/bob/new.evdb", title: "New", events: 10, created: at(-1), expires: at(29) },
      { title: "no file" },
    ],
  };

  it("lists a person's index newest first, without entries that are not data sets", async () => {
    expect((await readIndex("bob", server({ "data/u/bob/index.json": index })))!.map((x) => x.title)).toEqual([
      "New",
      "Old",
    ]);
  });

  it("orders by when a file was published, where the index says, not by when it was converted", async () => {
    const republished = {
      bundles: [
        { file: "data/u/bob/a.evdb", title: "Converted last, published first", created: at(-1), published: at(-9) },
        { file: "data/u/bob/b.evdb", title: "Converted long ago, published today", created: at(-40), published: at(0) },
        { file: "data/u/bob/c.evdb", title: "No publication time", created: at(-3) },
      ],
    };
    expect(
      (await readIndex("bob", server({ "data/u/bob/index.json": republished })))!.map((x) => x.file.slice(-6, -5)),
    ).toEqual(["b", "c", "a"]);
  });

  it("says when my list could not be read, and stops saying so once it is", async () => {
    login.value = { name: "bob", from: "typed" };
    await refreshMine(offline);
    expect([mine.value, mineUnread.value]).toEqual([[], true]);
    await refreshMine(server({ "data/u/bob/index.json": index }));
    expect([mine.value.length, mineUnread.value]).toEqual([2, false]);
    const before = mine.value;
    await refreshMine(server({ "data/u/bob/index.json": index })); // the same list again: not a new one for those who watch it
    expect(mine.value).toBe(before);
  });

  it("keeps the well-formed entries of the site's own list, whoever's area they are in", () => {
    const list = cleanList([
      { file: "data/sim/a.evdb", title: "A", events: "12", campaign: 3 },
      { file: "https://elsewhere.example/b.evdb", title: "B" },
      { file: "c.evdb" },
      5,
    ])!;
    expect(list).toEqual([{ file: "data/sim/a.evdb", title: "A" }]);
    expect(cleanList({ not: "a list" })).toBeNull();
  });

  it("is empty for a person without an index, and unknown when it cannot be read", async () => {
    expect(await readIndex("bob", server({}))).toEqual([]);
    expect(await readIndex("bob", offline)).toBeNull();
    expect(await readIndex("bob", server({ "data/u/bob/index.json": "<html>" }))).toBeNull();
  });

  // Review, finding 4: an index is somebody's file, not trusted.
  it("keeps only the person's own, well-formed entries of an index", async () => {
    const odd = {
      bundles: [
        { file: "data/u/bob/ok.evdb", title: "Fine", events: null, created: at(-1) },
        { file: "data/u/alice/theirs.evdb", title: "Someone else's" },
        { file: "https://elsewhere.example/x.evdb", title: "Elsewhere" },
        { file: "data/u/bob/../../index.evdb", title: "Climbing" },
        { file: "data/u/bob/n.evdb", title: 7 },
        null,
        "text",
      ],
    };
    const list = (await readIndex("bob", server({ "data/u/bob/index.json": odd })))!;
    expect(list.map((x) => x.file)).toEqual(["data/u/bob/ok.evdb"]);
    expect(list[0].events).toBeUndefined();
  });

  // Review, finding 2: whose file a name says it is.
  it("names no owner for a name that is not exactly a file in a person's area", () => {
    for (const name of [
      "data/u/alice/..\\tester\\cosmics.evdb",
      "data/u/../x.evdb",
      "data/u/Alice/x.evdb",
      "data/u/alice/x.evdb?x=1",
      "https://elsewhere.example/data/u/alice/x.evdb",
    ])
      expect(ownerOf(name)).toBeNull();
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

  it("remembers only files of this site and local files", () => {
    const storage = memory();
    for (const file of ["https://elsewhere.example/x.evdb", "data/u/alice/x.evdb?x=1", "data/u/../x.evdb"])
      noteRecent({ file, title: "x" }, NOW, storage);
    expect(recent.value).toEqual([]);
    const stored = [
      { file: "https://elsewhere.example/x.evdb", title: "Elsewhere", time: at(0) },
      { file: "data/u/alice/x.evdb", title: "Alice's", time: at(0) },
      { file: "any name?.evdb", title: "Dropped", time: at(0), local: true },
    ];
    loadRecent(memory({ "evd.recent": JSON.stringify(stored) })); // as an older version, or someone else, may have stored
    expect(recent.value.map((r) => r.title)).toEqual(["Alice's", "Dropped"]);
  });

  it("adds to what another tab stored since this one read it, and forgets from it", () => {
    const storage = memory();
    noteRecent({ file: "data/u/alice/here.evdb", title: "Opened here" }, NOW, storage);
    const other = [
      { file: "data/u/carol/there.evdb", title: "Opened in another tab", time: at(0) },
      ...JSON.parse(storage.data["evd.recent"]),
    ];
    storage.data["evd.recent"] = JSON.stringify(other); // the other tab's write; this tab's signal has not seen it
    noteRecent({ file: "data/u/dave/third.evdb", title: "Third" }, NOW, storage);
    expect(recent.value.map((r) => r.title)).toEqual(["Third", "Opened in another tab", "Opened here"]);
    storage.data["evd.recent"] = JSON.stringify([
      { file: "data/u/erin/e.evdb", title: "Erin's", time: at(0) },
      ...JSON.parse(storage.data["evd.recent"]),
    ]);
    forgetRecent("data/u/alice/here.evdb", storage);
    expect(JSON.parse(storage.data["evd.recent"]).map((r: { title: string }) => r.title)).toEqual([
      "Erin's",
      "Third",
      "Opened in another tab",
    ]);
  });

  it("starts empty when nothing, or something else, is stored", () => {
    for (const stored of [
      {},
      { "evd.recent": "not json" },
      { "evd.recent": '{"a": 1}' },
      { "evd.recent": '[{"file": 3}]' },
    ]) {
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
    expect(recentShown(recent.value, ["ttbar.evdb", "local.evdb"]).map((r) => r.title)).toEqual([
      "local.evdb",
      "Alice's",
    ]);
    pruneRecent(["ttbar.evdb"], storage);
    expect(JSON.parse(storage.data["evd.recent"]).map((r: { title: string }) => r.title)).toEqual([
      "local.evdb",
      "Alice's",
    ]);
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
    expect(describeFailure("data/sim/x.evdb", new HttpError("data/sim/x.evdb", 404)).text).toMatch(
      /no x\.evdb on this site/,
    );
  });

  it("tells a refusal, a silent site and a file that is not a bundle apart, by the kind of error and not its words", () => {
    expect(describeFailure("x.evdb", new HttpError("x.evdb", 403)).kind).toBe("denied");
    expect(describeFailure("x.evdb", new HttpError("x.evdb", 500)).kind).toBe("error");
    expect(describeFailure("x.evdb", new NetworkError("x.evdb", new TypeError("Failed to fetch"))).kind).toBe(
      "offline",
    );
    expect(describeFailure("x.evdb", new FormatError("anything")).kind).toBe("unreadable");
    expect(describeFailure("x.evdb", new TypeError("Cannot read properties of undefined")).kind).toBe("error"); // a bug is not "the site did not answer"
    expect(describeFailure("x.evdb", new Error("the JSON said Unexpected things")).kind).toBe("error");
    expect(describeFailure("x.evdb", "odd").detail).toBe("odd");
  });

  it("does not name a publisher, or anything else, from the look of a name that is not a site file", () => {
    const f = describeFailure("data/u/alice/..\\tester\\x.evdb", new NameError("data/u/alice/..\\tester\\x.evdb"));
    expect([f.kind, f.title]).toEqual(["badname", "This link does not name a data set"]);
    expect(f.text).not.toMatch(/alice|tester/);
  });

  it("speaks of the address, not of this site, for a data set kept elsewhere", () => {
    const url = "https://elsewhere.example/data/u/alice/x.evdb";
    const gone = describeFailure(url, new HttpError(url, 404)),
      silent = describeFailure(url, new NetworkError(url, new TypeError("Failed to fetch")));
    expect([gone.external, gone.title]).toEqual([true, "There is no such file at that address"]);
    expect(gone.text).not.toMatch(/published by/);
    expect(silent.text).toMatch(/does not let pages of other sites read it/);
    expect(silent.text).not.toMatch(/sign-on/);
  });

  it("says of a local file what to do with the file, and offers nothing to fetch", () => {
    const f = describeFailure("notes.evdb", new FormatError("not an evd/1 bundle"), true);
    expect([f.kind, f.local, f.external]).toEqual(["unreadable", true, false]);
    expect(f.text).toBe("notes.evdb is not an .evdb bundle, or it is incomplete: convert it again.");
    expect(describeFailure("data/u/alice/x.evdb", new Error("disk"), true).text).not.toMatch(/alice.*publish/);
  });
});
