// Why a data set did not open, in words for the person who followed a link to it.
import { FormatError, HttpError, NetworkError } from "../../io/bundle";
import { locate, NameError, ownerOf } from "./library";

/** The server has no such file. */
export const isMissing = (e: unknown) => e instanceof HttpError && (e.status === 404 || e.status === 410);

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
          `${name} is not an Ember bundle, or it is incomplete: convert it again.`,
        )
      : say(
          "error",
          "This file could not be read",
          `${name} could not be read from your computer. Choose it again, or convert it again.`,
        );
  }
  if (isMissing(error)) {
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
