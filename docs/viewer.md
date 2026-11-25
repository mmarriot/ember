# Viewer

The viewer is a static web page (TypeScript, Preact signals, three.js). It reads bundles over HTTP range requests.
When it opens a bundle, it reads the header and the index. Then it reads one event with one request each time you
show an event. The bundle's display hints say what to draw and how ([Bundle format](format.md)).

This page describes every part of the viewer. For a short first tour, see
[Getting started, step 4](getting-started.md#step-4-look-at-the-event).

## Data sets

The button at the left of the top bar shows the name of the data set that is open. Click it to open the **data set
chooser**. It has a filter and three kinds of list:

- **Recent**: data sets you opened from someone's link, and local files by name. The list holds up to 12 and is
  remembered in this browser. You cannot open a local file again from this list: drop it on the page again.
- **The site's shared groups**: samples and test-stand data that the site keeps. They come from the site's
  `index.json`, which the viewer reads again every 30 s while the page is visible.
- **My files**, last: the bundles you published to this site with `ember FILE.root`
  ([Publish to a site](how-to.md#publish-to-a-site)). The newest come first. Each shows its number of events and when
  it expires. This list is your user area on the site, `data/u/<login>/index.json`. Before you publish any, it says
  how to.

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

**⚙ menu → Save picture…** saves the view alone, without the side panel, the card, the labels or the axes, with what a
figure needs drawn over it: the experiment's label in the CMS style ("**CMS** *Phase-2 Simulation Private Work*" for
Phase-2 simulation, "*Simulation Private Work*" for other simulation, "*Private Work*" for data), a caption (the
event), and the colour key: what each colour in the view means, as the side panel's key and each collection's scale
say it (the truth particles, the candidate types, the truth ↔ reco pair of a selection, an energy ramp, ...), without
the collections that draw nothing.

The dialog shows the picture as it will be saved. Everything over the view can be changed there: retype the label and
the caption, rename a line or a title of the key or leave it out, change the text size or the panel behind the text,
and drag the label and the key anywhere on the picture (the key goes under the label where the two would meet). The
choices are kept in the browser for the next picture, so a series of pictures looks the same; a renamed line stays
renamed in every event; **Reset** goes back to the defaults. Papers usually want a white background: the dialog
offers the light theme.

- **Save PNG**, at 1×, 2× or 4× the view's size on screen; lines and markers keep their size relative to the picture,
  so it looks like the screen, only sharper. The file says in its text fields what it shows and where it comes from:
  the link to the view (a local file: its name), which opens the data set, event, part of the detector, selection and
  colours again (not the camera).
- **Save SVG**: the view as an image, the label, the caption and the key as text and shapes over it, to edit further in
  Inkscape or Illustrator. `rsvg-convert -f pdf -o picture.pdf picture.svg` makes a PDF of it with the text as text.
- **Copy** puts the PNG on the clipboard, to paste into a slide or a message.

A graphics card that cannot draw the size asked for says so; choose a smaller one. A 4× picture of a view of 1260 × 890
pixels takes about 72 MB for its pixels, and its antialiasing several times that on the graphics card, for the moment
it is drawn. Drawing the view again holds the page for that moment: seconds for an event at 200 pile-up.

## Controls

Press `?` for the viewer's help. It lists the same controls as this section, grouped, with their keys. The menu
(**⚙** in the top bar) also has every control of the view in one place, grouped as View, Event, Selection, Colours and
Play. It shows each control's key and whether it is on. Esc closes the menu. **☀ / ☾** in the top bar switches between
the dark and the light theme.

### Moving around

| to | do this |
|---|---|
| rotate | drag |
| pan | right-drag, or shift + drag |
| zoom | scroll (it zooms towards the cursor) |
| switch view: 3D, front, side, ρ–z | `1`, `2`, `3`, `4`, or the buttons at the bottom left of the view (in the top bar for a bundle without parts of the detector) |
| zoom to an object | double-click it, or `F`: it fills the part of the view the card leaves free |
| dim, fade or hide the rest of the event around a selection | `H`, or **Others** at the bottom left of the view while something is selected |
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
- opens the part's section in the side panel's **Reconstruction** tab. Choosing a tab yourself does not change the view.

The side panel keeps your ticks. A shared part (for example **Physics**) draws only its own layers and the layers of
no part. A bundle opens on the part named in its `view.domain`. A selected object stays selected when you change
part: the view frames the object's pieces in that part, and `D` skips the parts where it has nothing.

**Hints.** On a first visit, a line at the bottom left of the view names the keys to start with: click an object,
`X` for its truth and `T` for truth colours (when the bundle has truth), `D` for the parts of the detector, `?` for
help. **Got it** hides it for good in this browser; the line then says only "Click an object to select it · ? help".

**The view's title.** The top left of the view says what is on screen, so that a screenshot says it too:
`MC · ttbar 0PU · Run 1 · LS 1 · Event 18` (MC: simulated), or `DATA · Run 392294 · LS 21 · Event 11805516`. Under it
is the event in one line: the physics objects that pass their cuts ("Jets 4 · Electrons 0 · … · Puppi MET 38.1 GeV"). No header
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
- it is drawn in front of everything else, so a block of the rest nearer the camera never covers it;
- everything not related to it, the rest of the event, is drawn as you choose with **Others** at the bottom left of
  the view (or `H`, which steps through the three): **Dim** fades it 85 % of the way to the background, so it stays
  readable around the selection; **Faint** (the default) 95 %, a trace of it; **Hide** does not draw it at all, so
  a picture shows only the selection, its parts and its truth. Hits, clusters, tracks, jet cones and their outlines
  and the MET arrow alike. The detector's outlines, and a layer drawn as the detector's context, are dimmed whatever
  the choice. Showers not related to it are not drawn. The choice is remembered in this browser.

**What is drawn is what is ticked.** The ticks in the side panel are the only on/off switch: a selection never draws a
collection you unticked, and never hides one you ticked, in the reco view as in the truth ↔ reco pair. It brings
forward the object's own objects in the ticked collections and fades the rest. For example, a candidate is shown with
its layer clusters and calorimeter hits, its track and the track's hits (if those are ticked); a vertex with its
tracks and their hits. Related objects are highlighted: a track shows its vertex and its truth particle. Two things
are drawn although the view would leave them out:

- the selected object itself, also when its collection is unticked (for example one picked on the card's chain), and
  the object it was picked in; only those, not the rest of their collection, and the row says **selected**;
- the selection's objects in a ticked collection of a part of the detector you are not looking at (a candidate's
  track while you look at HGCal), or of another kind than the one looked at with **only**.

The parts are drawn even where a layer's default filter would hide them. Cuts and filters that you set still apply.
The selected object itself is always drawn, whatever the cut, but the hits of parts that a cut hides are not.

The selection's **card** opens on the right. It shows what the truth says about the object first, then what it is
made of and its chain (see [The selection's card](#the-selections-card)).

**Framing.** `F`, a double click, the card's zoom button, `X`, back (`B`) and a link with a selection frame the
object in the part of the view the card leaves free (left of it, or below it on a narrow screen), so the card never
covers it. What is framed is the object and its parts. Objects only linked to it, such as its truth particle or a
track's vertex, are not: a low-pT particle's helix can curl far from its track. A vertex is framed at its own place,
as closely as its tracks' part of the detector allows (the tracker's `minRadius`, 15 cm: about the pixel volume), not
with the whole length of its tracks. In a part of the detector, what is framed is the object and its parts in that
part, as when the part is chosen: a TICL candidate in HGCal is framed by its shower, not by its track from the vertex.
An object drawn as a line from the vertex (an electron, a truth particle) is framed by its parts there alone: a
particle picked in the Truth tab's Particles in this view by its hits in HGCal.
Clicking an object does not move the camera.

Clicking a **hit** shows the hit: its card names the simulated energy each particle deposited in it (not
calibrated). Its particle's truth ↔ reco pair is one button away ("Show π⁻'s pair in the view"), not drawn at once.

**Next object.** `N` selects the next object of the same kind, largest first. `Shift+N` goes back. The order is the
order of the list that the row's count opens, for example the next jet by pT, or the next track. This works for every
kind except hits. With nothing selected, `N` selects the leading object of the first layer with labels.

**Labels.** `L` shows labels on the leading objects of the layers that have a `labels` hint (for example the 4
leading jets, and MET). These labels appear in a shared part's view (Physics). The selection is labelled in every
view. A label sits at the far end of a line or cone (where a jet meets the calorimeter), or else at the object. It
never sits under the card: it moves to the left of its object instead. Where labels would overlap, the less important
one moves left or hides: the selection's label goes first, then the focus's, the object you point at in the side
panel, and the leading objects, largest first.

**One name everywhere** (`viewer/src/model/event/describe.ts`). An object has the same name in its label, its card,
its chip in a list, the side panel's row and the shared link's description: "Jet 1 · AK4 · pT 99.6 GeV". It
reads:

- the kind, in the singular ("Jet", "Primary vertex", "Puppi MET");
- its number, from 1, by the column its side-panel rows are sorted by (and `N`, `Shift+N` step by) among the
  objects of its collection in this event: by pT for jets and leptons, so the leading electron is "Electron 1"; by
  energy for superclusters, clusters and tracksters. Hits, truth particles, and primary vertices (whose sort column
  the file lacks) keep their place in the collection. The number counts all the collection's objects, also those a
  cut or filter hides, so a filtered list may start at 2. The address keeps the row in the collection (`s=Electron:3`, from 0). A
  one-object table such as MET has no number;
- its collection, where the kind has several ("AK4" and "AK4 CHS"; "Standalone" and "Global" muon tracks). Where
  the layer's label adds nothing to the kind (the electrons beside "Electrons (HGCal)"), the CMSSW collection named
  in the table's description stands for it ("gedGsfElectrons"). The card names the collection and the CMSSW
  collection on a small line under its header, so the header stays short. A label in the view names it only while
  objects of another collection of the kind are labelled too, and then by the words that tell them apart ("Jet 1 ·
  PUPPI" and "Jet 1 · CHS" of "AK4 PUPPI (raw, no JEC)" and "AK4 CHS (raw, no JEC)"). Labelled, not shown: a label
  hidden by an overlapping one still counts, so the names do not change as the camera moves;
- its values, each named after its quantity: "pT 49.7 GeV" (transverse momentum), "E raw 178 GeV" (a TICL
  candidate's raw energy). A truth particle is named by its pT and η ("π⁺ · pT 30.1 · η 0.714"), or by its energy
  next to a calorimeter object ("π⁺ · E 88.9 GeV").

Numbers are written in a unit that suits their size, never in e-notation: lengths in µm below 1 mm and in mm below
1 cm ("6.57 µm"), energies in MeV below 0.1 GeV ("35 MeV"). A value that means "not set" reads as words: "no time"
for a time of -99, "not set" for an unset width of -1, "none" for an index of -1. The bundle's column description
("-99: none") or the layer's `missing` hint says which value that is.

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

**Step through what the object is made of.** Each step of the chain is drawn when its collections are ticked. For a
TICL candidate, the steps are its candidate trackster, linked tracksters, tracksters and layer clusters (in a TICL v6
export, its interpretation in place of the candidate trackster); by default only the layer clusters are ticked.
Click **show** on a step to tick its collections, **shown** to untick them. Press `↓` / `↑` to move the tick from
one step to the next: the step you move to is ticked and the object's other steps in between are unticked, so they
are drawn one at a time and do not cover each other. `↓` / `↑` go through the object's own parts only; what is only
built from them (a jet's taus) has its own **show** button. The ticks change in the side panel too, and stay when the
selection ends. The object itself is drawn as an outline around the first step ticked. A caption on the view says
for a moment what is drawn, for example "Drawing: Tracksters · 2 · step 3 of 5".

- Ticking a step with several layers (for example two linking algorithms) ticks all of them.
- In a bundle with parts of the detector, `↓` / `↑` go through the steps of the part you look at (and of the shared
  parts). A step in another part names that part, for example **Tracker ›**. Click it to look at that part, keeping
  the object.
- In All, steps of different parts at the same depth are drawn together, for example a jet's tracks and clusters.

**Cross to the truth, and back.** Press `X`, click **Go to truth (X)** in the card's truth block, or click the
particle on a step's match line.

- From a reco object, `X` goes to the associator's best match. For a hit, it goes to the particle that left the most
  simulated energy in it.
- An object of a kind with no truth of its own (an electron, a jet, a TICL candidate) has none to go to. When the
  card's truth line names a part's particle (its track's, its one PF cluster's), `X` goes there; so it does when its
  parts are matched to one particle only. Otherwise `X` opens a small chooser in the card: the particles its parts are
  matched to (the first eight), each named with its part ("π⁻ · its track · purity 100%"). Among parts whose matches
  count the same thing, the larger part comes first (a cluster's energy, a track's pT), so that a pile-up photon's
  1.85 GeV cluster never comes before a τ's 96 GeV one; parts counting different things keep the chain's order, since
  a track's pT is not compared with a cluster's energy. Objects only built from its parts (an electron's PF clusters)
  come after its own parts. Pick one, or press `X` again for the first; `Esc` closes it. With no matched
  part, the button is off and says why.
- While another object is looked at, `X` crosses from that object; the card's **Go to truth (X)** crosses from the
  card's own object.
- From a truth object, `X` goes to a reco object of the latest reconstruction step. It picks the object whose best
  match is this truth object. If there is none, it picks the object that holds most of the truth object.
- `X` is a round trip: on the object `X` led to, it goes back to where it came from (an electron, its e⁻, the electron),
  until another event opens; the button then reads **Back (X)**. A reco object with a match of its own goes to its
  match instead, even when `X` came from another particle.

### Showing less

**One kind of object alone.** Click **only** on a kind's heading in the side panel, for example to show only the
tracks, only the jets or only the PF candidates. A heading is a kind in one part of the detector: HGCal's hits, not
the barrel's.

- The viewer then draws the kind's ticked collections and nothing else, whatever part of the detector you look at.
  If none is ticked, it draws all the kind's collections.
- Selecting an object brings back its parts in the ticked collections, and its truth.
- "show everything" on the view ends it. A replay or a tour also ends it. Your ticks are kept.
- On a kind that is drawn only for a selection (such as the hits on tracks), **only** also switches it to **all**
  of its objects while it lasts, so the view is not empty.

**What no later step uses.** In a collision event (a bundle with the **Look at** bar), the objects that the next step
of the reconstruction leaves out are hidden: HGCal hits in no layer cluster, ECAL and HCAL hits in no PF cluster, and
layer clusters in no trackster. Most such hits are noise; at 200 pile-up most layer clusters are in no trackster.
Cuts still apply to what is left (HGCal hits ≥ 35 MeV, for example). The row of each such collection has a chip,
**in clusters** (hits) or **in tracksters** (layer clusters), while the others are hidden; click it to draw **all**,
and again to go back. Its tooltip says how many are left out. A collection gets the chip only when the event has
something to leave out: in the test-beam bundles the clustering takes every hit, and they start with all drawn.

- A hit is used when a cluster that the bundle draws (a layer cluster, a PF cluster, a supercluster) lists it; the
  truth's links do not count, nor does a muon or a track crossing it. A layer cluster is used when a reconstruction
  step lists it (CLUE3D tracksters, trackster links, superclustering, the candidates' own tracksters). Tracksters and
  the collections drawn only for a selection (the muon chambers) have no chip.
- A selection still draws its own objects, used or not: a truth particle shows every hit it left energy in.
- Each chip acts on its own collection: the hits of a layer cluster in no trackster stay drawn (they are in a cluster)
  while that cluster is hidden.
- The rows' counts say how many are drawn ("4,709 / 51,730").
- In expressions, these tables have a column `clustered`: 1 for an object a later step uses, else 0 (for example a
  filter `clustered == 0` with **all** drawn, to see only the others).

### Colours

Press `T`, or click "Colour by: reco type | truth particle" in the colour key or in the ⚙ menu. This switches between the reconstruction
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
detector's hits to the physics objects (`viewer/src/control/tourPlan.ts`). The steps are: collision point, tracks (with
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
(a pop-up, `viewer/src/ui/common/Info.tsx`). The selection's card works the same way.

### The Reconstruction tab

The side panel's tabs are **Reconstruction** (what was reconstructed), **Truth** and **Metadata**.

With two or more parts of the detector (a header with `domains`, the **Look at** bar), every part's layers are in one
tab, **Reconstruction**, which follows the bar:

- it has one section per part, always in the bar's order (for example Physics, Tracker, Calo, HGCal, Muons). The part
  you look at is open and highlighted, in its place; the others are folded. In All, the shared parts (Physics: the event's objects)
  are open and the parts of the detector folded, so the tab starts as the event's summary over an overview of the
  parts: open the one you want;
- each section's heading says whether the view draws it: looked at, drawn (in All), drawn over (a shared part such as
  Physics with its overlay on), or not in this view. Hover to see what this means. **show** looks at that part;
- a collection the view does not draw (not ticked, or in a part not looked at) has its name muted, so the list says
  what is on screen;
- the cuts of a folded section still apply to a selection's objects there.

Without the bar there is one tab per part of the detector (display hint `domain`), for example **HGCal**. Bundles made
before layers had a part show one tab, **Objects**.

In each part, the collections are grouped by kind of object.

**A kind's heading** carries its cut as a chip, for example "pT ≥ 30 GeV" ("no pT cut" at 0). The chip is in the
accent colour when the cut differs from the profile's. Click it to open a slider in a pop-up:

- the slider has a log scale over the values of the group in the event shown. Its lowest position means no cut;
- it applies to every layer of the group, including layers listed elsewhere (the pop-up names them);
- it is named after the cut's `label`, or else its group ("hit energy ≥ 35 MeV"), never the raw column. Energies
  below 1 GeV are given in MeV;
- the pop-up opens beside the panel, so the counts of the rows it cuts stay in sight.

A kind with several cuts (one per calorimeter) shows each cut on the first row it cuts, without the row's name
("energy ≥ 1 GeV" on the ECAL barrel row). A long name wraps onto a second line instead of being cut short.

A kind with several collections, and each part of the detector in the Reconstruction tab, has a tick of its own on its
heading: one click ticks all of its collections, or unticks them all when all are ticked. It is half ticked when
only some are.

Clicking a kind's heading folds it. The folded heading says how many of its collections are drawn. This lasts for
the life of the page. A slider shared with a later kind moves to that kind.

**One row per layer** shows: a visibility tick, the name, its state as chips, its count and **⋯**. A kind's **only**
and a row's **⋯** show where the pointer is (always on a touch screen), so the list reads as names and counts. Under the row
there is its colour scale, if the colour key does not already explain it. The chips are:

| chip | meaning |
|---|---|
| **filter** | the layer has a filter. Click to see the expression and remove it. |
| **with selection** / **all** | for an `onSelection` layer: drawn only with the selected object, or all of its objects. Click to switch. |
| **selected** | the layer is not ticked, but the selected object (or the object it was picked in) is in it: that object alone is drawn |

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
example MET). A selected object that does not pass is not counted, and the headline says why: "Electrons 0 (+1
selected, below the electron pT cut)", or "left out by the filter" when the cut alone would keep it. The Physics
section has none: the view's title gives that line.

**In the truth colours**, each kind's heading gets one word for what the truth graph says about it: match, sim,
or no associator. Hover for the reason. Where a kind's layers differ, each row gets its own word. The rows of
kinds without truth are faint, with no line of their own under them: the colour key says it once ("faint: no CMSSW
associator for that kind", the kinds behind its **i**).

On a phone, the panel is a sheet under the view. It is folded to its tabs until you choose one.

### Truth tab

The tab is called **Tree** for a bundle with a tree but no truth layers: it lists what became of each of the tree's
objects that left hits, and the tree, which folds. With truth, from the top:

- **the levels**: a chip per truth level the graph can show, in the level's colour, with how many particles of the
  event are at it: hard process, b / c hadron, τ visible, reconstructable, entered the calorimeter, generator
  particle, and signal process where a truth preset set it. A click shows or hides that level's particles. The first
  four are on at first. The chips are the graph's legend: a particle at several levels shown takes the colour of the
  first of them in this order (`viewer/src/model/truth/levelGraph.ts` `GRAPH_LEVELS`);
- **the controls**: **Vertices hide | show** (the graph's vertices), **3D particle only | + descendants** (what the
  view draws of the particles picked: each one from the vertex it was made at to the one it ended at, or with
  everything below it; + descendants at first, as a truth particle selected anywhere else), a search box (the start of
  a name, `B`, `μ`; a pdgId, `511`; either sign, `|pdg|=11`), and "2 selected · clear" once particles are picked;
- **the graph**: the event's truth graph at the levels shown, as a tree that folds (▸ ▾), its lines joining each
  particle to the ones it made. The whole event hangs from its collisions, each a vertex (◆, its name in italics),
  where its particles came out of:
  - **◆ signal collision**, open, named by its beams ("p p, 14 TeV"), or where it happened when the file has no
    beams (a truth preset's bundle). Under it:
    - **◆ hard scatter**, open: the outgoing legs of the hard scatter (level HardProcess) under the particles they
      came from, so `t → b W⁺` and `W⁺ → s̄ c`, and everything below them (with the hard process hidden, what came
      from it stays here), unfolded down to the b / c hadrons and τ. A truth preset's signal process hangs here too;
    - **underlying event**, folded, with how many particles it lists: the rest of the signal collision. The
      generator's strings mix initial-state radiation, multiple interactions and the beam remnants, so they are not
      split further (a hadron at η 8 and one at η 1 can come from the same string).

    Without a hard process (a particle gun, also a truth preset's), the collision's particles hang straight under it;
  - **pile-up**, folded, with how many collisions: the other collisions of the bunch crossing (about 180 at 200
    pile-up), each a folded **◆** named by where it happened ("z -6.75 mm"), with the summed pT of the particles it
    lists and how many they are. The hardest (largest summed pT) comes first, so the order can change with the levels
    shown. Pile-up has no generator history, so its particles hang straight under their collision. A folded
    collision costs nothing to show.

  A particle row has its tick, a dot in its level's colour, its name and its energy. A particle that the generator
  wrote several times (status 23, 51, 1) is one particle ("s ×2"); particles at no level shown are skipped, so each
  particle hangs under the nearest ones above it that are shown. With **Vertices show**, the vertex where its
  daughters were made stands on their line, a grey ◆ with its process in italics ("decay", "hadronization"; "⋯" when
  particles were skipped in between); pointing at it (or a tap) names the particles in and out. A hadron made from
  several partons (a string between the b and the s̄) hangs under the one of highest energy and says "also from" the
  others (a click goes to it). "▸ 23 below" counts the particles at no level shown that it made; a click lists them
  under it (unfolding it), with a hollow dot, each folding its own. A list of more than 50 particles or collisions
  shows the 50 largest and "show 50 more". A particle selected elsewhere (in the view, `X`) is unfolded to and
  scrolled into view, the pile-up and its collision or the underlying event opening above it (one at no level shown
  under the particle it hides under). The particles the search finds are marked, and the way to the 20 largest is
  open while the search is typed (clearing it folds them back); the controls say how many it found, and Enter or
  "next" picks the next one. Where the panel is beside the view and tall enough, the levels and the controls stay at
  its top while the graph scrolls. In the tree, ↑ ↓ move between the names and → ← unfold and fold (there they do not
  step the event or the focus level).

  A click on a particle's name picks it alone: the card describes it, and the view draws it. Its tick adds it to the
  particles drawn (or takes it out); the card describes the last one picked. The hits and reco objects drawn, and
  **Others** around them, are those of the last one picked. **clear** picks none and closes the card. A truth
  particle selected elsewhere (in the view, from a card, `X`) is the one picked;
- **Details**, folded: the truth collections (Particles, Vertices) with their cuts, the particles in this view and the
  event's reco ↔ truth scorecard:
  - **Particles in this view**: for the part of the detector looked at, detector by detector, the particles that left
    simulated energy in its hits (from the hit index), largest first; in the tracker, which has no simulated energy
    in the file, the particles a track is matched to, by pT. Each row gives the particle (by its energy in a
    calorimeter, by pT and η in the tracker), in a calorimeter the energy it deposited there (column "deposited in
    HGCal": simulated, in MeV or GeV, not calibrated, and not the particle's energy), its best match among the kind
    compared there with that match's completeness ("51%", the column's "% of it"), "split n" when n objects of the
    kind hold part of it, and "shared +n" when n other particles have the same best match (a merge). A detector
    without an association (HF, HO) says "not compared". Sort by deposited energy (pT in the tracker), completeness or
    split; click a particle or an object to select it. Simulated energies of different detectors are never compared:
    a particle is listed in each detector it reached. Physics and All list every detector;
  - **the event's reco ↔ truth scorecard.** For each reco kind that a CMSSW associator matches, it counts how many of
    the objects that pass their cuts and filters are a clean match, an impure match, or are not matched
    (`matchTally` in `viewer/src/model/truth/match.ts`). Click a count to unfold its objects, largest first. So the
    event's merged, split and fake objects are one click away.

The truth coverage of each kind is in the Metadata tab.

### Metadata tab

The **Metadata** tab shows the run and event information, the bundle's `summaries` charts, and the source with every
table of the event. In a bundle with truth, **Truth coverage**, folded to one line of counts ("9 matched · 2 truth
facts · 18 no associator"), says what the truth graph says about each kind: matched by CMSSW's associator, a truth
fact (the simulated energy each particle left in its hits), or, where there is no associator, why (the gap behind its
**i**).

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
  bundle's relations (`viewer/src/model/colour/modes.ts`), so the profile needs no settings for this.
- **Truth** (key `T`, or "Colour by: reco type | truth particle" in the key; for bundles with truth particles). Everything is coloured by the
  generator particle it comes from (the profile's `particle` level), the same in every part of the detector:
  - a hit takes the colour of the particle that left the most simulated energy in it;
  - a truth line takes its generator particle's colour. A conversion's electrons and an interacting pion's
    daughters take their particle's colour;
  - a reco object takes its matched particle's colour only for a clean match. Clean means a purity of at least its
    kind's `match.good`: 75% of a track's hits, or 50% of a trackster's energy. Otherwise the object is grey;
  - a kind with no association of its own (layer clusters, TICL candidates, PF candidates, jets) is drawn faint and
    neutral: Ember does not work out a particle for it from its hits. Its markers made of calorimeter cells (layer
    clusters, superclusters) are small dots drawn under the hits, so they never hide the hits' colours; muon and track
    hits keep their size;
  - layers with no link to the truth (vertices) are the "no simulated energy, or not cleanly matched" grey;
  - seven signal particles get colours of their own, chosen by what you look at, and the line under the key's title
    says how ("top 7 by simulated energy in HGCal"; [Truth](truth.md#which-particles-get-a-colour)): with a selection,
    the particles its parts are matched to or left energy in its hits; in HGCal and Calo, by simulated energy there
    (in Calo, ECAL's, HCAL's, HF's and HO's leading particles in turn, never compared across detectors);
    in the tracker, by pT among the particles its tracks are matched to; in Physics and All, by pT. The other signal
    particles are mid grey. Pile-up has its own warm grey and is drawn small;
  - **Group by** in the key chooses the level that is one colour: generator particle (the default, the profile's),
    entered the calorimeter, reconstructable, parton jet, b / c hadron or τ visible, each with its count in the event;
    or one colour per class: collision (signal, pile-up), signal process / underlying event, or τ decay (hadronic,
    leptonic), every class drawn alike (docs/truth.md "Classes");
  - before anything is selected, the signal particles of that level with pT ≥ 1 GeV are drawn as dashed lines;
  - hits in which no exported particle left energy are small and faint: noise, out-of-time pile-up, or a particle
    that was not exported.

  The Truth mode needs a bundle whose truth particles name their level (`particle`). Older bundles have only Reco.
- **Layer colours.** A bundle without candidates or truth shows each layer's own colours from the profile (energies,
  particle types), with the scale under the layer's row. A part of the detector with `colourMode` `"layers"` does the
  same while you look at it in the Reco mode, for example the Tracker, with its tracks by pT.

### The pair view

With truth in the file, selecting a truth particle, a reco object of a kind with an association (a track, a PF
cluster, a trackster), or a hit shows its truth ↔ reco pair (`viewer/src/model/truth/pair.ts`), in either mode.
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

| class (key) | meaning (behind the key's **i**) |
|---|---|
| found | the branch's, in its match: hits where the branch left the most simulated energy, and the matched objects |
| in another object | the branch's, in another object of the kind compared, and that object (split off; also an object matched to the branch that is not its best: a fragment) |
| in no object | the branch's, in no object of the kind compared (missed) |
| not from it | in its match, from other particles or from none (contamination) |
| part of its match | parts of a matched object that have no truth of their own (a trackster's layer clusters, a track's hits) |
| rest of its branch | other particles of the branch that entered the calorimeter on their own (a conversion's electrons, an interaction's products) |
| not compared | the branch's hits in a detector whose reco has no association |

Everything else fades. The colour key lists only the classes in view. A shower that is split off (another trackster
holding part of the branch) is drawn as a faint thin rim and its match brighter, so the match is the one shower that
reads as filled.

The selection's card names the branch (and, when the selected particle is inside another particle's shower, which
shower's hits stand for it), then gives one block per detector:

- what it is compared with, and the matches, as chips;
- **simulated energy of the branch**, not calibrated: in its match, in other objects of the kind, in none; and how
  much of it is the particle's own shower and how much its descendants';
- **its match's rechit energy**: from the branch, from other particles, and with no simulated energy, each hit split
  by the simulated energy each particle left in it.

Simulated energy is never added across detectors. These bars are not the associator's purity and completeness of the
selected object: those are on its truth card.

The levels `↓` / `↑` step through are those of the matched object the pair comes from, whichever of its parts is
selected.

### Colour choices

The colours are Okabe-Ito and Tol hues, checked for protan, deutan and tritan colour vision. The particle types have
fixed colours of their own, chosen so that the tracks (charged hadrons, electrons, muons) are far apart, also in
simulated colour-blind vision. Other categories, such as a hit's subdetector, take colours kept apart from the types,
so a pixel hit never looks like a charged hadron. Electrons and photons, both electromagnetic, are two blues: less
apart than the tracks, but still clearly different. Choosing a colour for one layer (in its **⋯**) overrides the particle type and the pair view for that layer. The
replay keeps each candidate's colour throughout.

## The selection's card

The card is the same for every kind of object (`viewer/src/ui/card/Card.tsx`). It shows names, bars and numbers.
More is behind small buttons:

- the table's description is behind the **i** next to its title;
- what the chain's words mean is behind the chain's **i**;
- what a step's tag means on that step is behind the tag itself: click "match" or "sim";
- gap numbers of the [truth-graph notes](truth-graph.md#gap-table) are behind the **i** of a "no CMSSW associator"
  line, as links.

The card puts the answer first and the evidence below. It holds these parts, in this order.

**The header**: the object's kind, number and values ([Selecting an object](#selecting-an-object)), for example
"Jet 1 · pT 46 GeV · η 0.606", and on a small line below it where it comes from: its collection and its CMSSW
collection, "AK4 PUPPI (raw, no JEC) · ak4PFJetsPuppi".

**The truth block** (`viewer/src/ui/card/TruthBlock.tsx`, `viewer/src/model/truth/statement.ts`), built only from the
associations in the file:

- one line: the kind's own association, its match (see **The match** below); else, for a kind with no truth of its
  own, the match of its parts that are each the only one of their collection in their step (an electron's or a
  muon's track, a photon's PF cluster), when no other part is matched and they all name one particle, named as that
  part's, with where the particle comes from and the match's purity: "via its track · e⁻ · pT 27.5 · η −0.596 · from
  Z decay · purity 100%"; "via the PF cluster inside it" for a part only built from it (a photon's). A muon whose track
  is a K⁺ reads "via its track · K⁺ …". A charged PF candidate whose track is a π⁺ and whose HCAL cluster is a K⁰L,
  a jet, a τ: "No truth match for jets in CMSSW · its parts match 21 particles (X)". The origin is left out where the
  graph names neither the particle that made it nor why (a pile-up vertex). Why the kind has
  no truth of its own (no CMSSW associator, with its gap), and that the line is the part's answer, are behind its
  **i**;
- folded under **Each part's match**, one line per step of its parts that has an association of its own: a track, a
  PF cluster, a candidate trackster. For one object, the part, its particle, and the match's purity ("Track pT 30.1
  GeV → π⁻ · purity 100%"). For several, how many are matched ("2 of 4 matched (2 clean)"). Each line names its
  source: "associator · tracker hits", "associator · energy in ECAL". Objects built only from its parts (an
  electron's PF cluster, all of whose hits are in its supercluster) come under their own heading, "Built from its
  parts". Completeness is on the truth particle's side ("Reconstructed as"), where its denominator is the particle's:
  a genuine electron's track holds a small share of everything its brem photons made;
- **Go to truth (X)**, and the chooser it opens for a kind with no truth of its own.

It never gives a verdict for the object from its parts: a pion's track inside a photon's cluster is the story. For a
hit, the block lists the simulated energy each particle deposited in it (in MeV or GeV, not calibrated; in HF,
photoelectrons) and its share of the hit's, with a button for the particle's pair.

**The physics block** (`viewer/src/ui/card/Physics.tsx`): what the object is made of and its main numbers.

- its energy fractions (layer hint `fractions`), as one bar in a neutral grey ramp (a reconstruction quantity, not
  one of the view's colours);
- its constituents by type, from a relation into a layer that names its objects by a column with `names` ("PF
  candidates 7: γ 4 · π⁻ 2 · μ⁺ 1"), and how many their layer's filter keeps ("all kept by puppiWeight > 0", or "5
  kept, 26 not" for a CHS jet at pile-up);
- the objects holding it with a weight: "in Primary vertex 1 · weight 0.90" (a track), "in Secondary vertex 1";
- its key columns (the layer's `inspect`) but those its title gives (pT, η), with units and named values
  ("decayMode h± π⁰ (1)" where the layer's `describe.names` names them). Raw indices (`trackIdx`), components derived
  from others (px) and positions copied in from another table (a jet's PV position) are left to **All columns**;
- the layer's `inspectGroups`, each under its name (for example "b-tag": DeepCSV, JP). A group shows once the bundle
  has its columns, with no change to the viewer;
- objects of other kinds with exactly the same parts, from the relations alone: "same supercluster as Photon 1" (and
  "same supercluster as Electron 2" on the photon's card), "same PF candidates as Jet 1 · AK4 CHS", "all its PF
  candidates are in Jet 1 · AK4" (a tau). Several objects with the same wording share one line: "same layer clusters
  as Trackster 4 · Candidate trackster 1";
- for MET (a one-object kind with an azimuth): the other MET of the bundle and its Δφ, and Δφ to the leading jets
  of the drawn jet layers.

**Names of objects.** Every object name in the card is a button. A click looks at the object; a double click opens
its card ([Following the chain](#following-the-chain)). For a kind that a CMSSW associator matches, each name has a
dot for what the associator says about that object (`matchClass` in `viewer/src/model/truth/match.ts`):

- filled green: a clean match;
- half amber: an impure match;
- hollow grey: not matched.

So an unfolded step shows at a glance which of its objects are which. A kind that is matched without a clean
threshold gets no dot and no green, because nothing says how good its match is.

**The chain** (`viewer/src/model/event/chain.ts`). A reco object is shown between:

- what it is **part of**: the objects that contain it, outermost first;
- what it is **made of**: from the largest objects down to the hits, one branch at a time. A jet's PF candidates come
  first, then their TICL candidates down to the HGCal hits, then their tracks down to the track hits. A step comes
  right after the last step that holds it, indented under it, with its other holders named: "also via PF
  candidates" on tracks listed under a jet's TICL candidates;
- what is **built from its parts**, listed apart: objects built only from its parts that are not parts of it. For
  example a secondary vertex whose tracks are all in the jet, or a tau made of its PF candidates.

A step names its objects when there are three or fewer. Otherwise it counts them and unfolds to a list, largest
first. Every object is a button that moves the selection there. A step of a kind with several collections names
each object's collection ("AK4 · pT 52.8 GeV", "AK4 CHS · pT 52.8 GeV"), and its match lines are one per collection
("Trackster links", "Superclustering DNN").

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

**A step with a truth statement of its own has a tag**, in the words of [Truth](truth.md#where-truth-stops). The
selected object's own statement is in the truth block, not repeated on its step.

| tag | what the step shows |
|---|---|
| match | For one object: the associator's best match and its purity (green from the kind's clean threshold, amber below), or "not matched" (a fake, or an object that the associator does not consider, such as a candidate without calorimeter energy). For several objects: their counts, in the colours of their dots, for example "11 clean · 4 impure · 1 not matched". On a step that holds the object (its vertex), the line says it is that step's own match: "the vertex's own: …". |
| sim | The particles that left the simulated energy in the step's hits, with their shares, one line per detector (never summed across detectors). "per CSC layer" where the simulation records a coarser unit than the hit. "no simulated energy" where no exported particle left any (noise, out-of-time pile-up, or a particle the export left out): the tag says so. |

Steps of kinds that CMSSW has no associator for have no tag and no line: they are named once, with each kind's reason
and gap, behind the chain's **i**. "no truth" is never used: the card says which of three things it is, "no CMSSW associator" (the kind), "not matched"
(this object of a matched kind), or "no simulated energy" (a hit). A part with no truth of its own that goes with its
container (the hits of a track) has no line.

Each line is the step's own statement. No match is built through the parts ([Truth](truth.md#constituents)):

- Under an object whose kind has no truth of its own (a jet, a PF candidate), a step of several parts counts their
  own matches ("9 of 9 matched · 9 clean") but names no particle. Its hits and layer clusters say only that the
  statement is on each of them ("on each hit: select one for its particles"). A ranking of the particles in a jet's
  hits would be a match through hits.
- One part alone speaks for itself (for example a candidate's track).
- Under a kind with truth of its own (a trackster, a PF cluster, a track), the particles are listed.
- Where a step's collections differ in truth (muon rechits: sim; hits on muon tracks: none), each line names its
  collection.

When a kind gets an associator in CMSSW, it gets a `match` relation in the profile. Its steps then show the match,
with no change to the viewer.

**The levels in the view.** Sometimes the view is built around an object other than the selection: the pair's
candidate for a truth particle, or the object in focus for one of its parts. Then a line under the chain
lists that object's levels, those drawn (ticked) lit. Click one to tick or untick its collections, or press `↓` `↑`
to move the tick.

**The match**, in the truth block. For a reco object whose association has a `match` contract, the card shows:

- the associator's best match, or "not matched";
- its purity and its completeness, named as the associator's, as linear bars with what they count under them ("21 of
  21 hits · clean"; "completeness (associator) … of the particle's energy in HGCal, rechit scale"), and the clean
  threshold marked. The pair's "in its match 59%" further down is another number: the share of the particle's
  simulated energy in the match's hits;
- the generator particle that the match belongs to;
- the match's chain in the truth graph, on one line, from the collision down;
- **where it went**, when there is more than this object: every object of the kind that the particle's truth → reco
  association gives, with its completeness and "★ its best" where the particle is that object's own best match (a
  split); and "also best match of …": the other particles whose best object this is (a merge).

Behind its **i**: what the kind reconstructs (for example "the particle that entered the calorimeter"), how purity
and completeness are counted, and the associator's score ("0 best; not a fraction").

**Its part's pair** (owner decision D4, a trial). A TICL candidate has no truth of its own. When every part it has one
of (its candidate trackster, its linked trackster, its track) that is matched points to the same particle, the view
shows the pair of its first such part of an earlier reconstruction step: the candidate trackster, or in a TICL v6 bundle
(which has none with a match) the linked trackster. The truth block says so at its top in one line, "Showing its
candidate trackster's truth: the TICL candidate has none of its own", with the details behind its **i**. When the parts
disagree, there is no pair.

**A truth object** shows:

- its head: `μ⁺ · pT 96.6 GeV · η 1.11 · φ -2.72 · E 162 GeV · status 1 · signal (bx 0)`; where it was made and the
  last vertex where its daughters were made (the file's end vertex: not necessarily where it stopped), with R and z
  and the vertex named after the particle that made its particles and its process ("W⁻ decay · 1 charged",
  "γ conversion · 2 charged"); its generator copies; a tag for each truth level it belongs to (hard process,
  generator particle, entered the calorimeter, parton jet, b or c hadron, reconstructable, τ visible); and what the
  graph says of its physics ([Truth](truth.md#physics-from-the-graph)): an electron's brem, a photon's conversion, a
  τ's decay, a b or c hadron's flight and the reco vertex matched to its decay;
- its lineage: its ancestors (the generator's quarks and gluons folded into one line), itself ("this particle": its
  name, levels and copies are in the head), its daughters, the levels each one belongs to, and the reco objects whose
  best match it is. A particle's generator copies are one
  entry ("μ⁺ ×4 (status 23→1)"); a particle made from several partons says "from n partons", and the line follows the
  first;
- **Reconstructed as**: for each reco kind with a truth → reco association, the objects that hold at least 5% of it
  (completeness), most complete first, at most four; "+N" counts the others (all of them are under Every association).
  Each shows "completeness 51%", the share of the particle that it holds, and "★ its best" where the particle is that
  object's own best match. Kinds that show the same objects (the same parts: one trackster at the candidate, linked
  and plain levels), with the same completeness, are one line naming every kind; so are the kinds of one detector
  that hold under 5% of it each (a barrel particle's few MeV in HGCal). Hit-based association weights (tracks) are
  counted in hits. With nothing at all: "No reco object holds any of it". Its **i** names the kinds that nothing holds
  any of it in (not by itself an inefficiency: the particle may never have reached that detector), and apart the kinds
  with **no CMSSW associator** that the particle could have reached: those made of hits in a detector where its branch
  left simulated energy, of the tracker when a track holds part of it, of the muon system for a muon, and a species'
  own kinds (electrons, photons, muons, taus) only for that species. "Nothing holds it" (not matched) and "no
  associator" (no answer) stay two different statements. **Go to reco (X)** crosses over;
- the number of hits it left, per detector.

**Every association**, folded: each object that an association in the file links to the selection, with the
relation's weights as stored (shared energy, score, a hit's simulated energy), best first. These are the associator's
other partners behind the best match, for example every particle that shares an impure trackster.

**The pair** that the view is coloured by ([above](#the-pair-view)): the branch, then one block per detector with
what it is compared with, its matches, the branch's simulated energy (in its match, in others, in none; own shower and
descendants') and the match's rechit energy (from the branch, from other particles, with no simulated energy). Each
bar names its energy. The match's purity and completeness are the associator's, for the selected object.

**All columns**, folded, with units and sentinels as in the physics block.

## Expressions

Filters, custom columns and the `where` of summaries are expressions. They may use column names, numbers, `pi`,
`+ - * / % ^`, comparisons, `&& || !`, parentheses and a fixed list of Math functions. The viewer parses them; it
never runs them as JavaScript (`viewer/src/model/custom/expr.ts`).

## The address

The address keeps what a link needs:

- the bundle, the event and the view;
- the part of the detector (`All` when a bundle that opens on one part shows everything);
- a kind of object shown alone (`only`);
- the selection, and the first of its steps ticked (`lv`: opening the link ticks that step alone);
- the truth colours (`c=truth`) and what they group by (`g`, e.g. `g=collision`).

They are in the part after `#` (`#b=…&e=…`). A query (`?b=…&e=…`) is read too.

- `b` is the bundle's path, relative to the site: `data/u/<login>/<name>.ember` for a file in a user area.
- `e` is the event's position in the file, counted from 0. The top bar counts from 1. It is not the event number:
  type the event number (or `run:lumi:event`) in the event box.

A local file is not written to the address.

**Remembered in this browser, not in links:** custom columns, filters, colour choices and the active preset (per
profile), the theme, the width of the side panel, the login you typed, the recent data sets, and whether the
first-visit hints were dismissed.
