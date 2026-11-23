// Where the view's labels go (ui/viewport/Labels.tsx): pure geometry in px, so it is tested without a page.

/** What a label is on: the selection, the focus, the object pointed at in the side panel, a leading object. */
export type Kind = "selected" | "focus" | "hover" | "lead";

/** Which labels win a place first: the selection, then the focus, then the object pointed at in the side panel, then
 *  the leading objects in their order (largest first). */
const PRIORITY: Record<Kind, number> = { selected: 0, focus: 1, hover: 2, lead: 3 };

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Where each label goes, from its anchor `at` (px, null: not drawn) and its text's size: right of the anchor, else
 *  left of it ("flip"), else hidden. A side is free when it crosses neither the card nor a label placed before; the
 *  labels are placed by PRIORITY. The selection's and the focus's labels are always shown: on a free side, else on the
 *  side away from the card. */
export function placeLabels(
  labels: { kind: Kind; at: [number, number] | null; w: number; h: number }[],
  card?: Box,
): ("right" | "left" | null)[] {
  const out: ("right" | "left" | null)[] = labels.map(() => null),
    placed: Box[] = [];
  const order = labels.map((_, i) => i).sort((a, b) => PRIORITY[labels[a].kind] - PRIORITY[labels[b].kind] || a - b);
  for (const i of order) {
    const { kind, at, w, h } = labels[i];
    if (!at) continue;
    const gap = kind === "selected" ? 12 : 6, // the text's offset from its anchor (styles/viewport.css)
      y0 = at[1] - 4 - h,
      y1 = at[1] - 4;
    const sides = {
      right: { x0: at[0] + gap, y0, x1: at[0] + gap + w, y1 },
      left: { x0: at[0] - gap - w, y0, x1: at[0] - gap, y1 },
    };
    const clear = (b: Box) => !(card && overlaps(b, card)),
      free = (b: Box) => clear(b) && !placed.some((p) => overlaps(b, p));
    let side: "right" | "left" | null = free(sides.right) ? "right" : free(sides.left) ? "left" : null;
    if (!side && (kind === "selected" || kind === "focus"))
      side = clear(sides.right) || !clear(sides.left) ? "right" : "left";
    if (!side) continue;
    out[i] = side;
    placed.push(sides[side]);
  }
  return out;
}
