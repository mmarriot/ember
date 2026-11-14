import { beforeEach, describe, expect, it } from "vitest";
import { FormatError, HttpError, NetworkError } from "../io/bundle";
import {
  agoText,
  BUNDLE_EXTENSIONS,
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
    for (const ok of ["ttbar.ember", "data/sim/ttbar_0PU.ember", "data/u/alice/my file (2).ember", "index.json"])
      expect(siteFile(ok)).toBe(ok);
    for (const bad of [
      "",
      "/data/x.ember",
      "//elsewhere.example/x.ember",
      "data//x.ember",
      "data/./x.ember",
      "data/u/../x.ember",
      "..",
      "data\\x.ember",
      "data/u/alice/..\\tester\\x.ember",
      "data/x.ember?x=1",
      "data/x.ember#top",
      "data/%2e%2e/x.ember",
      "https://elsewhere.example/x.ember",
      "javascript:alert(1)",
      "data:text/plain,x",
      "data/x\n.ember",
    ])
      expect(siteFile(bad)).toBeNull();
  });

  it("leads to this site, to an address elsewhere, or nowhere", () => {
    const base = "https://ember.example/site/index.html";
    expect(locate("data/u/alice/x.ember", base)).toEqual({ kind: "site", file: "data/u/alice/x.ember" });
    expect(locate("https://elsewhere.example/a/x.ember?sig=1", base)).toEqual({
      kind: "external",
      url: "https://elsewhere.example/a/x.ember?sig=1",
    });
    expect(locate("https://ember.example/site/data/u/alice/x.ember", base)).toEqual({
      kind: "site",
      file: "data/u/alice/x.ember",
    }); // this site, spelt in full
    expect(locate("https://ember.example/other/x.ember", base).kind).toBe("external");
    expect(locate("https://ember.example/site/data/x.ember?x=1", base).kind).toBe("external");
    for (const bad of [
      "data/u/../x.ember",
      "/etc/passwd",
      "//elsewhere.example/x.ember",
      "ftp://elsewhere.example/x.ember",
      "javascript:alert(1)",
      "https://user:pw@elsewhere.example/x.ember",
      "https://",
      "data\\x.ember",
    ])
      expect(locate(bad, base)).toEqual({ kind: "bad" });
  });

  it("is titled by its file, and by where it is when that is not this site's shared list", () => {
    expect(titleOf("https://elsewhere.example/a/x.ember?sig=1")).toBe("x · elsewhere.example");
  });
});

describe("whose files", () => {
  it("names the owner of a file in a person's area, and of nothing else", () => {
    expect(ownerOf("data/u/alice/ttbar.ember")).toBe("alice");
    expect(ownerOf("data/simulation/ttbar.ember")).toBeNull();
    expect(ownerOf("data/u/alice/deeper/x.ember")).toBeNull();
    expect(userIndex("alice")).toBe("data/u/alice/index.json");
    expect(titleOf("data/u/alice/ttbar_pu200.ember")).toBe("ttbar_pu200 · alice");
    expect(titleOf("data/simulation/ttbar.ember")).toBe("ttbar");
  });

  it("takes files named .evdb, from before the project was called Ember, as bundles too", () => {
    expect(BUNDLE_EXTENSIONS).toEqual([".ember", ".evdb"]); // what the file chooser offers
    expect(ownerOf("data/u/alice/ttbar.evdb")).toBe("alice");
    expect(titleOf("data/u/alice/ttbar_pu200.evdb")).toBe("ttbar_pu200 · alice");
    expect(titleOf("https://elsewhere.example/a/x.evdb?sig=1")).toBe("x · elsewhere.example");
    expect(titleOf("data/simulation/ttbar.root")).toBe("ttbar.root"); // only a bundle's extension is dropped
    expect(locate("data/u/alice/old.evdb")).toEqual({ kind: "site", file: "data/u/alice/old.evdb" });
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
      { file: "data/u/bob/old.ember", title: "Old", events: 5, created: at(-20), expires: at(10) },
      { file: "data/u/bob/new.ember", title: "New", events: 10, created: at(-1), expires: at(29) },
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
        { file: "data/u/bob/a.ember", title: "Converted last, published first", created: at(-1), published: at(-9) },
        {
          file: "data/u/bob/b.ember",
          title: "Converted long ago, published today",
          created: at(-40),
          published: at(0),
        },
        { file: "data/u/bob/c.ember", title: "No publication time", created: at(-3) },
      ],
    };
    expect(
      (await readIndex("bob", server({ "data/u/bob/index.json": republished })))!.map((x) => x.file.slice(-7, -6)),
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
      { file: "data/sim/a.ember", title: "A", events: "12", campaign: 3 },
      { file: "https://elsewhere.example/b.ember", title: "B" },
      { file: "c.ember" },
      5,
    ])!;
    expect(list).toEqual([{ file: "data/sim/a.ember", title: "A" }]);
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
        { file: "data/u/bob/ok.ember", title: "Fine", events: null, created: at(-1) },
        { file: "data/u/alice/theirs.ember", title: "Someone else's" },
        { file: "https://elsewhere.example/x.ember", title: "Elsewhere" },
        { file: "data/u/bob/../../index.ember", title: "Climbing" },
        { file: "data/u/bob/n.ember", title: 7 },
        null,
        "text",
      ],
    };
    const list = (await readIndex("bob", server({ "data/u/bob/index.json": odd })))!;
    expect(list.map((x) => x.file)).toEqual(["data/u/bob/ok.ember"]);
    expect(list[0].events).toBeUndefined();
  });

  // Review, finding 2: whose file a name says it is.
  it("names no owner for a name that is not exactly a file in a person's area", () => {
    for (const name of [
      "data/u/alice/..\\tester\\cosmics.ember",
      "data/u/../x.ember",
      "data/u/Alice/x.ember",
      "data/u/alice/x.ember?x=1",
      "https://elsewhere.example/data/u/alice/x.ember",
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
    for (let i = 0; i < 14; i++) noteRecent({ file: `data/u/alice/${i}.ember`, title: `Set ${i}` }, NOW, storage);
    noteRecent({ file: "data/u/alice/5.ember", title: "Set 5" }, NOW, storage);
    expect(recent.value.length).toBe(12);
    expect(recent.value.slice(0, 2).map((r) => r.title)).toEqual(["Set 5", "Set 13"]);
    expect(recent.value.filter((r) => r.title === "Set 5").length).toBe(1);
    recent.value = [];
    loadRecent(storage); // as the next visit finds them
    expect(recent.value[0]).toEqual({ file: "data/u/alice/5.ember", title: "Set 5", time: NOW.toISOString() });
    forgetRecent("data/u/alice/5.ember", storage);
    expect(JSON.parse(storage.data["evd.recent"]).some((r: { title: string }) => r.title === "Set 5")).toBe(false);
  });

  it("remembers only files of this site and local files", () => {
    const storage = memory();
    for (const file of ["https://elsewhere.example/x.ember", "data/u/alice/x.ember?x=1", "data/u/../x.ember"])
      noteRecent({ file, title: "x" }, NOW, storage);
    expect(recent.value).toEqual([]);
    const stored = [
      { file: "https://elsewhere.example/x.ember", title: "Elsewhere", time: at(0) },
      { file: "data/u/alice/x.ember", title: "Alice's", time: at(0) },
      { file: "any name?.ember", title: "Dropped", time: at(0), local: true },
    ];
    loadRecent(memory({ "evd.recent": JSON.stringify(stored) })); // as an older version, or someone else, may have stored
    expect(recent.value.map((r) => r.title)).toEqual(["Alice's", "Dropped"]);
  });

  it("adds to what another tab stored since this one read it, and forgets from it", () => {
    const storage = memory();
    noteRecent({ file: "data/u/alice/here.ember", title: "Opened here" }, NOW, storage);
    const other = [
      { file: "data/u/carol/there.ember", title: "Opened in another tab", time: at(0) },
      ...JSON.parse(storage.data["evd.recent"]),
    ];
    storage.data["evd.recent"] = JSON.stringify(other); // the other tab's write; this tab's signal has not seen it
    noteRecent({ file: "data/u/dave/third.ember", title: "Third" }, NOW, storage);
    expect(recent.value.map((r) => r.title)).toEqual(["Third", "Opened in another tab", "Opened here"]);
    storage.data["evd.recent"] = JSON.stringify([
      { file: "data/u/erin/e.ember", title: "Erin's", time: at(0) },
      ...JSON.parse(storage.data["evd.recent"]),
    ]);
    forgetRecent("data/u/alice/here.ember", storage);
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
    noteRecent({ file: "ttbar.ember", title: "ttbar" }, NOW, storage); // a link to a shared one, opened before the lists were read
    noteRecent({ file: "data/u/alice/x.ember", title: "Alice's" }, NOW, storage);
    noteRecent({ file: "local.ember", title: "local.ember", local: true }, NOW, storage);
    expect(recentShown(recent.value, ["ttbar.ember", "local.ember"]).map((r) => r.title)).toEqual([
      "local.ember",
      "Alice's",
    ]);
    pruneRecent(["ttbar.ember"], storage);
    expect(JSON.parse(storage.data["evd.recent"]).map((r: { title: string }) => r.title)).toEqual([
      "local.ember",
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
  const entry: Listed = { file: "data/testbeam/run_112054.ember", title: "Test beam 2025 · e- 150 GeV" };
  it("wants every word, in the title or the file name, whatever the case", () => {
    expect(matches("beam 150", entry)).toBe(true);
    expect(matches("TEST 112054", entry)).toBe(true);
    expect(matches("beam pion", entry)).toBe(false);
  });
});

describe("a data set that did not open", () => {
  it("is gone when the site has no such file, with its publisher to ask where it was one's own", () => {
    const f = describeFailure("data/u/alice/ttbar.ember", new HttpError("data/u/alice/ttbar.ember", 404));
    expect([f.kind, f.title]).toEqual(["gone", "This data set is no longer here"]);
    expect(f.text).toMatch(/published by alice.*Ask alice/);
    expect(describeFailure("data/sim/x.ember", new HttpError("data/sim/x.ember", 404)).text).toMatch(
      /no x\.ember on this site/,
    );
  });

  it("tells a refusal, a silent site and a file that is not a bundle apart, by the kind of error and not its words", () => {
    expect(describeFailure("x.ember", new HttpError("x.ember", 403)).kind).toBe("denied");
    expect(describeFailure("x.ember", new HttpError("x.ember", 500)).kind).toBe("error");
    expect(describeFailure("x.ember", new NetworkError("x.ember", new TypeError("Failed to fetch"))).kind).toBe(
      "offline",
    );
    expect(describeFailure("x.ember", new FormatError("anything")).kind).toBe("unreadable");
    expect(describeFailure("x.ember", new TypeError("Cannot read properties of undefined")).kind).toBe("error"); // a bug is not "the site did not answer"
    expect(describeFailure("x.ember", new Error("the JSON said Unexpected things")).kind).toBe("error");
    expect(describeFailure("x.ember", "odd").detail).toBe("odd");
  });

  it("does not name a publisher, or anything else, from the look of a name that is not a site file", () => {
    const f = describeFailure("data/u/alice/..\\tester\\x.ember", new NameError("data/u/alice/..\\tester\\x.ember"));
    expect([f.kind, f.title]).toEqual(["badname", "This link does not name a data set"]);
    expect(f.text).not.toMatch(/alice|tester/);
  });

  it("speaks of the address, not of this site, for a data set kept elsewhere", () => {
    const url = "https://elsewhere.example/data/u/alice/x.ember";
    const gone = describeFailure(url, new HttpError(url, 404)),
      silent = describeFailure(url, new NetworkError(url, new TypeError("Failed to fetch")));
    expect([gone.external, gone.title]).toEqual([true, "There is no such file at that address"]);
    expect(gone.text).not.toMatch(/published by/);
    expect(silent.text).toMatch(/does not let pages of other sites read it/);
    expect(silent.text).not.toMatch(/sign-on/);
  });

  it("says of a local file what to do with the file, and offers nothing to fetch", () => {
    const f = describeFailure("notes.ember", new FormatError("not an Ember bundle of format version 1"), true);
    expect([f.kind, f.local, f.external]).toEqual(["unreadable", true, false]);
    expect(f.text).toBe("notes.ember is not an Ember bundle, or it is incomplete: convert it again.");
    expect(describeFailure("data/u/alice/x.ember", new Error("disk"), true).text).not.toMatch(/alice.*publish/);
  });
});
