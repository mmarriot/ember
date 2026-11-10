// Moving the focus between linked objects (e.g. a candidate and its MC-truth particle), with "back".
import { focus, focusHistory, highlight, selection } from "../model/store";
import type { Ref } from "../model/relations";
import { engine } from "./Viewport";

const same = (a: Ref | null, b: Ref) => !!a && a.table === b.table && a.row === b.row;

/** Focus on `ref` (the current focus is kept for back) and glide the camera to it, conservatively. */
export function jump(ref: Ref) {
  const f = focus.peek();
  if (!same(f, ref)) {
    if (f) focusHistory.value = [...focusHistory.peek(), f];
    focus.value = { ...ref };
  }
  selection.value = { ...ref };
  engine?.frame(highlight.peek() ?? undefined, true, 800);
}

/** Back to the previous focus, if any. */
export function back() {
  const h = focusHistory.peek();
  if (!h.length) return;
  const prev = h[h.length - 1];
  focusHistory.value = h.slice(0, -1);
  focus.value = { ...prev };
  selection.value = { ...prev };
  engine?.frame(highlight.peek() ?? undefined, true, 800);
}
