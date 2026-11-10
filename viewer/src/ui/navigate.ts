// Moving the focus between objects from lists and links (e.g. a candidate and its MC-truth particle), with "back";
// the camera glides to the new focus, conservatively.
import { focusBack, focusOn, highlight, selection } from "../model/store";
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
