# Viewer

A static web page (TypeScript, Preact signals, three.js) that reads bundles over HTTP range requests: on opening, the
header and index; then one request per event shown. What it draws and how comes from the bundle's display hints
([format.md](format.md)). A first tour is in [Getting started](getting-started.md#step-4-look-at-the-event).

## Data sets

The button at the left of the top bar names the data set that is open. A click opens the chooser: a filter and three
kinds of list.

- **My files**: what you published with `evd FILE.root` ([the `evd` command](cli.md)), newest first, each with its
  number of events and when it expires. The list is your area of the site, `data/u/<login>/index.json`.
- **Recent**: data sets you opened from someone's link, and local files by name (up to 12, remembered in this
  browser). A local file cannot be opened again from the list: drop it on the page again.
- **The site's shared groups** (its `index.json`, re-read every 30 s while the page is visible): samples and
  test-stand data kept by the site.

Other people's files are in no list: they are reached by link. Type to filter, ↑ ↓ and Enter to open, Esc to close;
**Open a local file…** at the bottom picks a `.evdb` from your computer, as dropping one on the page does. The panel
also says what is open (**Details**): who published it, when it expires, the converter and, when the bundle records
it, the CMSSW release that wrote its input.

**Who "my" is.** The page asks the site who is signed on (`whoami`, see [Hosting](hosting.md#who-is-looking-whoami));
where the site does not answer, the chooser asks for your CERN login once and remembers it in the browser
("not you?" forgets it).

**With nothing to show.** A bare address opens the newest shared data set, else your newest. A site with no data set
shows a start panel: what the page is and the three ways to get events in (publish a file, open a local one, follow a
link). A link to a file that is gone (expired or removed), refused, out of reach or not a bundle shows a panel that
says which, whose file it was and what to do; when a data set is already on screen it stays, and the reason comes as
a message.

**Sharing.** The share button (top right) copies a link to what is on screen and says what the link opens: the data
set, the event, the part of the detector, the view, a kind looked at alone, the selection and the colours; and, for
a file in someone's area, until when it works. Cuts, ticked collections and the camera are not part of a link. A
local file has no link: the button says so and how to publish the file. The address bar always holds the same link
(see [the end of this page](#the-address)).

## Controls

The same list is in the viewer's help (`?`), grouped with a key column, and the top bar's **Menu** has every control
of the view in one place, grouped (View, Event, Selection, Colours, Play), with its key and whether it is on; the theme
is there too. Esc closes it.

| action | how |
|---|---|
| rotate, pan, zoom | drag; right-drag or shift + drag; scroll (zooms towards the cursor) |
| select an object | click it: it stands out in the view (a ring and a filled label at it, whatever the labels setting; its colour pulled halfway to white on the dark theme and to black on the light one, which keeps its hue; a line drawn as a ribbon three times as wide, a marker larger; a line one pixel wide, e.g. a track, gets the colour and the mark only), and its card (right) shows its chain and what the truth says at every step (see [The selection's card](#the-selections-card)); the view shows it with its smallest parts, one kind per branch, and the parts drawn as lines, which do not hide them (e.g. a candidate with its calorimeter hits, its track and the track's hits; a vertex with its tracks and their hits), related objects highlighted (a track: its vertex and truth particle); its parts are drawn even where a layer's default filter would hide them (cuts and filters you set still apply; the object itself is drawn whatever the cut, and the hits of parts a cut hides are not); further clicks pick among its parts |
| look at an object of the chain | click its name in the card: the view glides to it and shows it as a selection (with its parts, marked like any selected object), and the card stays on its own object, with a **Looking at** block at its bottom edge for the one looked at (its truth match, its main numbers). Click another to look at that one instead; ✕ stop, Esc, B or a click on empty space goes back to the card's object, shown as it was. Selecting something else (in the view, a list, N) ends it, and back then returns to the card's object. X crosses from the object looked at. Pointing at a name rings the object in the view |
| open an object's card | double click its name, or **Open →** in the Looking at block: the card moves to it, and ← at the top of the card (or B) goes back |
| across to the truth, or back to the reco | X, or the particle on a step's match line: from a reco object to the associator's best match (a hit or a layer cluster: the particle with the most simulated energy in it); from a truth object to the reco object of the latest reconstruction step whose own best match it is (else the one holding most of it) |
| draw one step of what it is made of | ↓ / ↑, or **show** on a step of the chain: one step at a time between the object and its smallest parts (e.g. a candidate's interpretations, linked tracksters, tracksters, layer clusters), with the object drawn as an outline around it; a step with several layers (e.g. two linking algorithms) draws those ticked in Layers, or all of them if none is. With parts of the detector, ↓ / ↑ step through the steps of the part looked at (and of shared domains); a step in another part names it (e.g. **Tracker ›**): a click looks at that part, keeping the object. In All, steps of different parts at the same depth are drawn together (e.g. a jet's tracks and clusters) |
| one kind of object alone | **only** on a kind's heading in the side panel (e.g. only the tracks, only the jets, only the PF candidates; a heading is a kind in one part of the detector: HGCal's hits, not the barrel's): its ticked collections (none ticked: those of its preferred reconstruction path) and nothing else are drawn, whatever the part of the detector looked at, until an object is selected, which brings its parts and its truth; "show everything" on the view goes back. The ticks are kept; a replay or a tour ends it. Not offered for kinds drawn only for a selection (track hits) |
| objects on top of each other | click again on the same spot for the next one |
| zoom to an object | double-click it, or F |
| show everything | Home, or Reset |
| back to the normal view, close a dialog | Esc, or click on empty space |
| previous / next event | ← / →, or the arrows at the top |
| views: 3D, front, side, ρ–z | 1, 2, 3, 4, or the buttons at the bottom left of the view (in the top bar for bundles without parts of the detector) |
| one part of the detector, or all | D (Shift+D backwards), or the **Look at** bar at the top, Physics · Tracker · … · All (bundles with `domains`; a drop-down list below 1100 px): the part's layers, those of shared domains (e.g. the physics objects) and those of none (truth), framed on its region, in its view, and its layers' tab opens in the side panel (choosing a tab does not change the view); the side panel keeps your ticks. A shared domain (e.g. **Physics**) draws only its own layers and those of none. A bundle opens on its `view.domain`. With something selected it stays selected: the view frames its objects in that part, and D skips the parts it has nothing in |
| what the colours show | T, or Reco · Truth in the colour key or the Menu: the reconstruction (candidate types), or the truth (each generator particle in its own colour, reco objects only where they are a clean match); see [Colours](#colours-and-the-truth--reco-pair) |
| next / previous object | N / Shift+N: the next object of the selected one's kind, largest first (the order of the list its row's count opens, e.g. the next jet by pT, the next track), for every kind but hits; with nothing selected, the leading object of the first layer with labels |
| labels | L: labels on the leading objects of the layers with a `labels` hint (e.g. the 4 leading jets, MET) in a shared domain's view (Physics), and on the selection in any view; at the far end of a line or cone (where a jet meets the calorimeter), else at the object. Pointing at an object row in the side panel rings its object in the view |
| replay | R: hits appear at their arrival time (display hint `time`, else time of flight, or the bundle's `replay` order), then paths are built from their hits (display hint `grow`: tracks seeded, built outwards, fitted), then each reconstruction stage in turn; a caption says what is happening |
| tour | P, or the play button: each event built up step by step, outwards from the collision point and from the detector's hits to the physics objects (model/tour.ts): collision point, tracker hits, tracks, timing layer, calorimeter hits, clusters, HGCal showers, muon chambers, muon tracks, particle flow, jets, missing momentum, leptons and photons, b tagging. Each step shows the layers of its kinds (display hint `kind`; those shown by default, else all), grown in outwards while the camera frames them, with a caption in plain words; a step with nothing in the event is skipped. Then the bundle's own view (its starting domain), whose leading labelled objects (else main showers) are visited one by one, then the next event. A bundle with fewer than two such steps (test beam, cosmics) replays each event instead, then visits its main showers. Any key or touch stops it and brings back the user's layers |
| live | the Live button: play new files as they appear in the site's index |
| help | ? |
| resize the side panel | drag its edge; double-click to reset |

## Side panel

The **Preset** list when the bundle has more than one preset, with a button to apply the chosen one again (undoing
filters and colours changed by hand); then tabs; then the colour key. The panel carries names,
counts and state; what a thing is, and how a number is counted, is behind an **i** next to it (a pop-up: `viewer/src/ui/Info.tsx`),
here as in the selection's card.

- **One tab per part of the detector** (display hint `domain`, e.g. **HGCal**; **Objects** for bundles made before
  layers had one), in the order of the header's `domains`, as the top bar's buttons: its collections by kind of object.
  With two or more `domains`, a shared domain (e.g. **Physics**) keeps a tab of its own and the other parts share one,
  **Detector**, which follows the domain bar: a section per part, the one looked at open and first, the others folded
  (in All all open, in a shared domain's view all folded), each saying whether it is drawn (looked at, drawn, not in
  this view; what that means on hover)
  (their cuts still apply to a selection's objects there). A kind's heading carries its `cut` as a chip ("pT ≥ 30
  GeV", "no pT cut" at 0, in the accent colour when it is not the profile's): a click opens its slider in a pop-up
  (log scale over the group's values in the shown event; the lowest position is no cut; it applies to every layer of
  the group, also those listed elsewhere, which it names; it is named by the cut's `label`, else its column). A kind
  with several cuts (one per calorimeter) carries each on the first row it cuts. Then one row per layer: visibility,
  name, its state as chips, its count and ⋯; under it only its colour scale, when the colour key does not already
  explain it. The chips: **filter** (a click shows the expression and removes it), **selected** / **all** for
  `onSelection` layers (drawn only for the selected object, or all of them: a click switches), **show** on a layer
  hidden while something is selected (one of the selection's levels is drawn at a time: a click draws this one), and
  **shown** on an unticked layer drawn because it holds objects of the selection. A cut's pop-up opens beside the
  panel, so the counts of the rows it cuts stay in sight. Other
  reconstruction paths are folded at the end. **⋯** on a row: what colours the layer (any column, custom ones too,
  or a related object), an expression to filter its table or to add as a custom column (e.g. `snr = energy /
  sigmaNoise`, computed in the browser for every event and usable for colour and filters like stored columns), and the
  table's custom columns. A ticked layer with a `list` hint lists its largest objects that pass its cut and filter
  (e.g. jets by pT, with pT, η, φ); a click selects one. On any other row but hits, a click on its count lists its eight
  largest the same way (e.g. the tracksters by energy). The tab opens with a headline: how many objects of each such
  layer pass (or the value of a one-object table, e.g. MET). In the truth colours each kind's heading gets one word
  for what the truth graph says about it (match, fact, derived, no truth; the reason on hover; on each row where a
  kind's layers differ), and the rows of kinds without truth are faint. A kind's heading folds it, then says how many of its collections
  are drawn (for the page's life; a slider it shares with a later kind moves there). On a phone the panel is a sheet under the view, folded to
  its tabs until one is chosen.
- **Truth** (named **Tree** for a tree without truth layers): the event's reco ↔ truth scorecard: for each reco kind
  the CMSSW associator matches, how many of the objects passing their cuts and filters are a clean match, an impure
  one or have no match (`viewer/src/model/chain.ts` matchTally); a count unfolds to its objects, largest first (the
  event's merged, split and fake objects, one click away); then the truth coverage, folded to one line of counts (e.g.
  "9 matched · 2 fact · 18 no truth"; open, each kind's answer and, where there is none, why); the truth collections with their cut, what became of
  each particle that left hits (its best candidate, or not reconstructed), and objects linked to objects of the same
  table, e.g. truth-graph particles and their children, as a collapsible tree.
- **Event**: run and event information, the bundle's `summaries` charts, and the source with every table of the event.

### Colours and the truth ↔ reco pair

Colour means one thing at a time, and the title of the colour key (bottom of the side panel) says which; its **i**
explains it. The rules
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
selection's candidate alone, in a neutral colour ("in the candidate": nothing is confirmed). The levels drawn
on request are then the pair candidate's kinds, whichever of its objects is selected, and count the pair's objects (also the
particle's in other candidates or in none); the selected object itself is always drawn. A selection with neither a
candidate nor a particle that left hits (e.g. a central track, a vertex) has no pair: it is shown with its own levels
and links. The levels drawn are those the card offers: **show** on the steps of the chain, or its "In the view" line. In the pair view, every layer is coloured by where its objects ended up:

| class | meaning |
|---|---|
| shared | the particle's hits (and clusters, tracksters...) in its candidate (what the candidate is made of, even if it shares it with another candidate); the particle and the candidate |
| contamination | in the candidate, but from other particles or from none |
| split off | the particle's hits in other candidates, and those candidates (and candidates matched to the particle that are not its best) |
| missed | the particle's hits, and reco objects matched to it, in no candidate |

Everything else fades. A hit belongs to the particle that left the most simulated energy in it (a layer cluster: the
particle with the most simulated energy in its hits). Missed layer clusters stay in the background, as their hits
show the same and a shower's many one-hit halo clusters would cover the used ones. The selection's card names the pair
and gives, as two bars in the view's colours, its completeness (the particle's simulated energy in HGCal, with its
amount in the sensors: in its candidate, in other candidates and in none) and purity (the share of the candidate's hit
energy from the particle). The colour key says what each colour means, and stays in sight from every tab. Completeness counts each hit once per shower and any share of it; the colours
use each hit's dominant particle. Truth layers show the pair's particle and the one the selection points at.

### The selection's card

One card, the same for every kind of object, in this order (`viewer/src/ui/Navigator.tsx`). It carries names, bars and
numbers: the table's description is behind the **i** by its title, what the chain's words mean behind the chain's
**i**, and what a step's tag means on that step behind the tag itself (a click on "match", "fact", "derived" or "no
truth").

**Names of objects** in the card are buttons: a click looks at the object, a double click opens its card (Controls,
above). For a kind the CMSSW associator matches, each name carries a dot for what the associator says of that object:
filled green for a clean match, half amber for an impure one, hollow grey for none (`matchClass`,
`viewer/src/model/chain.ts`), so an unfolded step shows at a glance which of its objects are which. A kind matched
without a clean threshold gets no dot and no green: nothing says how good its match is.

**The chain** (`viewer/src/model/chain.ts`). A reco object is shown between what it is **part of** (the objects that
contain it, outermost first) and what it is **made of** (from the largest objects down to the hits), with what is
**also inside it** listed apart: objects built only from its parts that are not parts of it (a secondary vertex whose
tracks are all in the jet, a tau made of its PF candidates). A step names its objects when there are at most three,
else counts them and unfolds to a list, largest first; every object is a button that moves the selection there. Where
no relation names what contains an object of a reconstruction step (a trackster's linked trackster, interpretation and
candidate), the one holding the most of its parts is shown if it holds at least half of them, marked "≈ holds 3 of its
4 parts": worked out in evd. An object that contains the selection is never listed among its parts. Collections of
another reconstruction path (a PF candidate's CHS jet) are steps under their own name, and related rows of tables the
bundle does not draw (a hit's digi) are listed last, as **other tables**.

**Every step says what the truth graph has for it**, in the words of [truth.md](truth.md#where-truth-stops):

| tag | the step shows |
|---|---|
| match | for one object, the associator's best match and its purity (green from the kind's clean threshold, amber below), or "no match" (a fake, or an object the associator does not consider, e.g. a candidate without calorimeter energy); for several, their counts in the colours of their dots: "11 clean · 4 impure · 1 no match" |
| fact | the particles that left the simulated energy in the step's hits, with their shares, one line per detector (never summed across detectors); "per CSC layer" where the simulation records a coarser unit than the hit; "no exported particle" where none left energy (noise, out-of-time pile-up or a particle the export left out: the tag says so) |
| derived | evd's stand-in (layer clusters): the particles with the most simulated energy in their hits |
| no truth | the tag alone; behind it, why CMSSW has no truth for the kind, with the gap number of [truth-graph.md](truth-graph.md). A part with no truth of its own that goes with its container (a track's hits) has no line |

Each line is that step's own statement, and no match is built through the parts ([truth.md](truth.md#constituents)).
Under an object whose kind has no truth of its own (a jet, a PF candidate), a step of several parts counts their own
matches ("9 of 9 matched · 9 clean") but names no particle, and its hits and layer clusters say only that the statement
is on each of them ("on each hit: select one for its particles"): a ranking of the particles in a jet's hits would be
a match through hits. One part alone speaks for itself (a candidate's track). Under a kind with truth of its own (a
trackster, a candidate, a PF cluster) the particles are listed. Where a step's collections differ in truth (muon
rechits: fact; hits on muon tracks: none), each line names its collection. A kind that gains an associator in CMSSW
gets its `match` relation in the profile, and its steps then show the match with no viewer change.

**The levels in the view.** When the view is built around another object than the selection (the pair's candidate for a
hit or a truth particle; the focus for one of its parts), a line under the chain lists that object's levels, with the
one drawn lit: a click, or ↓ ↑, draws another.

**The match.** A reco object whose association has a `match` contract shows the associator's best match, its purity
and its completeness as bars (linear, with what they count under them: "21 of 21 hits · clean", "of the particle's
energy in HGCal", and the clean threshold marked), the generator particle the match belongs to, and the match's chain
in the truth graph on one line, from the collision down. Behind its **i**: what the kind reconstructs (e.g. "the
particle that entered the calorimeter"), how purity and completeness are counted, and the associator's score ("0 best;
not a fraction"). Without a match it says so, and gives the match of a single part (a track-only
candidate's track) as that part's.

**A truth object** shows its lineage (its ancestors, the generator's quarks and gluons folded into one line, itself,
its daughters, the levels each belongs to and the reco objects whose best match it is), then **Reconstructed as**: for
each reco kind with a truth -> reco association, the objects sharing hits or energy with it, most complete first, each
with the share of it that the object holds and a ★ where it is that object's own best match; "none" where nothing of
the kind was reconstructed from it (not by itself an inefficiency: it may never have reached that detector), in one
line; and the number of hits it left, per detector. Hit-based association weights (tracks) are counted in hits.

**Every association**, folded: each object an association in the file links to the selection, with the relation's
weights as stored (shared energy, score, a hit's simulated energy), best first: the associator's other partners behind
the best match, e.g. every particle sharing an impure trackster.

**The pair** the view is coloured by (above), as two bars under the chain: the particle's energy (where its simulated
energy went, with the detector and the amount in the sensors named: "in HGCal · 0.2 GeV in the sensors") and the
candidate's energy (what its hit energy is from). They compare the whole
generator particle with its candidate hit by hit; the match's purity and completeness are the associator's, for the
selected object. **The columns**: the layer's `inspect` columns (e.g. a jet's
pT, η, φ), for a layer with `fractions` its reconstructed energy fractions as one bar in a neutral grey ramp (a
reconstruction quantity, not one of the view's colours), and every column folded under them.

Colours are Okabe-Ito and Tol hues, checked for protan, deutan and tritan vision. Choosing a colour for one layer (its
⋯) overrides the particle type and the pair view for that layer. The replay keeps each candidate's colour throughout.

Expressions (filters, custom columns, summary `where`) admit column names, numbers, `pi`, `+ - * / % ^`, comparisons,
`&& || !`, parentheses and a fixed list of Math functions. They are parsed, never evaluated as JavaScript
(`viewer/src/model/expr.ts`).

### The address

The address keeps the bundle, event, view, domain (`All` when a bundle that opens on a domain shows everything), a
kind looked at alone (`only`), the selection, the level shown (`lv`) and the truth colours (`c=truth`), so links can
be shared. They are in the hash (`#b=…&e=…`; a query, `?b=…&e=…`, is read too): `b` is the bundle's path relative to
the site (`data/u/<login>/<name>.evdb` for a user's file), and `e` is the event's place in the file from 0 (the top
bar counts from 1), not its event number (the Event… box takes that). A local file is not written to the address.

Remembered per browser, not in links: custom columns, filters, colour choices and the active preset (per profile),
the theme, the panel width, your typed login and the recent data sets.
