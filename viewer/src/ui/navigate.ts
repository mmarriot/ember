// Moving the focus between objects from lists and links (e.g. a candidate and its truth-graph particle), with "back";
// the camera glides to the new focus, conservatively. Moving between the parts of the detector (domains).
import { bundle, domain, focusBack, focusOn, highlight, openTab, selection, view } from "../model/store";
import type { Ref } from "../model/relations";
import { engine } from "./Viewport";

export function jump(ref: Ref) {
  focusOn(ref);
  selection.value = { ...ref };
  engine?.frame(highlight.peek() ?? undefined, true, 800);
}

export function back() {
  const prev = focusBack();
  if (!prev) return;
  selection.value = { ...prev };
  engine?.frame(highlight.peek() ?? undefined, true, 800);
}

/** Look at one domain (header `domains`): only its layers and those without a domain are drawn, in its view and colour
 *  mode (store.ts activeMode), framed on its region; null: everything, in the bundle's starting view and colour mode,
 *  framed on the objects. `animate`: glide there. */
export function chooseDomain(name: string | null, animate = true) {
  const h = bundle.peek()?.header, d = h?.domains?.find((x) => x.name === name);
  if (!h || (name && !d)) return;
  domain.value = d ? d.name : null;
  if (d) openTab.value = { name: d.name }; // its tab in the side panel (choosing a tab does not change the view)
  view.value = d?.view ?? h.view?.start ?? "3d";
  if (d) engine?.frameRegion(d.region.rMax, d.region.zMax, animate);
  else engine?.frame(undefined, animate);
}

/** The next domain after the current one, then all (keyboard: D). */
export function nextDomain() {
  const names = bundle.peek()?.header.domains?.map((d) => d.name) ?? [];
  if (names.length < 2) return;
  const i = domain.peek() ? names.indexOf(domain.peek()!) : -1;
  chooseDomain(i + 1 < names.length ? names[i + 1] : null);
}
