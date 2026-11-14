# Viewer

The viewer is a static web page (TypeScript, Preact signals, three.js). It reads bundles over HTTP range requests.
When it opens a bundle, it reads the header and the index. Then it reads one event with one request each time you
show an event. The bundle's display hints say what to draw and how ([Bundle format](format.md)).

This page describes every part of the viewer. For a short first tour, see
[Getting started, step 4](getting-started.md#step-4-look-at-the-event).

## Data sets

The button at the left of the top bar shows the name of the data set that is open. Click it to open the **data set
chooser**. It has a filter and three kinds of list:

- **My files**: the bundles you published with `evd FILE.root` ([The `evd` command](cli.md)). The newest come first.
  Each shows its number of events and when it expires. This list is your user area on the site,
  `data/u/<login>/index.json`.
- **Recent**: data sets you opened from someone's link, and local files by name. The list holds up to 12 and is
  remembered in this browser. You cannot open a local file again from this list: drop it on the page again.
- **The site's shared groups**: samples and test-stand data that the site keeps. They come from the site's
  `index.json`, which the viewer reads again every 30 s while the page is visible.

Other people's files are in no list. You reach them only through a link.

In the chooser, type to filter. Use ↑ ↓ and Enter to open a data set, and Esc to close the chooser. **Open a local
file…** at the bottom picks a `.evdb` file from your computer. Dropping a file on the page does the same.

The chooser also describes the data set that is open, under **Details**: who published it, when it expires, which
converter made it and, when the bundle records it, which CMSSW release wrote its input.

**Who "my" is.** The page asks the site who is signed on (`whoami`, see
[Hosting](hosting.md#who-is-looking-whoami)). If the site does not answer, the chooser asks for your CERN login once,
and remembers it in this browser. Click "not you?" to make it forget.

**When there is nothing to show.**

- An address with no data set in it opens the newest shared data set. If there is none, it opens your newest file.
- A site with no data set at all shows a start panel. It says what the page is and gives the three ways to get
  events in: publish a file, open a local file, or follow a link.
- A link to a file that cannot be opened shows a panel. It says why: the file is gone (expired or removed), access
  was refused, the file could not be reached, or it is not a bundle. It also says whose file it was and what to do.
  If a data set is already on screen, it stays, and the reason appears as a message.

## Sharing a link

The share button at the top right copies a link to what is on screen. It also lists what the link opens:

- the data set and the event;
- the part of the detector and the view;
- a kind of object shown alone (see **only** below);
- the selected object, and the colours;
- for a file in someone's user area, until when the link works.

The link does not keep the cuts, the ticked collections or the camera. A local file has no link: the button says so,
and explains how to publish the file.

The address bar always holds the same link. [The address](#the-address) lists what it keeps.

## Controls

Press `?` for the viewer's help. It lists the same controls as this section, grouped, with their keys. The **Menu**
in the top bar also has every control of the view in one place, grouped as View, Event, Selection, Colours and Play.
It shows each control's key and whether it is on. The colour theme is there too. Esc closes the menu.

### Moving around

| to | do this |
|---|---|
| rotate | drag |
| pan | right-drag, or shift + drag |
| zoom | scroll (it zooms towards the cursor) |
| switch view: 3D, front, side, ρ–z | `1`, `2`, `3`, `4`, or the buttons at the bottom left of the view (in the top bar for a bundle without parts of the detector) |
| zoom to an object | double-click it, or `F` |
| show the whole event | `Home`, or Reset |
| go back to the normal view, or close a dialog | `Esc`, or click on empty space |
| previous / next event | `←` / `→`, or the arrows at the top |
| resize the side panel | drag its edge; double-click the edge to reset it |

**Parts of the detector.** Press `D` (`Shift+D` to go backwards), or use the **Look at** bar at the top: Physics ·
Tracker · … · All. The bar appears for a bundle whose header has `domains`. Below 1100 px of width it becomes a
drop-down list. Looking at one part:

- draws that part's layers, the layers of shared parts (for example the physics objects) and the layers of no part
  (truth);
- frames the part's region, in the part's own view;
- opens the part's tab in the side panel. Choosing a tab yourself does not change the view.

The side panel keeps your ticks. A shared part (for example **Physics**) draws only its own layers and the layers of
no part. A bundle opens on the part named in its `view.domain`. A selected object stays selected when you change
part: the view frames the object's pieces in that part, and `D` skips the parts where it has nothing.

### Selecting an object

**Click an object** to select it. If objects lie on top of each other, click again on the same spot to get the next
one. Further clicks on a selected object pick among its parts.

The selected object stands out in the view:

- it gets a ring and a filled label, whatever the labels setting;
- its colour moves halfway to white on the dark theme, or to black on the light theme, so it keeps its hue;
- a line becomes a ribbon three times as wide, and a marker becomes larger. A line one pixel wide, such as a track,
  gets only the new colour, the ring and the label.

The view then shows the object with its smallest parts, one kind per branch. Parts drawn as lines do not hide the
others. For example, a candidate is shown with its calorimeter hits, its track and the track's hits; a vertex with
its tracks and their hits. Related objects are highlighted: a track shows its vertex and its truth particle.

The parts are drawn even where a layer's default filter would hide them. Cuts and filters that you set still apply.
The selected object itself is always drawn, whatever the cut, but the hits of parts that a cut hides are not.

The selection's **card** opens on the right. It shows the object's chain, with what the truth says at every step
(see [The selection's card](#the-selections-card)).

**Next object.** `N` selects the next object of the same kind, largest first. `Shift+N` goes back. The order is the
order of the list that the row's count opens, for example the next jet by pT, or the next track. This works for every
kind except hits. With nothing selected, `N` selects the leading object of the first layer with labels.

**Labels.** `L` shows labels on the leading objects of the layers that have a `labels` hint (for example the 4
leading jets, and MET). These labels appear in a shared part's view (Physics). The selection is labelled in every
view. A label sits at the far end of a line or cone (where a jet meets the calorimeter), or else at the object.
Pointing at an object's row in the side panel rings the object in the view.

### Following the chain

**Look at an object of the chain.** Click its name in the card. The view glides to it and shows it as a selection,
with its parts, marked like any selected object. The card stays on its own object. A **Looking at** block at the
bottom of the card describes the object you look at: its truth match and its main numbers.

- Click another name to look at that object instead.
- ✕ stop, `Esc`, `B` or a click on empty space go back to the card's object, shown as it was.
- Selecting something else (in the view, in a list, or with `N`) ends the looking. Going back then returns to the
  card's object.
- `X` crosses to the truth from the object you look at.
- Pointing at a name rings its object in the view.

**Open an object's card.** Double-click its name, or click **Open →** in the Looking at block. The card moves to that
object. ← at the top of the card (or `B`) goes back.

**Draw one step of what the object is made of.** Press `↓` / `↑`, or click **show** on a step of the chain. This
draws one step at a time, from the object down to its smallest parts. For a TICL candidate, the steps are its
interpretations, linked tracksters, tracksters and layer clusters. The object itself is drawn as an outline around
the step.

- A step with several layers (for example two linking algorithms) draws the layers ticked in the side panel, or all
  of them if none is ticked.
- In a bundle with parts of the detector, `↓` / `↑` go through the steps of the part you look at (and of the shared
  parts). A step in another part names that part, for example **Tracker ›**. Click it to look at that part, keeping
  the object.
- In All, steps of different parts at the same depth are drawn together, for example a jet's tracks and clusters.

**Cross to the truth, and back.** Press `X`, or click the particle on a step's match line.

- From a reco object, `X` goes to the associator's best match. For a hit or a layer cluster, it goes to the particle
  that left the most simulated energy in it.
- From a truth object, `X` goes to the reco object of the latest reconstruction step whose own best match it is. If
  there is none, it goes to the reco object that holds most of it.

### Showing less

**One kind of object alone.** Click **only** on a kind's heading in the side panel, for example to show only the
tracks, only the jets or only the PF candidates. A heading is a kind in one part of the detector: HGCal's hits, not
the barrel's.

- The viewer then draws the kind's ticked collections and nothing else, whatever part of the detector you look at.
  If none is ticked, it draws the collections of the kind's preferred reconstruction path.
- Selecting an object brings back its parts and its truth.
- "show everything" on the view ends it. A replay or a tour also ends it. Your ticks are kept.
- **only** is not offered for kinds that are drawn only for a selection (such as the hits on a track).

### Colours

Press `T`, or click Reco · Truth in the colour key or in the Menu. This switches between the reconstruction
(candidate types) and the truth (each generator particle in its own colour; a reco object only where it is a clean
match). See [Colours and the truth ↔ reco pair](#colours-and-the-truth--reco-pair).

### Playing

**Replay** (`R`) shows how the event builds up:

1. hits appear at their arrival time (display hint `time`; otherwise their time of flight, or the bundle's `replay`
   order);
2. paths are built from their hits (display hint `grow`): tracks are seeded, built outwards and fitted;
3. each reconstruction stage appears in turn.

A caption says what is happening.

**Tour** (`P`, or the play button) builds up each event step by step, outwards from the collision point and from the
detector's hits to the physics objects (`viewer/src/model/tour.ts`). The steps are: collision point, tracker hits,
tracks, timing layer, calorimeter hits, clusters, HGCal showers, muon chambers, muon tracks, particle flow, jets,
missing momentum, leptons and photons, b tagging.

- Each step shows the layers of its kinds (display hint `kind`): the layers shown by default, or else all of them.
  They grow in outwards while the camera frames them, with a caption in plain words.
- A step with nothing in the event is skipped.
- After the steps, the tour shows the bundle's own view (its starting part of the detector). It visits its leading
  labelled objects one by one (or else its main showers), then goes on to the next event.
- A bundle with fewer than two such steps (test beam, cosmics) replays each event instead, then visits its main
  showers.
- Any key or touch stops the tour and brings back your layers.

**Live** (the Live button) plays new files as they appear in the site's index.

## Side panel

From top to bottom, the side panel has:

1. the **Preset** list, when the bundle has more than one preset, with a button to apply the chosen preset again.
   This undoes filters and colours that you changed by hand;
2. tabs;
3. the colour key.

The panel shows names, counts and state. What a thing is, and how a number is counted, is behind an **i** next to it
(a pop-up, `viewer/src/ui/Info.tsx`). The selection's card works the same way.

### Detector tabs

There is one tab per part of the detector (display hint `domain`), for example **HGCal**. Bundles made before
layers had a part show one tab, **Objects**. The tabs are in the order of the header's `domains`, as in the top bar.

With two or more parts, a shared part (for example **Physics**) keeps a tab of its own. The other parts share one
tab, **Detector**, which follows the **Look at** bar:

- it has one section per part. The part you look at is open and first; the others are folded;
- in All, every section is open. In a shared part's view, every section is folded;
- each section says whether it is drawn: looked at, drawn, or not in this view. Hover to see what this means;
- the cuts of a folded section still apply to a selection's objects there.

In each tab, the collections are grouped by kind of object.

**A kind's heading** carries its cut as a chip, for example "pT ≥ 30 GeV" ("no pT cut" at 0). The chip is in the
accent colour when the cut differs from the profile's. Click it to open a slider in a pop-up:

- the slider has a log scale over the values of the group in the event shown. Its lowest position means no cut;
- it applies to every layer of the group, also layers listed elsewhere, which it names;
- it is named after the cut's `label`, or else its column;
- the pop-up opens beside the panel, so the counts of the rows it cuts stay in sight.

A kind with several cuts (one per calorimeter) shows each cut on the first row it cuts.

Clicking a kind's heading folds it. The folded heading says how many of its collections are drawn. This lasts for
the life of the page. A slider shared with a later kind moves to that kind.

**One row per layer** shows: a visibility tick, the name, its state as chips, its count and **⋯**. Under the row
there is its colour scale, if the colour key does not already explain it. The chips are:

| chip | meaning |
|---|---|
| **filter** | the layer has a filter. Click to see the expression and remove it. |
| **selected** / **all** | for an `onSelection` layer: drawn only for the selected object, or all of its objects. Click to switch. |
| **show** | the layer is hidden while something is selected, because only one of the selection's levels is drawn at a time. Click to draw this one. |
| **shown** | the layer is not ticked, but it is drawn because it holds objects of the selection |

**⋯** on a row opens:

- what colours the layer: any column, custom columns too, or a related object;
- an expression, to filter the layer's table or to add as a custom column. For example `snr = energy / sigmaNoise`.
  A custom column is computed in the browser for every event, and you can use it for colours and filters like a
  stored column ([Expressions](#expressions));
- the table's custom columns.

**Lists of objects.** A ticked layer with a `list` hint lists its largest objects that pass its cut and filter, for
example jets by pT, with pT, η and φ. Click one to select it. On any other row except hits, click the count to list
its eight largest objects in the same way (for example the tracksters by energy).

The tab opens with a headline: how many objects of each such layer pass, or the value of a one-object table (for
example MET).

**In the truth colours**, each kind's heading gets one word for what the truth graph says about it: match, fact,
derived, or no truth. Hover for the reason. Where a kind's layers differ, each row gets its own word. The rows of
kinds without truth are faint.

Other reconstruction paths are folded at the end of the tab.

On a phone, the panel is a sheet under the view. It is folded to its tabs until you choose one.

### Truth tab

The tab is called **Tree** for a bundle with a tree but no truth layers. It holds:

- **the event's reco ↔ truth scorecard.** For each reco kind that a CMSSW associator matches, it counts how many of
  the objects that pass their cuts and filters are a clean match, an impure match, or have no match
  (`matchTally` in `viewer/src/model/chain.ts`). Click a count to unfold its objects, largest first. So the event's
  merged, split and fake objects are one click away.
- **the truth coverage**, folded to one line of counts, for example "9 matched · 2 fact · 18 no truth". Unfold it to
  see each kind's answer and, where there is no truth, why.
- the truth collections, with their cuts;
- what became of each particle that left hits: its best candidate, or "not reconstructed";
- objects linked to objects of the same table as a tree that you can fold, for example the truth-graph particles and
  their children.

### Event tab

The **Event** tab shows the run and event information, the bundle's `summaries` charts, and the source with every
table of the event.

## Colours and the truth ↔ reco pair

Colour means one thing at a time. The title of the colour key, at the bottom of the side panel, says which; its **i**
explains it. [Truth](truth.md) gives the rules behind the truth colours and numbers, and what each kind of object is
compared with.

- **Reco** (the default for a bundle with candidates). Candidates are coloured by the particle type that the
  reconstruction gave them. Everything they are made of takes the same colour: interpretations and tracks (their
  candidate), tracksters and linked tracksters (the candidate that holds most of their layer clusters), layer
  clusters, and hits (their layer cluster's candidate). Objects in no candidate are small and grey. A layer that
  cannot reach a candidate (for example the vertices) is coloured by its colour column, or keeps its own categorical
  colours if it has none. The viewer works out how each layer reaches a candidate or a truth particle from the
  bundle's relations (`viewer/src/model/modes.ts`), so the profile needs no settings for this.
- **Truth** (key `T`, or Reco · Truth in the key; for bundles with truth particles). Everything is coloured by the
  generator particle it comes from (the profile's `particle` level), the same in every part of the detector:
  - a hit takes the colour of the particle that left the most simulated energy in it;
  - a truth line takes its generator particle's colour. A conversion's electrons and an interacting pion's
    daughters take their particle's colour;
  - a reco object takes its matched particle's colour only for a clean match. Clean means a purity of at least its
    kind's `match.good`: 75% of a track's hits, or 50% of a trackster's energy. For layer clusters it is at least
    half of their simulated energy. Otherwise the object is grey;
  - layers with no link to the truth (vertices) are the "no truth" grey;
  - only signal generator particles get colours, by energy. The other signal particles are mid grey. Pile-up has its
    own grey and is drawn small;
  - hits in which no exported particle left energy are small and faint: noise, out-of-time pile-up, or a particle
    that was not exported.

  The Truth mode needs a bundle whose truth particles name their level (`particle`). Older bundles have only Reco.
- **Layer colours.** A bundle without candidates or truth shows each layer's own colours from the profile (energies,
  particle types), with the scale under the layer's row. A part of the detector with `colourMode` `"layers"` does the
  same while you look at it in the Reco mode, for example the Tracker, with its tracks by pT.

### The pair view

In a bundle with candidates, selecting anything shows its truth ↔ reco pair (`viewer/src/model/pair.ts`), in either
mode:

1. first the selection's particle: the whole of its generator particle. A reco object takes its best truth match; a
   hit takes the particle that left the most simulated energy in it;
2. then that particle's best candidate.

So the particle, its candidate, and anything inside them all give the same pair and the same picture. A selected
candidate that is not its particle's best (a fragment) shows as split off.

A match above the generator level stands for all the generator particles below it. For example, a candidate matched
to a π⁰ as a whole, whose photons are generator particles of their own. The key then says that the candidate merges
them.

Without a particle (no truth in the file, or nothing matched), the pair is the selection's candidate alone, in a
neutral colour: "in the candidate". Nothing is confirmed.

The levels drawn on request are then the kinds of the pair's candidate, whichever of its objects is selected. They
count the pair's objects, including the particle's objects in other candidates or in none. The selected object itself
is always drawn. A selection with neither a candidate nor a particle that left hits (for example a central track, or
a vertex) has no pair: it is shown with its own levels and links. The levels drawn are those that the card offers:
**show** on the steps of the chain, or its "In the view" line.

In the pair view, every layer is coloured by where its objects ended up:

| class | meaning |
|---|---|
| shared | the particle's hits (and clusters, tracksters...) in its candidate: what the candidate is made of, even if it shares it with another candidate; also the particle and the candidate themselves |
| contamination | in the candidate, but from other particles or from none |
| split off | the particle's hits in other candidates, and those candidates (also candidates matched to the particle that are not its best) |
| missed | the particle's hits, and reco objects matched to it, that are in no candidate |

Everything else fades.

- A hit belongs to the particle that left the most simulated energy in it. A layer cluster belongs to the particle
  with the most simulated energy in its hits.
- Missed layer clusters stay in the background. Their hits already show the same thing, and a shower's many one-hit
  halo clusters would cover the used ones.
- The selection's card names the pair. It gives two bars in the view's colours:
  - **completeness**: the particle's simulated energy in HGCal, with its amount in the sensors: in its candidate, in
    other candidates, and in none;
  - **purity**: the share of the candidate's hit energy that comes from the particle.
- Completeness counts each hit once per shower, and any share of it. The colours use each hit's main particle.
- The colour key says what each colour means, and stays in sight from every tab.
- Truth layers show the pair's particle and the particle that the selection points at.

### Colour choices

The colours are Okabe-Ito and Tol hues, checked for protan, deutan and tritan colour vision. Choosing a colour for one
layer (in its **⋯**) overrides the particle type and the pair view for that layer. The replay keeps each candidate's
colour throughout.

## The selection's card

The card is the same for every kind of object (`viewer/src/ui/Navigator.tsx`). It shows names, bars and numbers.
More is behind small buttons:

- the table's description is behind the **i** next to its title;
- what the chain's words mean is behind the chain's **i**;
- what a step's tag means on that step is behind the tag itself: click "match", "fact", "derived" or "no truth".

The card holds these parts, in this order.

**Names of objects.** Every object name in the card is a button. A click looks at the object; a double click opens
its card ([Following the chain](#following-the-chain)). For a kind that a CMSSW associator matches, each name has a
dot for what the associator says about that object (`matchClass` in `viewer/src/model/chain.ts`):

- filled green: a clean match;
- half amber: an impure match;
- hollow grey: no match.

So an unfolded step shows at a glance which of its objects are which. A kind that is matched without a clean
threshold gets no dot and no green, because nothing says how good its match is.

**The chain** (`viewer/src/model/chain.ts`). A reco object is shown between:

- what it is **part of**: the objects that contain it, outermost first;
- what it is **made of**: from the largest objects down to the hits;
- what is **also inside it**, listed apart: objects built only from its parts that are not parts of it. For example
  a secondary vertex whose tracks are all in the jet, or a tau made of its PF candidates.

A step names its objects when there are three or fewer. Otherwise it counts them and unfolds to a list, largest
first. Every object is a button that moves the selection there.

Sometimes no relation says what contains an object of a reconstruction step (for example a trackster's linked
trackster, interpretation and candidate). Then the card shows the object that holds the most of its parts, if that
object holds at least half of them. It marks this as worked out in evd: "≈ holds 3 of its 4 parts". An object that
contains the selection is never listed among its parts.

Collections of another reconstruction path (for example a PF candidate's CHS jet) are steps under their own name.
Related rows of tables that the bundle does not draw (for example a hit's digi) are listed last, as **other
tables**.

**Every step says what the truth graph has for it**, in the words of [Truth](truth.md#where-truth-stops):

| tag | what the step shows |
|---|---|
| match | For one object: the associator's best match and its purity (green from the kind's clean threshold, amber below), or "no match" (a fake, or an object that the associator does not consider, such as a candidate without calorimeter energy). For several objects: their counts, in the colours of their dots, for example "11 clean · 4 impure · 1 no match". |
| fact | The particles that left the simulated energy in the step's hits, with their shares, one line per detector (never summed across detectors). "per CSC layer" where the simulation records a coarser unit than the hit. "no exported particle" where none left energy (noise, out-of-time pile-up, or a particle the export left out): the tag says so. |
| derived | evd's stand-in (layer clusters): the particles with the most simulated energy in their hits |
| no truth | The tag alone. Behind it: why CMSSW has no truth for the kind, with the gap number of [Truth graph](truth-graph.md). A part with no truth of its own that goes with its container (the hits of a track) has no line. |

Each line is the step's own statement. No match is built through the parts ([Truth](truth.md#constituents)):

- Under an object whose kind has no truth of its own (a jet, a PF candidate), a step of several parts counts their
  own matches ("9 of 9 matched · 9 clean") but names no particle. Its hits and layer clusters say only that the
  statement is on each of them ("on each hit: select one for its particles"). A ranking of the particles in a jet's
  hits would be a match through hits.
- One part alone speaks for itself (for example a candidate's track).
- Under a kind with truth of its own (a trackster, a candidate, a PF cluster), the particles are listed.
- Where a step's collections differ in truth (muon rechits: fact; hits on muon tracks: none), each line names its
  collection.

When a kind gets an associator in CMSSW, it gets a `match` relation in the profile. Its steps then show the match,
with no change to the viewer.

**The levels in the view.** Sometimes the view is built around another object than the selection: the pair's
candidate for a hit or a truth particle, or the object in focus for one of its parts. Then a line under the chain
lists that object's levels, with the one drawn lit. Click another one, or press `↓` `↑`, to draw it.

**The match.** For a reco object whose association has a `match` contract, the card shows:

- the associator's best match;
- its purity and completeness, as linear bars with what they count under them ("21 of 21 hits · clean", "of the
  particle's energy in HGCal"), and the clean threshold marked;
- the generator particle that the match belongs to;
- the match's chain in the truth graph, on one line, from the collision down.

Behind its **i**: what the kind reconstructs (for example "the particle that entered the calorimeter"), how purity
and completeness are counted, and the associator's score ("0 best; not a fraction"). Without a match, the card says
so. If the object has a single part with its own match (for example a track-only candidate's track), it gives that
match as the part's.

**A truth object** shows:

- its lineage: its ancestors (the generator's quarks and gluons folded into one line), itself, its daughters, the
  levels each one belongs to, and the reco objects whose best match it is;
- **Reconstructed as**: for each reco kind with a truth → reco association, the objects that share hits or energy
  with it, most complete first. Each shows the share of the particle that it holds, and a ★ where the particle is
  that object's own best match. "none" means that nothing of that kind was reconstructed from it. This alone is not an
  inefficiency: the particle may never have reached that detector. Hit-based association weights (tracks) are
  counted in hits;
- the number of hits it left, per detector.

**Every association**, folded: each object that an association in the file links to the selection, with the
relation's weights as stored (shared energy, score, a hit's simulated energy), best first. These are the associator's
other partners behind the best match, for example every particle that shares an impure trackster.

**The pair** that the view is coloured by ([above](#the-pair-view)), as two bars under the chain:

- the particle's energy: where its simulated energy went, naming the detector and the amount in the sensors ("in
  HGCal · 0.2 GeV in the sensors");
- the candidate's energy: where its hit energy comes from.

These bars compare the whole generator particle with its candidate, hit by hit. The match's purity and completeness
are the associator's, for the selected object.

**The columns**: the layer's `inspect` columns (for example a jet's pT, η and φ). For a layer with `fractions`, its
reconstructed energy fractions, as one bar in a neutral grey ramp (a reconstruction quantity, not one of the view's
colours). Every other column is folded under them.

## Expressions

Filters, custom columns and the `where` of summaries are expressions. They may use column names, numbers, `pi`,
`+ - * / % ^`, comparisons, `&& || !`, parentheses and a fixed list of Math functions. The viewer parses them; it
never runs them as JavaScript (`viewer/src/model/expr.ts`).

## The address

The address keeps what a link needs:

- the bundle, the event and the view;
- the part of the detector (`All` when a bundle that opens on one part shows everything);
- a kind of object shown alone (`only`);
- the selection, and the level shown (`lv`);
- the truth colours (`c=truth`).

They are in the part after `#` (`#b=…&e=…`). A query (`?b=…&e=…`) is read too.

- `b` is the bundle's path, relative to the site: `data/u/<login>/<name>.evdb` for a file in a user area.
- `e` is the event's position in the file, counted from 0. The top bar counts from 1. It is not the event number:
  type the event number in the **Event…** box.

A local file is not written to the address.

**Remembered in this browser, not in links:** custom columns, filters, colour choices and the active preset (per
profile), the theme, the width of the side panel, the login you typed, and the recent data sets.
