// An object's name as a button, wherever the selection's card names one. A click looks at it: the view shows it as a
// selection (with its parts), and the card stays where it is (store/selection.ts look). A double click opens its own card.
// Pointing at it rings it in the view. For a kind the CMSSW associator matches, a dot says what it found for this
// object: clean, impure or no match, so a list shows at a glance which are which.
import { useEffect } from "preact/hooks";
import { sameRef } from "../model/relations";
import {
  anchor,
  caloView,
  chipText,
  layerOf,
  look,
  matchOf,
  nameOf,
  openCard,
  selection,
  truthText,
} from "../model/store";
import { rowHover } from "./Labels";
import { frameFocus } from "../control/navigate";

const WORDS = { clean: "clean match", impure: "impure match", unmatched: "not matched", matched: "matched" };
const glide = () => frameFocus(800);

/** The chip of row `r` of table `t`, named as in a list of its kind ("AK4 CHS · pT 52.8 GeV"); `title`: more to say on
 *  hover, after its one name. */
export const chip = (t: string, r: number, title = "") => <ObjChip table={t} row={r} title={title} />;
/** The chip of truth particle `r`, named for what it is shown next to (docs/truth.md): by its energy next to a
 *  calorimeter object or hits (`measure` "energy"), else by pT and η ("μ⁺ · pT 96.6 · η 1.11"). */
export const truthChip = (t: string, r: number, measure?: string) => (
  <ObjChip table={t} row={r} text={truthText(t, r, measure === "energy")} />
);

export function ObjChip({
  table,
  row,
  text,
  title = "",
}: {
  table: string;
  row: number;
  text?: string;
  title?: string;
}) {
  const sel = selection.value,
    viewing = !!anchor.value && sel?.table === table && sel.row === row,
    q = matchOf(table, row),
    ref = { table, row };
  // A chip removed under the pointer (its card opened, the event changed) gets no mouseleave: its ring goes with it.
  useEffect(
    () => () => {
      if (sameRef(rowHover.peek(), ref)) rowHover.value = null;
    },
    [table, row],
  );
  return (
    <button
      class={`chip${q ? ` q-${q}` : ""}${viewing ? " viewing" : ""}`}
      aria-pressed={viewing}
      title={`${nameOf(ref, [], true)}${q ? ` · ${WORDS[q]}` : ""}${title && ` · ${title}`}\nClick: look at it · double click: open its card`}
      onClick={() => {
        look(ref);
        glide();
      }}
      onDblClick={() => {
        openCard(ref);
        glide();
      }}
      onMouseEnter={() => (rowHover.value = ref)}
      onMouseLeave={() => (rowHover.value = null)}
    >
      {text ?? ((layerOf(table)?.truth && truthText(table, row, caloView.value)) || chipText(table, row))}
    </button>
  );
}
