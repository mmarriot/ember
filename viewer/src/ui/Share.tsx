// The share button's pop-up (Header.tsx): it copies the link to this view and says what the link opens, or why a
// local file has none.
import { signal } from "@preact/signals";
import { DOCS_URL, expiryText, ownerOf, PUBLISH_COMMAND } from "../model/library";
import {
  activeMode,
  bundle,
  domain,
  eventIndex,
  nameOf,
  opened,
  selection,
  shownEntry,
  shownLevel,
  solo,
  toast,
  view,
} from "../model/store";
import { togglePopover } from "./Info";
import { VIEWS } from "./Viewport";

/** Whether the link of the open share pop-up reached the clipboard ("": not known yet). */
const copied = signal<"" | "yes" | "no">("");

/** The share button: copy the link to this view, and say what it is a link to (or why a local file has none). The
 *  pop-up describes the link it holds: both are taken at the click, so it stays true to its link if the view moves on
 *  while it is open. */
export function share(e: Event) {
  const o = opened.peek(),
    link = location.href;
  if (!o) return toast("Open a data set first: the link is to what is on screen");
  copied.value = "";
  const snapshot = {
    link,
    opens: captured(),
    owner: ownerOf(o.file),
    expiry: expiryText(o.entry?.expires),
    external: o.external,
  };
  togglePopover(
    e,
    () => (o.local ? <NoLink name={o.title} /> : <ShareLink {...snapshot} />),
    o.local ? "A local file has no link" : "Link to this view",
  );
  if (o.local) return;
  const failed = () => (copied.value = "no"); // no clipboard here (not a secure page, or not allowed): the link is there to copy
  if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => (copied.value = "yes"), failed);
  else failed();
}

/** What the link opens, in the reader's words: each part of the view that the address keeps. */
function captured(): string[] {
  const b = bundle.peek(),
    o = opened.peek(),
    e = shownEntry.peek(),
    s = selection.peek();
  if (!b || !o || !e) return o ? [o.title] : [];
  const parts = (b.header.domains?.length ?? 0) >= 2,
    level = shownLevel.peek();
  return [
    o.title,
    `event ${eventIndex.peek() + 1} of ${b.events.length} (run ${e.run}, event ${e.event})`,
    parts ? (domain.peek() ? `the ${domain.peek()} part of the detector` : "every part of the detector") : "",
    `the ${VIEWS.find(([v]) => v === view.peek())?.[1] ?? view.peek()} view`,
    solo.peek() ? `only the ${solo.peek()!.split("|").filter(Boolean).reverse().join(" · ")}` : "",
    s ? `the selected ${nameOf(s)}${level ? `, down to its ${level}` : ""}` : "",
    activeMode.peek() === "truth" ? "truth colours" : "",
  ].filter(Boolean);
}

/** The pop-up for a data set on a site: the link (copied, or to copy by hand), what it opens, and how long it works. */
function ShareLink({
  link,
  opens,
  owner,
  expiry,
  external,
}: {
  link: string;
  opens: string[];
  owner: string | null;
  expiry: string;
  external: boolean;
}) {
  return (
    <div class="sharepop">
      <input
        readOnly
        value={link}
        aria-label="Link to this view"
        onFocus={(e) => (e.target as HTMLInputElement).select()}
        onClick={(e) => (e.target as HTMLInputElement).select()}
      />
      <p class={copied.value === "yes" ? "status ok" : "status"} role="status">
        {copied.value === "yes"
          ? "✓ Copied: paste it anywhere"
          : copied.value === "no"
            ? "Select it and copy (Ctrl+C): this page may not use the clipboard"
            : " "}
      </p>
      <p>
        {external
          ? "It opens, for whoever can open this site and can also reach the data set's own address:"
          : "It opens, for anyone who can open this site:"}
      </p>
      <ul>
        {opens.map((c) => (
          <li>{c}</li>
        ))}
      </ul>
      <p class="hint">
        Cuts, ticked collections and the camera are not part of it.
        {external &&
          " The data set is not on this site: it is read from the address in the link, for as long as that address serves it."}
        {owner && ` The link works while ${owner}'s file is on the site${expiry ? ` (it ${expiry})` : ""}.`}
      </p>
    </div>
  );
}

/** The pop-up for a local file: why it has no link, and how to get one. */
const NoLink = ({ name }: { name: string }) => (
  <div class="sharepop">
    <p>
      <b>{name}</b> is read from your computer: a link to it would open nothing for anyone else.
    </p>
    <p>
      To share it, send the file itself; or, where this site is set up for it (<code>EMBER_SITE_DIR</code>), publish the
      file it was converted from: <code>{PUBLISH_COMMAND}</code> then puts it on this site and prints a link.
    </p>
    <p>
      <a class="link" href={DOCS_URL} target="_blank" rel="noopener">
        How to publish ↗
      </a>
    </p>
  </div>
);
