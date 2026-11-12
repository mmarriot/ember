# Viewer

A static web page (TypeScript, Preact signals, three.js) that reads bundles over HTTP range requests: on opening, the
header and index; then one request per event shown. It lists the bundles of the site's `index.json` (re-read every
30 s while the page is visible), or opens a `.evdb` file dropped on the page. What it draws and how comes from the
bundle's display hints ([format.md](format.md)).

## Controls

The same list is in the viewer's help (`?`), grouped with a key column, and the top bar's **Menu** has every control
of the view in one place, grouped (View, Event, Selection, Colours, Play), with its key and whether it is on; the theme
is there too. Esc closes it.

| action | how |
|---|---|
| rotate, pan, zoom | drag; right-drag or shift + drag; scroll (zooms towards the cursor) |
| inspect an object | click it: it is shown with its smallest parts, one kind per branch, and the parts drawn as lines, which do not hide them (e.g. a candidate with its calorimeter hits, its track and the track's hits; a vertex with its tracks and their hits), related objects highlighted (a track: its vertex and truth particle); its parts are drawn even where a layer's default filter would hide them (cuts and filters you set still apply; the object itself is drawn whatever the cut, and the hits of parts a cut hides are not); further clicks pick among its parts |
| see what it is made of, level by level | ↓ / ↑, or click a level in the bar at the top left: one level at a time between the object and its smallest parts (e.g. a candidate's interpretations, linked tracksters, tracksters, layer clusters), with the object drawn as an outline around it; a level with several layers (e.g. two linking algorithms) draws those ticked in Layers, or all of them if none is. With parts of the detector, the bar lists the levels of the part looked at (and of shared domains), and a chip for each other part the object has objects in (e.g. a jet's "Calo 9"): a click on it looks at that part, keeping the object. In All, levels of different parts at the same depth are one (e.g. a jet's tracks and clusters) |
| objects on top of each other | click again on the same spot for the next one |
| zoom to an object | double-click it, or F |
| show everything | Home, or Reset |
| back to the normal view, close a dialog | Esc, or click on empty space |
| previous / next event | ← / →, or the arrows at the top |
| views: 3D, front, side, ρ–z | 1, 2, 3, 4, or the buttons at the bottom left of the view (in the top bar for bundles without parts of the detector) |
| one part of the detector, or all | D (Shift+D backwards), or the **Look at** bar at the top, Physics · Tracker · … · All (bundles with `domains`; a drop-down list below 1100 px): the part's layers, those of shared domains (e.g. the physics objects) and those of none (truth), framed on its region, in its view, and its layers' tab opens in the side panel (choosing a tab does not change the view); the side panel keeps your ticks. A shared domain (e.g. **Physics**) draws only its own layers and those of none. A bundle opens on its `view.domain`. With something selected it stays selected: the view frames its objects in that part, and D skips the parts it has nothing in |
| what the colours show | T, or Reco · Truth in the colour key or the Menu: the reconstruction (candidate types), or the truth (each generator particle in its own colour, reco objects only where they are a clean match); see [Colours](#colours-and-the-truth--reco-pair) |
| next / previous object | N / Shift+N: the next object of the selected one's kind, largest first (the order of its object rows, e.g. the next jet by pT), for kinds with object rows (`list`) only; with nothing selected, the leading object of the first layer with labels |
| labels | L: labels on the leading objects of the layers with a `labels` hint (e.g. the 4 leading jets, MET) in a shared domain's view (Physics), and on the selection in any view; at the far end of a line or cone (where a jet meets the calorimeter), else at the object. Pointing at an object row in the side panel rings its object in the view |
| replay | R: hits appear at their arrival time (display hint `time`, else time of flight, or the bundle's `replay` order), then paths are built from their hits (display hint `grow`: tracks seeded, built outwards, fitted), then each reconstruction stage in turn; a caption says what is happening |
| tour | P, or the play button: each event built up step by step, outwards from the collision point and from the detector's hits to the physics objects (model/tour.ts): collision point, tracker hits, tracks, timing layer, calorimeter hits, clusters, HGCal showers, muon chambers, muon tracks, particle flow, jets, missing momentum, leptons and photons, b tagging. Each step shows the layers of its kinds (display hint `kind`; those shown by default, else all), grown in outwards while the camera frames them, with a caption in plain words; a step with nothing in the event is skipped. Then the bundle's own view (its starting domain), whose leading labelled objects (else main showers) are visited one by one, then the next event. A bundle with fewer than two such steps (test beam, cosmics) replays each event instead, then visits its main showers. Any key or touch stops it and brings back the user's layers |
| live | the Live button: play new files as they appear in the site's index |
| help | ? |
| resize the side panel | drag its edge; double-click to reset |

## Side panel

Preset chips (under a **Preset** caption) when the bundle has more than one preset; then tabs; then the colour key.

- **One tab per part of the detector** (display hint `domain`, e.g. **HGCal**; **Objects** for bundles made before
  layers had one), in the order of the header's `domains`, as the top bar's buttons: its collections by kind of object.
  With two or more `domains`, a shared domain (e.g. **Physics**) keeps a tab of its own and the other parts share one,
  **Detector**, which follows the domain bar: a section per part, the one looked at open and first, the others folded
  (in All all open, in a shared domain's view all folded), each saying whether it is drawn (looked at, drawn, not in
  this view; what that means on hover)
  (their cuts still apply to a selection's objects there). Each kind lists its `cut` slider (log scale over the group's
  values in the shown event; the lowest position is no cut; it applies to every layer of the group, also those listed
  elsewhere, which it names; it is named by the cut's `label`, else its column), just before the first row it cuts, and then one row per layer: visibility and count, the layer's filter, "only for the
  selection" for `onSelection` layers, and its colour scale when the colour key does not already explain it. Other
  reconstruction paths are folded at the end. **⋯** on a row: what colours the layer (any column, custom ones too,
  or a related object), an expression to filter its table or to add as a custom column (e.g. `snr = energy /
  sigmaNoise`, computed in the browser for every event and usable for colour and filters like stored columns), and the
  table's custom columns. A ticked layer with a `list` hint lists its largest objects that pass its cut and filter
  (e.g. jets by pT, with pT, η, φ); a click selects one. The tab opens with a headline: how many objects of each such
  layer pass (or the value of a one-object table, e.g. MET). In the truth colours each kind's heading gets one word
  for what the truth graph says about it (match, fact, derived, no truth; the reason on hover; on each row where a
  kind's layers differ), and the rows of kinds without truth are faint. A kind's heading folds it, then says how many of its collections
  are drawn (for the page's life; a slider it shares with a later kind moves there). On a phone the panel is a sheet under the view, folded to
  its tabs until one is chosen.
- **Truth** (named **Tree** for a tree without truth layers): the truth coverage, folded to one line of counts (e.g.
  "9 matched · 2 fact · 18 no truth"; open, each kind's answer and, where there is none, why); the truth collections with their cut, what became of
  each particle that left hits (its best candidate, or not reconstructed), and objects linked to objects of the same
  table, e.g. truth-graph particles and their children, as a collapsible tree.
- **Event**: run and event information, the bundle's `summaries` charts, and the source with every table of the event.

### Colours and the truth ↔ reco pair

Colour means one thing at a time, and the title of the colour key (bottom of the side panel) says which; its "How to
read this" (folded until opened, remembered per browser) explains it. The rules
behind the truth colours and numbers, and what each kind of object is compared with, are in [truth.md](truth.md).

- **Reco** (the default with candidates): candidates by the particle type the reconstruction gave them, and
  everything they are made of in the same colour: interpretations and tracks (their candidate), tracksters and
  linked tracksters (the candidate holding most of their layer clusters), layer clusters, and hits (their layer
  cluster's candidate). Objects in no candidate are small and grey; a layer that cannot reach a candidate (e.g. the
  vertices) is drawn by its colour column, or keeps its own categorical colours if it has none. How each layer
  reaches a candidate or a truth particle is worked out from the bundle's relations (`viewer/src/model/modes.ts`),
  so this needs no profile settings.
- **Truth** (key T, or Reco · Truth in the key; bundles with truth particles): everything by the generator particle it
  comes from (the profile's `particle` level), the same in every part of the detector: hits by the particle that left
  the most simulated energy in them, truth lines by their generator particle (a conversion's electrons and an
  interacting pion's daughters take their particle's colour). A reco object takes its matched particle's colour only
  for a clean match (purity at least its kind's `match.good`: 75% of a track's hits, 50% of a trackster's energy),
  else grey (layer clusters: at least half of their simulated energy); layers with no link to the truth (vertices) the
  "no truth" grey. Colours go to signal generator particles only, by energy; the other signal particles are mid grey,
  pile-up its own grey and drawn small, and hits no exported particle left energy in small and faint (noise,
  out-of-time pile-up, or not exported). The Truth mode needs a bundle whose truth particles name their level
  (`particle`); older bundles have only Reco.
- A bundle without candidates or truth shows each layer's own colouring from the profile (energies, particle types),
  with its scale under the layer's row; so does a domain with `colourMode` `"layers"` (e.g. the Tracker, its tracks
  by pT) while it is looked at in the Reco mode.

**The pair view.** With candidates, selecting anything shows its truth ↔ reco pair (`viewer/src/model/pair.ts`), in
either mode: first the selection's particle, the whole of its generator particle (a reco object takes its best truth
match; a hit, the particle that left the most simulated energy in it), then that particle's best candidate. So the
particle, its candidate and anything inside them give the same pair and the same picture; a selected candidate that is
not its particle's best (a fragment) shows as split off. A match above the generator level (e.g. a candidate matched to
a π⁰ as a whole, whose photons are generator particles of their own) stands for all the generator particles below it,
and the key says the candidate merges them. Without a particle (no truth in the file, or none matched) the pair is the
selection's candidate alone, in a neutral colour ("in the candidate": nothing is confirmed). The levels in the focus
bar are then the pair candidate's kinds, whichever of its objects is selected, and count the pair's objects (also the
particle's in other candidates or in none); the selected object itself is always drawn. A selection with neither a
candidate nor a particle that left hits (e.g. a central track, a vertex) has no pair: it is shown with its own levels
and links. In the pair view, every layer is coloured by where its objects ended up:

| class | meaning |
|---|---|
| shared | the particle's hits (and clusters, tracksters...) in its candidate (what the candidate is made of, even if it shares it with another candidate); the particle and the candidate |
| contamination | in the candidate, but from other particles or from none |
| split off | the particle's hits in other candidates, and those candidates (and candidates matched to the particle that are not its best) |
| missed | the particle's hits, and reco objects matched to it, in no candidate |

Everything else fades. A hit belongs to the particle that left the most simulated energy in it (a layer cluster: the
particle with the most simulated energy in its hits). Missed layer clusters stay in the background, as their hits
show the same and a shower's many one-hit halo clusters would cover the used ones. The key gives completeness (the
particle's simulated energy in HGCal, with its amount in the sensors: in its candidate, in other candidates and in
none) and purity (the share of the candidate's hit energy from the particle). The key stays in sight from every tab,
e.g. while clicking particles in Truth. Completeness counts each hit once per shower and any share of it; the colours
use each hit's dominant particle. Truth layers show the pair's particle and the one the selection points at.

**The inspector's summary** shows the layer's `inspect` columns (e.g. a jet's pT, η, φ), and for a layer with
`fractions` its reconstructed energy fractions as one bar in a neutral grey ramp, each share named under it (e.g. a
jet's charged and neutral hadrons, photons): a reconstruction quantity, not one of the view's colours.

**The inspector's truth sections.** A reco object whose association has a `match` contract shows what its kind
reconstructs (e.g. "the particle that entered the calorimeter"), the associator's best match, its purity (with the
counted amounts: "21 of its 21 hits"), its completeness (and of what), whether it is clean, the associator's score
("0 best; not a fraction"), the generator particle the match belongs to, and the match's lineage. Without a match it
says so, and gives the match of a single part (a track-only candidate's track) as that part's. A truth particle shows
its lineage: its ancestors (the generator's quarks and gluons folded into one line), itself, its daughters, the levels
each belongs to (generator particle, entered the calorimeter, b or c hadron) and the reco objects whose best match it
is. Hit-based association weights (tracks) are named "shared hits".

Colours are Okabe-Ito and Tol hues, checked for protan, deutan and tritan vision. Choosing a colour for one layer (its
⋯) overrides the particle type and the pair view for that layer. The replay keeps each candidate's colour throughout.

Expressions (filters, custom columns, summary `where`) admit column names, numbers, `pi`, `+ - * / % ^`, comparisons,
`&& || !`, parentheses and a fixed list of Math functions. They are parsed, never evaluated as JavaScript
(`viewer/src/model/expr.ts`).

The URL keeps the bundle, event, view, domain (`All` when a bundle that opens on a domain shows everything),
selection, the level shown (`lv`) and the truth colours (`c=truth`), so links can be shared. They are in the hash
(`#b=…&e=…`; a query, `?b=…&e=…`, is read too); `e` is the event's place in the file from 0 (the top bar counts
from 1), not its event number (the Event… box takes that). Custom columns, filters, colour
choices and the active preset (per profile), the theme and the panel width are remembered per browser.
