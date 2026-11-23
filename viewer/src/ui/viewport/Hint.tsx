// The line at the bottom left of the view: on a first visit the keys that matter most (those this data set has),
// until dismissed (remembered in this browser); then only "Click an object to select it · ? help".
import { signal } from "@preact/signals";
import { browserStorage } from "../../model/site/library";
import { bundle, truthColours } from "../../model/store";
import { hasDomainBar } from "./ViewControls";

const KEY = "evd.hint.seen"; // the prefix all of this page's keys share (model/site/library.ts)
const seen = signal(browserStorage.get(KEY) === "1");

export function Hint() {
  if (seen.value)
    return (
      <div class="hintbar">
        Click an object to select it · <kbd>?</kbd> help
      </div>
    );
  const parts = hasDomainBar(bundle.value?.header),
    truth = truthColours.value;
  return (
    <div class="hintbar first" role="note">
      <span>
        <b>Click an object</b>
        {truth && (
          <>
            {" "}
            · <kbd>X</kbd> its truth and back · <kbd>T</kbd> truth colours
          </>
        )}
        {parts && (
          <>
            {" "}
            · <kbd>D</kbd> detector parts
          </>
        )}{" "}
        · <kbd>?</kbd> help
      </span>
      <button
        class="link"
        title="Hide these hints (remembered in this browser)"
        onClick={() => {
          seen.value = true;
          browserStorage.set(KEY, "1");
        }}
      >
        Got it
      </button>
    </div>
  );
}
