# Viewer

The viewer is a static web page (TypeScript, Preact signals, three.js). It reads bundles over HTTP range requests.
When it opens a bundle, it reads the header and the index. Then it reads one event with one request each time you
show an event. The bundle's display hints say what to draw and how ([Bundle format](format.md)).

This page describes every part of the viewer. For a short first tour, see
[Getting started, step 4](getting-started.md#step-4-look-at-the-event).

## Data sets

The button at the left of the top bar shows the name of the data set that is open. Click it to open the **data set
chooser**. It has a filter and three kinds of list:

- **My files**: the bundles you published to this site with `ember FILE.root`
  ([Publish to a site](how-to.md#publish-to-a-site)). The newest come first. Each shows its number of events and when
  it expires. This list is your user area on the site, `data/u/<login>/index.json`.
- **Recent**: data sets you opened from someone's link, and local files by name. The list holds up to 12 and is
  remembered in this browser. You cannot open a local file again from this list: drop it on the page again.
- **The site's shared groups**: samples and test-stand data that the site keeps. They come from the site's
  `index.json`, which the viewer reads again every 30 s while the page is visible.

Other people's files are in no list. You reach them only through a link.

A data set chosen in the chooser opens on the event shown (the same run, lumi section and event) when it has it, so
the same event can be compared in two data sets, for example TICL v5 and v6. It says which event it opened on either
way: simulated samples all start at Run 1 · LS 1, so the same numbers in two of them need not be the same collision.
When it does not have the event, it opens on its first event.

In the chooser, type to filter. Use ↑ ↓ and Enter to open a data set, and Esc to close the chooser. **Open a local
file…** at the bottom picks a `.ember` file (or a `.evdb` file, from before the project was called Ember) from your
computer. Dropping a file on the page does the same.

The chooser also describes the data set that is open, under **Details**: who published it, when it expires, which
converter made it and, when the bundle records it, which CMSSW release wrote its input.

**Who "my" is.** The page asks the site who is signed on (`whoami`, see
[Hosting](hosting.md#who-is-looking-whoami)). If the site does not answer, the chooser asks for your CERN login once,
and remembers it in this browser. Click "not you?" to make it forget.

**When there is nothing to show.**

- An address with no data set in it opens the newest shared data set. If there is none, it opens your newest file.
- A site with no data set at all shows a start panel. It says what the page is and gives the three ways to get
  events in: convert a file with `ember` (published to the site only where the site is set up for it), open a local
  file, or follow a link.
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

The link does not keep the cuts, the ticked collections or the camera. A link with a selection opens with the object
framed beside its card. Without a part of the detector (`d`), it opens in the selected object's own part. A local
file has no link: the button says so, and explains how to publish the file.

The address bar always holds the same link. [The address](#the-address) lists what it keeps.

## Saving a picture

**Menu → Save picture…** saves the view alone as a PNG: without the side panel, the card, the labels or the axes.
Choose 1×, 2× or 4× the view's size on screen; lines and markers keep their size relative to the picture, so it looks
like the screen, only sharper. The caption, on by default, is the view's title and its line of physics objects. A
graphics card that cannot draw the size asked for says so; choose a smaller one. A 4× picture of a view of 1260 × 890
pixels takes about 72 MB for its pixels, and its antialiasing several times that on the graphics card, for the moment
it is drawn.

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
| zoom to an object | double-click it, or `F`: it fills the part of the view the card leaves free |
| show the whole event | `Home`, or Reset |
| go back to the normal view, or close a dialog | `Esc`, or click on empty space |
| previous / next event | `←` / `→`, or the arrows at the top |
| go to an event | type `run:lumi:event`, `run:event` or the event number in the box next to the arrows, then Enter |
| find objects in the event | type a kind in the same box, optionally with a condition on its columns: `electron`, `jet pt > 50`. The largest that passes is selected |
| resize the side panel | drag its edge; double-click the edge to reset it |

**Parts of the detector.** Press `D` (`Shift+D` to go backwards), or use the **Look at** bar at the top: Physics ·
Tracker · … · All. The bar appears for a bundle whose header has `domains`. Below 1100 px of width it becomes a
drop-down list. Looking at one part:

- draws that part's layers and the layers of no part (truth). The layers of shared parts (the physics objects: jets,
  MET, leptons) are drawn over it only when the **Physics overlay** chip, above the view buttons, is on (off again
  for each data set; links do not keep it). A selected
  object still brings what it is part of (a muon's jet), drawn faded with everything else not related to it;
- frames the part's region, in the part's own view;
- opens the part's tab in the side panel. Choosing a tab yourself does not change the view.

The side panel keeps your ticks. A shared part (for example **Physics**) draws only its own layers and the layers of
no part. A bundle opens on the part named in its `view.domain`. A selected object stays selected when you change
part: the view frames the object's pieces in that part, and `D` skips the parts where it has nothing.

**Hints.** On a first visit, a line at the bottom left of the view names the keys to start with: click an object,
`X` for its truth and `T` for truth colours (when the bundle has truth), `D` for the parts of the detector, `?` for
help. **Got it** hides it for good in this browser; the line then says only "Click an object to select it · ? help".

**The view's title.** The top left of the view says what is on screen, so that a screenshot says it too:
`SIMULATION · ttbar 0PU · Run 1 · LS 1 · Event 18`, or `DATA · Run 392294 · LS 21 · Event 11805516`. Under it is the
event in one line, as at the top of the Physics tab ("Jets 4 · Electrons 0 · … · Puppi MET 38.1 GeV"). No header
field says whether a bundle is simulation: the viewer calls an event simulated when the bundle has truth or the run
is 1 (CMSSW numbers every simulated run 1). A simulated event is named by the first part of the data set's title,
and data by their run.

### Selecting an object

**Click an object** to select it. If objects lie on top of each other, click again on the same spot to get the next
one. Further clicks on a selected object pick among its parts.

The selected object stands out in the view:

- it gets a ring and a filled label, whatever the labels setting;
- its colour moves halfway to white on the dark theme, or to black on the light theme, so it keeps its hue;
- a line becomes a ribbon three times as wide, and a marker becomes larger;
- a line (a track, a particle, a muon's path, MET) gets a halo in the accent colour, a few pixels wider than the
  line, so even a track one pixel wide is found at once;
- everything not related to it fades 85 % of the way to the background: hits, clusters, tracks, jet cones and their
  outlines, the MET arrow and the detector's outlines alike. Showers not related to it are not drawn.

The view then shows the object with its smallest parts, one kind per branch. Parts drawn as lines do not hide the
others. For example, a candidate is shown with its calorimeter hits, its track and the track's hits; a vertex with
its tracks and their hits. Related objects are highlighted: a track shows its vertex and its truth particle.

The parts are drawn even where a layer's default filter would hide them. Cuts and filters that you set still apply.
The selected object itself is always drawn, whatever the cut, but the hits of parts that a cut hides are not.

The selection's **card** opens on the right. It shows the object's chain, with what the truth says at every step
(see [The selection's card](#the-selections-card)).

**Framing.** `F`, a double click, the card's zoom button, `X`, back (`B`) and a link with a selection frame the
object in the part of the view the card leaves free (left of it, or below it on a narrow screen), so the card never
covers it. What is framed is the object and its parts. Objects only linked to it, such as its truth particle or a
track's vertex, are not: a low-pT particle's helix can curl far from its track. Clicking an object does not move the
camera.

**Next object.** `N` selects the next object of the same kind, largest first. `Shift+N` goes back. The order is the
order of the list that the row's count opens, for example the next jet by pT, or the next track. This works for every
kind except hits. With nothing selected, `N` selects the leading object of the first layer with labels.

**Labels.** `L` shows labels on the leading objects of the layers that have a `labels` hint (for example the 4
leading jets, and MET). These labels appear in a shared part's view (Physics). The selection is labelled in every
view. A label sits at the far end of a line or cone (where a jet meets the calorimeter), or else at the object. It
never sits under the card: it moves to the left of its object instead. Where labels would overlap, the less important
one moves left or hides: the selection's label goes first, then the focus's, the object you point at in the side
panel, and the leading objects, largest first.
Labels, chips and lists name the quantity of every number: "Jets · pT 49.7 GeV" (transverse momentum),
"π⁺ · E 88.9 GeV" (a truth particle's energy), "E raw 178 GeV" (a TICL candidate's raw energy). Pointing at an
object's row in the side panel rings the object in the view.

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
candidate trackster, linked tracksters, tracksters and layer clusters (in a TICL v6 export, its interpretation in place
of the candidate trackster). The object itself is drawn as an outline around the step. A caption on the view says
for a moment what is drawn, for example "Drawing: Tracksters · 2 · step 3 of 5".

- A step with several layers (for example two linking algorithms) draws the layers ticked in the side panel, or all
  of them if none is ticked.
- In a bundle with parts of the detector, `↓` / `↑` go through the steps of the part you look at (and of the shared
  parts). A step in another part names that part, for example **Tracker ›**. Click it to look at that part, keeping
  the object.
- In All, steps of different parts at the same depth are drawn together, for example a jet's tracks and clusters.

**Cross to the truth, and back.** Press `X`, or click the particle on a step's match line.

- From a reco object, `X` goes to the associator's best match. For a hit, it goes to the particle that left the most
  simulated energy in it. A kind with no truth of its own (a layer cluster, a TICL candidate) has none to go to: step
  to one of its parts.
- From a truth object, `X` goes to a reco object of the latest reconstruction step. It picks the object whose best
  match is this truth object. If there is none, it picks the object that holds most of the truth object.

### Showing less

**One kind of object alone.** Click **only** on a kind's heading in the side panel, for example to show only the
tracks, only the jets or only the PF candidates. A heading is a kind in one part of the detector: HGCal's hits, not
the barrel's.

- The viewer then draws the kind's ticked collections and nothing else, whatever part of the detector you look at.
  If none is ticked, it draws all the kind's collections.
- Selecting an object brings back its parts and its truth.
- "show everything" on the view ends it. A replay or a tour also ends it. Your ticks are kept.
- On a kind that is drawn only for a selection (such as the hits on tracks), **only** also switches it to **all**
  of its objects while it lasts, so the view is not empty.

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
detector's hits to the physics objects (`viewer/src/model/tourPlan.ts`). The steps are: collision point, tracks (with
their hits, and the timing layer in Phase 2), calorimeter hits, clusters, HGCal showers, muons, particle flow, jets,
leptons with photons and missing momentum, b tagging. An event of the whole detector takes under a minute.

- Each step shows the layers of its kinds (display hint `kind`): the layers shown by default, or else all of them.
  They grow in outwards while the camera frames them, with a caption in plain words.
- A step with nothing in the event is skipped.
- After the steps, the tour shows the bundle's own view (its starting part of the detector). It visits its leading
  labelled objects one by one (or else its main showers), then goes on to the next event.
- A bundle with fewer than two such steps (test beam, cosmics) replays each event instead, then visits its main
  showers.
- Any key or touch stops the tour and brings back your layers.
- Planned: a speed control in the tour bar (1×, 1.5×, 2×, remembered in this browser), and → to go to the next
  step.

## Side panel

From top to bottom, the side panel has:

1. the **Preset** list, when the bundle has more than one preset, with a button to apply the chosen preset again.
   This undoes filters and colours that you changed by hand. A preset ticks the layers it colours. A preset that
   needs a table or a column the bundle lacks is not offered;
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
- it applies to every layer of the group, including layers listed elsewhere (the pop-up names them);
- it is named after the cut's `label`, or else its group ("hit energy ≥ 35 MeV"), never the raw column. Energies
  below 1 GeV are given in MeV;
- the pop-up opens beside the panel, so the counts of the rows it cuts stay in sight.

A kind with several cuts (one per calorimeter) shows each cut on the first row it cuts, without the row's name
("energy ≥ 1 GeV" on the ECAL barrel row). A long name wraps onto a second line instead of being cut short.

A kind with several collections, and each part of the detector in the Detector tab, has a tick of its own on its
heading: one click ticks all of its collections, or unticks them all when all are ticked. It is half ticked when
only some are.

Clicking a kind's heading folds it. The folded heading says how many of its collections are drawn. This lasts for
the life of the page. A slider shared with a later kind moves to that kind.

**One row per layer** shows: a visibility tick, the name, its state as chips, its count and **⋯**. Under the row
there is its colour scale, if the colour key does not already explain it. The chips are:

| chip | meaning |
|---|---|
| **filter** | the layer has a filter. Click to see the expression and remove it. |
| **with selection** / **all** | for an `onSelection` layer: drawn only with the selected object, or all of its objects. Click to switch. |
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
or no truth. Hover for the reason. Where a kind's layers differ, each row gets its own word. The rows of
kinds without truth are faint.

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
- what became of each particle that left hits: in each detector it left them in, its best match among the kind
  compared there (HGCal: candidate tracksters; ECAL, HCAL: PF clusters), "none", or "not compared" where that
  detector's reco has no association;
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
  reconstruction gave them, one colour per type in every layer: PF and TICL candidates of a type look the same, and
  the physics objects (electrons, muons, photons) take their type's colour.

  | type | dark theme | light theme |
  |---|---|---|
  | charged hadron | orange | orange |
  | electron | blue | dark blue |
  | muon | red | dark red |
  | photon | pale blue | light blue |
  | neutral hadron | green | green |
  | neutral pion (TICL) | pale yellow | deep violet |
  | HF hadron, HF EM | muted green, grey blue | muted green, grey blue |

  Jets are lavender, a colour no type has, so the tracks inside a jet's cone stay visible. Everything candidates are
  made of takes the same colour: interpretations and tracks (their
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
    kind's `match.good`: 75% of a track's hits, or 50% of a trackster's energy. Otherwise the object is grey;
  - a kind with no association of its own (layer clusters, TICL candidates, PF candidates, jets) is drawn faint and
    neutral: Ember does not work out a particle for it from its hits;
  - layers with no link to the truth (vertices) are the "no truth" grey;
  - only signal generator particles get colours, by energy. The other signal particles are mid grey. Pile-up has its
    own warm grey and is drawn small;
  - hits in which no exported particle left energy are small and faint: noise, out-of-time pile-up, or a particle
    that was not exported.

  The Truth mode needs a bundle whose truth particles name their level (`particle`). Older bundles have only Reco.
- **Layer colours.** A bundle without candidates or truth shows each layer's own colours from the profile (energies,
  particle types), with the scale under the layer's row. A part of the detector with `colourMode` `"layers"` does the
  same while you look at it in the Reco mode, for example the Tracker, with its tracks by pT.

### The pair view

With truth in the file, selecting a truth particle, a reco object of a kind with an association (a track, a PF
cluster, a trackster), or a hit shows its truth ↔ reco pair (`viewer/src/model/pair.ts`), in either mode.
[Truth](truth.md#the-pair-view) has the rules; in short:

- **Truth: one branch.** The selected particle and everything below it. A reco object takes its best match (the
  associator's), a hit the particle that left the most simulated energy in it. Not its siblings, not the generator
  particle above it: to see a larger branch (a W's, a B hadron's), select the parent in the card's lineage. A particle
  inside another's shower (a brem photon) has no hits of its own in the file: the pair shows that shower's, and says
  so; its matches stay its own.
- **Reco: per detector.** In each detector the branch left hits in, the kind the associator matches there (HGCal: the
  candidates' tracksters; ECAL, HCAL: PF clusters; the tracker: tracks) and the branch's best matches among them. A
  detector whose reco has no association (HF, HO) is drawn, but not compared.
- Kinds without an association of their own (PF candidates, jets, TICL candidates, layer clusters, muons) open no
  pair: they show their own levels and links, and their card names their parts' matches as the parts'.

Every layer is coloured by where its objects ended up:

| class | meaning |
|---|---|
| shared | the branch's, in its match: hits where the branch left the most simulated energy, and the matched objects |
| contamination | in its match, from other particles or from none |
| split off | the branch's, in another object of the kind compared, and that object (also an object matched to the branch that is not its best: a fragment) |
| missed | the branch's, in no object of the kind compared |
| in its match | parts of a matched object that have no truth of their own (a trackster's layer clusters, a track's hits) |
| branch | other particles of the branch that entered the calorimeter on their own (a conversion's electrons, an interaction's products) |
| not compared | the branch's hits in a detector whose reco has no association |

Everything else fades. The colour key lists only the classes in view.

The selection's card names the branch (and, when the selected particle is inside another particle's shower, which
shower's hits stand for it), then gives one block per detector:

- what it is compared with, and the matches, as chips;
- **simulated energy of the branch**, not calibrated: in its match, in other objects of the kind, in none; and how
  much of it is the particle's own shower and how much its descendants';
- **its match's rechit energy**: from the branch, from other particles, and with no simulated energy, each hit split
  by the simulated energy each particle left in it.

Simulated energy is never added across detectors. These bars are not the associator's purity and completeness of the
selected object: those are on its truth card.

The levels drawn on request are those of the matched object the pair comes from, whichever of its parts is selected.

### Colour choices

The colours are Okabe-Ito and Tol hues, checked for protan, deutan and tritan colour vision. The particle types have
fixed colours of their own, chosen so that the tracks (charged hadrons, electrons, muons) are far apart, also in
simulated colour-blind vision. Other categories, such as a hit's subdetector, take colours kept apart from the types,
so a pixel hit never looks like a charged hadron. Electrons and photons, both electromagnetic, are two blues: less
apart than the tracks, but still clearly different. Choosing a colour for one layer (in its **⋯**) overrides the particle type and the pair view for that layer. The
replay keeps each candidate's colour throughout.

## The selection's card

The card is the same for every kind of object (`viewer/src/ui/Card.tsx`). It shows names, bars and numbers.
More is behind small buttons:

- the table's description is behind the **i** next to its title;
- what the chain's words mean is behind the chain's **i**;
- what a step's tag means on that step is behind the tag itself: click "match", "fact" or "no truth".

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
- what it is **made of**: from the largest objects down to the hits, one branch at a time. A jet's PF candidates come
  first, then their TICL candidates down to the HGCal hits, then their tracks down to the track hits. A step comes
  right after the last step that holds it, indented under it, with its other holders named: "also via PF
  candidates" on tracks listed under a jet's TICL candidates;
- what is **also inside it**, listed apart: objects built only from its parts that are not parts of it. For example
  a secondary vertex whose tracks are all in the jet, or a tau made of its PF candidates.

A step names its objects when there are three or fewer. Otherwise it counts them and unfolds to a list, largest
first. Every object is a button that moves the selection there.

Each kind's name says, on hover, what that kind of object is, where the bundle's profile explains it (the same text
is behind the kind's **i** in the side panel). For example, the TICL kinds: tracksters (CLUE3D), linked tracksters
(TICL's linking), and candidate tracksters (one per TICL candidate, written with the candidates).

For some objects, no relation in the bundle says what contains them. For example, nothing says which linked
trackster, interpretation and candidate contain a trackster. Then Ember works it out: the card shows the object that
holds the most of the trackster's parts, if it holds at least half of them, and marks it "≈ holds 3 of its 4
parts". An object that
contains the selection is never listed among its parts.

Related rows of tables that the bundle does not draw (for example a hit's digi) are listed last, as **other
tables**.

**Every step says what the truth graph has for it**, in the words of [Truth](truth.md#where-truth-stops):

| tag | what the step shows |
|---|---|
| match | For one object: the associator's best match and its purity (green from the kind's clean threshold, amber below), or "no match" (a fake, or an object that the associator does not consider, such as a candidate without calorimeter energy). For several objects: their counts, in the colours of their dots, for example "11 clean · 4 impure · 1 no match". |
| fact | The particles that left the simulated energy in the step's hits, with their shares, one line per detector (never summed across detectors). "per CSC layer" where the simulation records a coarser unit than the hit. "no exported particle" where none left energy (noise, out-of-time pile-up, or a particle the export left out): the tag says so. |
| no truth | The tag alone. Behind it: why CMSSW has no truth for the kind, with the gap number of [Truth graph](truth-graph.md). A part with no truth of its own that goes with its container (the hits of a track) has no line. |

Each line is the step's own statement. No match is built through the parts ([Truth](truth.md#constituents)):

- Under an object whose kind has no truth of its own (a jet, a PF candidate), a step of several parts counts their
  own matches ("9 of 9 matched · 9 clean") but names no particle. Its hits and layer clusters say only that the
  statement is on each of them ("on each hit: select one for its particles"). A ranking of the particles in a jet's
  hits would be a match through hits.
- One part alone speaks for itself (for example a candidate's track).
- Under a kind with truth of its own (a trackster, a PF cluster, a track), the particles are listed.
- Where a step's collections differ in truth (muon rechits: fact; hits on muon tracks: none), each line names its
  collection.

When a kind gets an associator in CMSSW, it gets a `match` relation in the profile. Its steps then show the match,
with no change to the viewer.

**The levels in the view.** Sometimes the view is built around an object other than the selection: the pair's
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

**The pair** that the view is coloured by ([above](#the-pair-view)): the branch, then one block per detector with
what it is compared with, its matches, the branch's simulated energy (in its match, in others, in none; own shower and
descendants') and the match's rechit energy (from the branch, from other particles, with no simulated energy). Each
bar names its energy. The match's purity and completeness are the associator's, for the selected object.

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

- `b` is the bundle's path, relative to the site: `data/u/<login>/<name>.ember` for a file in a user area.
- `e` is the event's position in the file, counted from 0. The top bar counts from 1. It is not the event number:
  type the event number (or `run:lumi:event`) in the event box.

A local file is not written to the address.

**Remembered in this browser, not in links:** custom columns, filters, colour choices and the active preset (per
profile), the theme, the width of the side panel, the login you typed, the recent data sets, and whether the
first-visit hints were dismissed.
