# Viewer

A static web page (TypeScript, Preact signals, three.js) that reads bundles over HTTP range requests: on opening, the
header and index; then one request per event shown. It lists the bundles of the site's `index.json` (re-read every
30 s while the page is visible), or opens a `.evdb` file dropped on the page. What it draws and how comes from the
bundle's display hints ([format.md](format.md)).

## Controls

The same list is in the viewer's help (`?`).

| action | how |
|---|---|
| rotate, pan, zoom | drag; right-drag or shift + drag; scroll (zooms towards the cursor) |
| inspect an object | click it: it is shown with its smallest parts, one kind per branch, and the parts drawn as lines, which do not hide them (e.g. a candidate with its calorimeter hits, its track and the track's hits; a vertex with its tracks and their hits), related objects highlighted (a track: its vertex and truth particle); its parts are drawn even where a layer's filter would hide them (cuts still apply); further clicks pick among its parts |
| see what it is made of, level by level | ↓ / ↑, or click a level in the bar at the top left: one level at a time between the object and its smallest parts (e.g. a candidate's interpretations, linked tracksters, tracksters, layer clusters), with the object drawn as an outline around it; a level with several layers (e.g. two linking algorithms) draws those ticked in Layers, or all of them if none is |
| objects on top of each other | click again on the same spot for the next one |
| zoom to an object | double-click it, or F |
| show everything | Home, or Reset |
| back to the normal view, close a dialog | Esc, or click on empty space |
| previous / next event | ← / →, or the arrows at the top |
| views: 3D, front, side, ρ–z | 1, 2, 3, 4 |
| one part of the detector, or all | D (cycles), or All · Tracker · HGCal … at the top (bundles with `domains`): the part's layers and the shared ones (e.g. truth), framed on its region, in its view, and its tab opens in the side panel (choosing a tab does not change the view); the side panel keeps your ticks |
| replay | R: hits appear at their arrival time (display hint `time`, else time of flight, or the bundle's `replay` order), then each reconstruction stage in turn |
| tour | P, or the play button: replay with a moving camera, visit the main showers, next event; any key or touch stops it |
| live | the Live button: play new files as they appear in the site's index |
| help | ? |
| resize the side panel | drag its edge; double-click to reset |

## Side panel

Preset buttons when the bundle has more than one preset; then tabs; then the colour key.

- **One tab per part of the detector** (display hint `domain`, e.g. **HGCal**; **Objects** for bundles made before
  layers had one), in the order of the header's `domains`, as the top bar's buttons: its collections by kind of object. Each kind lists its `cut` slider (log scale over the group's
  values in the shown event; the lowest position is no cut; it applies to every layer of the group, also those listed
  elsewhere, which it names) and then one row per layer: visibility and count, the layer's filter, "only for the
  selection" for `onSelection` layers, and its colour scale when the colour key does not already explain it. Other
  reconstruction paths are folded at the end. **⋯** on a row: what colours the layer (any column, custom ones too,
  or a related object), an expression to filter its table or to add as a custom column (e.g. `snr = energy /
  sigmaNoise`, computed in the browser for every event and usable for colour and filters like stored columns), and the
  table's custom columns.
- **Truth** (named **Tree** for a tree without truth layers): the truth collections with their cut, what became of
  each particle that left hits (its best candidate, or not reconstructed), and objects linked to objects of the same
  table, e.g. truth-graph particles and their children, as a collapsible tree.
- **Event**: run and event information, the bundle's `summaries` charts, and the source with every table of the event.

### Colours and the truth ↔ reco pair

A bundle with reconstruction stages colours its candidates by particle type, and everything they are made of in the
same colour: interpretations and tracks (their candidate), tracksters and linked tracksters (the candidate holding most
of their layer clusters), layer clusters, and hits (their layer cluster's candidate). Objects in no candidate are
small and grey; a layer that cannot reach a candidate (e.g. the vertices) is drawn by its colour column, or keeps its
own categorical colours if it has none. How each layer reaches a candidate or a truth particle is worked out from the bundle's relations
(`viewer/src/model/modes.ts`), so this needs no profile settings. The colour key at the bottom of the side panel names
the particle types. A bundle without candidates shows each layer's own colouring from the profile (energies, particle
types), with its scale under the layer's row; so does a domain with `colourMode` `"layers"` (e.g. the Tracker, its tracks
by pT) while it is looked at.

**The pair view.** With candidates, selecting anything shows its truth ↔ reco pair
(`viewer/src/model/pair.ts`): first the selection's particle (a truth particle stands for its whole shower: its
highest ancestor that owns hits or is matched; a reco object takes its best truth match; a hit, the particle that left
the most simulated energy in it), then that particle's best candidate. So the particle, its candidate and anything
inside them give the same pair and the same picture; a selected candidate that is not its particle's best (a
fragment) shows as split. Without a particle (no truth in the file, or none matched) the pair is the selection's
candidate alone, and its objects show as "in the candidate". The levels in the focus bar are then the pair
candidate's kinds, whichever of its objects is selected, and count the pair's objects (also the particle's in other
candidates or in none); the selected object itself is always drawn. A selection with neither a candidate nor a
particle that left hits (e.g. a central track, a vertex) has no pair: it is shown with its own levels and links.
In the pair view, every layer is coloured by where its objects ended up:

| class | meaning |
|---|---|
| matched | the particle's hits (and clusters, tracksters...) in its candidate (what the candidate is made of, even if it shares it with another candidate); the particle and the candidate |
| contamination | in the candidate, but from other particles or from none |
| split | the particle's hits in other candidates, and those candidates (and candidates matched to the particle that are not its best) |
| missed | the particle's hits, and reco objects matched to it, in no candidate |

Everything else fades. A hit belongs to the particle that left the most simulated energy in it (a layer cluster: the
particle with the most simulated energy in its hits). Missed layer clusters stay in the background, as their hits
show the same and a shower's many one-hit halo clusters would cover the used ones. The key gives the particle's
simulated energy in its candidate, in other candidates and in none (efficiency), and the share of the candidate's hit
energy from the particle (purity). The key stays in sight from every tab, e.g. while clicking particles in Truth. Efficiency counts each hit once per shower and any share of it; the colours use
each hit's dominant particle. Truth layers keep their own colours.

Colours are Okabe-Ito and Tol hues, checked for protan, deutan and tritan vision. Choosing a colour for one layer (its
⋯) overrides the particle type and the pair view for that layer. The replay keeps each candidate's colour throughout.

Expressions (filters, custom columns, summary `where`) admit column names, numbers, `pi`, `+ - * / % ^`, comparisons,
`&& || !`, parentheses and a fixed list of Math functions. They are parsed, never evaluated as JavaScript
(`viewer/src/model/expr.ts`).

The URL keeps the bundle, event, view, domain and selection, so links can be shared. Custom columns, filters, colour
choices and the active preset (per profile), the theme and the panel width are remembered per browser.
