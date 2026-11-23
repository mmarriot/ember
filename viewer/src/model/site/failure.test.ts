import { describe, expect, it } from "vitest";
import { FormatError, HttpError, NetworkError } from "../../io/bundle";
import { describeFailure } from "./failure";
import { NameError } from "./library";

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
