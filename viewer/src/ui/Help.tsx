// The help dialog (key ?): every control with its key and the mouse or button that does it too, grouped as the menu
// is, then what the side panel, the colours, expressions and sharing are.
import { PUBLISH_COMMAND } from "../model/library";
import { bundle } from "../model/store";
import { SYNTAX } from "./ExprForm";
import { Modal } from "./widgets";

export function HelpDialog() {
  // The tab with the object rows: the shared domain's (e.g. Physics), named as the bundle names it.
  const h = bundle.value?.header,
    listTab = h?.domains?.find((d) => d.shared && h.display.some((l) => l.list && l.domain === d.name))?.name;
  // Grouped as the menu is; each row: its keys, the mouse or button that does it too, what it does.
  const groups: [string, [string[], string, string][]][] = [
    [
      "Look around",
      [
        [[], "drag", "Rotate"],
        [[], "right-drag, or shift + drag", "Pan"],
        [[], "scroll", "Zoom, towards the cursor"],
        [
          ["1", "2", "3", "4"],
          "the view buttons (at the bottom left of the view with parts of the detector, else in the top bar)",
          "Views: 3D, front, side, ρ–z",
        ],
        [["F"], "double-click it", "Zoom to the selection"],
        [["Home"], "the reset button", "Show the whole event"],
        [
          [],
          "Menu → Save picture…",
          "The view as a figure: the CMS label, a caption and the colour key over it, all editable; PNG, SVG or the clipboard",
        ],
      ],
    ],
    [
      "Select and explore",
      [
        [
          [],
          "click it",
          "Select an object: it stands out in the view, and its card shows its chain (what it is part of, what it is made of) with what the truth says at every step",
        ],
        [[], "click again on the same spot", "Objects on top of each other: the next one"],
        [
          [],
          "click a name in the card",
          "Look at that object in the view; the card stays. Click another to look at that one",
        ],
        [[], "double click a name in the card, or Open in its Looking at block", "Open that object's card"],
        [
          ["B"],
          "← at the top of the card; ✕ stop while looking",
          "Back: to the card's object, or to the previous card",
        ],
        [
          ["X"],
          "",
          "Across the link (the card's Go to truth button): from a reco object to its truth match, from a truth particle to what was reconstructed from it, and X again back; for an object with no truth of its own, its part's particle, or a chooser of its parts' particles, largest part first (X again: the first)",
        ],
        [[], "i next to a title, or a tag (match, sim)", "What something is, and how its numbers are counted"],
        [
          ["↓", "↑"],
          "show on a step of the chain",
          "Draw one step of what it is made of in the view (e.g. its tracksters, then their layer clusters); a part of the detector named on a step (e.g. Tracker ›) looks there",
        ],
        [
          ["N", "⇧N"],
          "the count on a collection's row lists its largest objects",
          "Next / previous object of the selected kind, largest first (e.g. the next jet, the next track); with nothing selected, the leading object",
        ],
        [
          ["Esc"],
          "click on empty space",
          "Leave the object; Esc also shows the whole event (and closes this dialog or the menu)",
        ],
      ],
    ],
    [
      "Event and parts of the detector",
      [
        [["←", "→"], "the arrows at the top", "Previous / next event"],
        [
          ["D", "⇧D"],
          "the Look at buttons at the top (when the data has several parts)",
          "One part of the detector (e.g. the tracker), or all; a selection stays selected, and D skips the parts it has nothing in",
        ],
        [
          [],
          "only on a kind's heading in the side panel",
          "One kind of object alone (e.g. only the tracks, only the jets); selecting one brings its parts and its truth",
        ],
      ],
    ],
    [
      "Colours and labels",
      [
        [
          ["T"],
          "Colour by: reco type | truth particle, in the colour key or the menu",
          "Colours: what the reconstruction made, or what was really there",
        ],
        [
          ["L"],
          `pointing at an object's row in ${listTab ? `the ${listTab} tab` : "the side panel"} rings it in the view`,
          "Labels on the leading objects and the selection",
        ],
      ],
    ],
    [
      "Play",
      [
        [["R"], "", "Replay: how the event builds up, step by step"],
        [
          ["P"],
          "the play button; any key or touch stops it",
          "Tour: each event built up step by step, out from the collision point and from hits to physics objects, then its leading objects",
        ],
      ],
    ],
    [
      "Data sets",
      [
        [
          [],
          "its name in the top bar; type to filter, ↑ ↓ and Enter to open",
          "Choose a data set: your own files, the ones you opened lately from links, and the site's shared ones",
        ],
        [
          [],
          `in a CMSSW area: ${PUBLISH_COMMAND}`,
          "Convert a file to a .ember file to open here; where this site is set up for it (EMBER_SITE_DIR), it is " +
            "published instead: listed under My files, with a link (removed after a while)",
        ],
        [
          [],
          "drop it on the page, or Open a local file… in the chooser",
          "Open a local .ember (or older .evdb) file: it stays on your computer",
        ],
        [[], "the share button", "Copy a link to this view"],
      ],
    ],
    [
      "Side panel",
      [
        [[], "⋯ at the end of its row in the side panel", "Colour, filter or a new column for a collection"],
        [[], "drag its edge; double-click to reset", "Resize the side panel"],
        [[], "Menu in the top bar", "Every control and its key, in one place"],
      ],
    ],
  ];
  return (
    <Modal title="How to use Ember">
      {groups.map(([name, rows]) => (
        <>
          <h3>{name}</h3>
          <table class="kv keys">
            <tbody>
              {rows.map(([keys, mouse, what]) => (
                <tr>
                  <td>
                    {keys.map((k) => (
                      <kbd>{k}</kbd>
                    ))}
                  </td>
                  <td>
                    {what}
                    {mouse && <span class="muted"> · {mouse}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ))}
      <h3>Side panel</h3>
      <p class="hint">
        One tab per part of the detector with its collections, by kind of object (with a domain bar: the physics objects
        in their own tab, with each kind's largest objects (the event's headline is the view's title), a click selecting
        one; the parts of the detector in Detector, which follows the bar); the truth (the event's reco ↔ truth counts,
        its collections, what became of each particle, the history as a tree); the event. A kind's heading shows its cut
        (e.g. pT ≥ 30 GeV): click it to change it; it applies to every collection of its group. A row shows the
        collection's state as chips: filter (click to see or remove it), selected (drawn only for the selected object;
        click for all), show (hidden while something is selected; click to draw it).
      </p>
      <h3>Colours</h3>
      <p class="hint">
        Colour means one thing at a time; the title of the key at the bottom of the side panel says which.
        <b>Reco type</b>: candidates by the particle type the reconstruction gave them, and everything they are made of
        (tracksters, layer clusters, hits, tracks) in the same colour. <b>Truth particle</b> (T): everything by the
        generator particle it comes from, the same in every part of the detector (a conversion's electrons and an
        interacting pion's daughters take their particle's colour); a reco object takes its particle's colour only where
        it is a clean match (e.g. 75% of a track's hits), else grey. Selecting a truth particle, a matched reco object
        or a hit shows its truth ↔ reco pair: the particle's branch (it and everything below it; for a particle inside
        another's shower, that shower's hits) and, in each detector, the reco objects the associator rates best for it,
        every hit coloured shared, contamination, split off or missed, with bars in the card that name the energy they
        count. A detector whose reco has no association is shown, not compared. The card opens with what the truth says
        of the object, in one line: its match; for a kind without one, its track's (or its one cluster's) match, named
        as the part's; else that its kind has none. Each part's own match is folded under it. A step of its chain with
        truth of its own has a tag: match (the CMSSW associator's, with its purity) or sim (simulated energy per
        particle in its hits); the kinds with no CMSSW associator are named behind the chain's i. A dot on an object's
        name says what the associator found for it: green for a clean match, half amber for an impure one, hollow for
        not matched. The Truth tab counts, for each matched kind, the clean, impure and unmatched objects of the event.
        Truth is drawn dashed. ⋯ on a row colours it by any column, or by the colour of a related object, instead. With
        something selected, everything unrelated fades.
      </p>
      <h3>Expressions</h3>
      <p class="hint">
        A filter or a new column (⋯ on a row) is an expression of the table's columns: {SYNTAX}. A filter hides the rows
        where it is 0; a new column is shown in the object's card and can colour or filter.
      </p>
      <h3>Sharing</h3>
      <p class="hint">
        The share button copies a link to what is on screen: the data set, event, view, part of the detector, a kind
        looked at alone, the selection with the level shown, and the truth colours (the address bar always holds it).
        Anyone who can open this site can open the link, also for a file someone else published; it works while the file
        is on the site. A local file has no link: send the file, or publish it with <code>{PUBLISH_COMMAND}</code> where
        this site is set up for it (<code>EMBER_SITE_DIR</code>).
      </p>
    </Modal>
  );
}
