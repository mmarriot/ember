// The view's top-left corner: what is on screen, in words that stay in a screenshot. The event ("SIMULATION · ttbar
// 0PU · Run 1 · LS 1 · Event 18"), the physics objects in one line under it (as the Physics section's), and, while one
// kind is looked at alone, that kind with the way back to everything.
import { eventTitle, isSimulation } from "../model/about";
import { sharedDomains } from "../model/domains";
import { bundle, lookAlone, opened, shownEntry, solo } from "../model/store";
import { Headline } from "./ObjectRows";

/** The event shown in one line, or "" before one is (also the caption of a saved picture, ui/Picture.tsx). */
export function shownTitle(): string {
  const b = bundle.value,
    e = shownEntry.value;
  return b && e ? eventTitle(isSimulation(b.header, e.run), opened.value?.title ?? "", e) : "";
}

/** The layers the one-line summary counts: the shared parts' (the physics objects), else every reco layer. A side-panel
 *  tab of these alone does not count them again (Layers.tsx). */
export function summaryLayers() {
  const display = bundle.value?.header.display ?? [],
    shared = sharedDomains(bundle.value?.header);
  return display.filter((d) => !d.truth && (!shared.size || (d.domain !== undefined && shared.has(d.domain))));
}

export function TitleBox() {
  const title = shownTitle();
  if (!title) return null;
  const [kind, ...rest] = title.split(" · ");
  return (
    <div class="titlebox">
      <div class="title">
        <b class={kind === "DATA" ? "badge data" : "badge sim"}>{kind}</b> {rest.join(" · ")}
      </div>
      <Headline layers={summaryLayers()} />
      {solo.value && (
        <div class="solobar" role="status">
          Only <b>{solo.value.split("|").filter(Boolean).reverse().join(" · ")}</b>{" "}
          <button class="link" title="Draw everything ticked again" onClick={() => lookAlone(null)}>
            show everything
          </button>
        </div>
      )}
    </div>
  );
}
