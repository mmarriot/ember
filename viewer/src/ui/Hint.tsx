// The line at the bottom left of the view that says how to start. On a first visit it names the keys that matter most
// (click, X, T, D: those this data set has), until it is dismissed, which this browser remembers; then only "Click an
// object to select it · ? help".
import { signal } from "@preact/signals";
import { browserStorage } from "../model/library";
import { bundle, truthColours } from "../model/store";

const KEY = "evd.hint.seen"; // the prefix all of this page's keys share (model/library.ts)
const seen = signal(browserStorage.get(KEY) === "1");

export function Hint() {
  if (seen.value)
    return (
      <div class="hintbar">
        Click an object to select it · <kbd>?</kbd> help
      </div>
    );
  const parts = (bundle.value?.header.domains?.length ?? 0) >= 2,
    truth = truthColours.value;
  return (
    <div class="hintbar first" role="note">
      <span>
        <b>Click an object</b>
        {truth && (
          <>
            {" "}
            · <kbd>X</kbd> its truth · <kbd>T</kbd> truth colours
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
