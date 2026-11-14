// What the view shows while no data set is open: the start panel of a site with nothing to open yet (what this is,
// how data gets in), the reason a data set did not open (a link to a file that is gone), or that one is on its way.
// Also the hint shown while a file is dragged over the page.
import { useState } from "preact/hooks";
import logo from "../../logo.svg";
import { DOCS_URL, mine, PUBLISH_COMMAND, titleOf } from "../model/library";
import { bundle, catalogue, openBundle, openFailure, opening, started } from "../model/store";
import { chooserOpen, pickLocalFile } from "./Chooser";

export function Start() {
  const failure = openFailure.value,
    name = opening.value;
  if (bundle.value) return null;
  if (name)
    return (
      <div class="startpanel quiet" role="status">
        <p>Opening {titleOf(name)}…</p>
      </div>
    );
  if (failure) return <Failed />;
  return started.value ? <Welcome /> : null; // not before the lists are read: the first data set may be about to open
}

/** A command to copy: the text, and a button that says it did. */
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  return (
    <span class="command">
      <code>{text}</code>
      <button class="link" onClick={copy} aria-live="polite">
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

const choose = () => {
  chooserOpen.value = true;
};

function Welcome() {
  const some = catalogue.value.bundles.length + mine.value.length > 0;
  return (
    <div class="startpanel">
      <div class="card">
        <h1>
          <img src={logo} alt="" width={36} height={36} />
          Event display
        </h1>
        <p>
          CMS events in the browser: hits, clusters, tracks and physics objects, layer by layer, with what the
          simulation says was really there next to what was reconstructed.
        </p>
        {some ? (
          <p>
            <button class="primary" onClick={choose}>
              Choose a data set
            </button>
          </p>
        ) : (
          <p class="hint">This site has no data sets to show yet. Three ways to see events here:</p>
        )}
        <ol>
          <li>
            <b>Publish a file.</b> In a CMSSW area, one command converts a NanoAOD or step3 file, puts it in your area
            of this site and prints a link to it: <Command text={PUBLISH_COMMAND} />
          </li>
          <li>
            <b>Open a local file.</b> Drop a <code>.evdb</code> file anywhere on this page, or{" "}
            <button class="link" onClick={pickLocalFile}>
              choose one
            </button>
            . It is read where it is and stays on your computer.
          </li>
          <li>
            <b>Follow a link.</b> A link someone copied with the share button opens the same event, selection and view
            for you.
          </li>
        </ol>
        <p>
          <a class="link" href={DOCS_URL} target="_blank" rel="noopener">
            Documentation and a first tutorial ↗
          </a>
        </p>
      </div>
    </div>
  );
}

function Failed() {
  const f = openFailure.value!,
    signOn = !f.external && (f.kind === "denied" || f.kind === "offline");
  // Trying again: a file of this computer cannot be fetched by its name (it is chosen again); a link's data set is
  // opened as the link says (its event and view are still in the address), by loading the page again; one chosen
  // here is simply opened again.
  const linked = new URLSearchParams(location.hash.slice(1) || location.search.slice(1)).get("b") === f.name;
  const again =
    f.local || f.kind === "gone" || f.kind === "badname"
      ? null
      : signOn || linked
        ? () => location.reload()
        : () => void openBundle(f.name);
  return (
    <div class="startpanel">
      <div class="card" role="alert">
        <h1>{f.title}</h1>
        <p>{f.text}</p>
        {f.kind === "gone" && !f.external && (
          <p class="hint">
            One command in a CMSSW area converts a file, publishes it here and prints its link:{" "}
            <Command text={PUBLISH_COMMAND} />
          </p>
        )}
        <p class="buttons">
          <button class="primary" onClick={choose}>
            Choose a data set
          </button>
          {f.local && <button onClick={pickLocalFile}>Choose another file</button>}
          {again && <button onClick={again}>{signOn || linked ? "Reload the page" : "Try again"}</button>}
          <a class="link" href={DOCS_URL} target="_blank" rel="noopener">
            Documentation ↗
          </a>
        </p>
        <p class="detail" title="What the page was told">
          {f.detail}
        </p>
      </div>
    </div>
  );
}

/** Over the whole page while a file is dragged across it. */
export const DropHint = () => (
  <div class="drophint" aria-hidden="true">
    <div>
      Drop the <code>.evdb</code> file to open it<small>It is read from your computer and not uploaded</small>
    </div>
  </div>
);
