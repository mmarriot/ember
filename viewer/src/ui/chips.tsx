// An object's name as a button, wherever the selection's card names one. A click looks at it: the view shows it as a
// selection (with its parts), and the card stays where it is (store.ts look). A double click opens its own card.
// Pointing at it rings it in the view. For a kind the CMSSW associator matches, a dot says what it found for this
// object: clean, impure or no match, so a list shows at a glance which are which.
import { anchor, describe, highlight, labelOf, look, matchOf, openCard, selection } from "../model/store";
import { rowHover } from "./Labels";
import { engine } from "./Viewport";

const WORDS = { clean: "clean match", impure: "impure match", unmatched: "no truth match" };

export function ObjChip({ table, row, text, title = "" }: { table: string; row: number; text?: string; title?: string }) {
  const sel = selection.value, viewing = !!anchor.value && sel?.table === table && sel.row === row, q = matchOf(table, row), ref = { table, row };
  return (
    <button class={`chip${q ? ` q-${q}` : ""}${viewing ? " viewing" : ""}`} aria-pressed={viewing}
      title={`${labelOf(table)} #${row}${q ? ` · ${WORDS[q]}` : ""}${title && ` · ${title}`}\nClick: look at it · double click: open its card`}
      onClick={() => look(ref)} onDblClick={() => { openCard(ref); engine?.frame(highlight.peek() ?? undefined, true, 800); }}
      onMouseEnter={() => (rowHover.value = ref)} onMouseLeave={() => (rowHover.value = null)}>{text ?? (describe(table, row) || `#${row}`)}</button>
  );
}
