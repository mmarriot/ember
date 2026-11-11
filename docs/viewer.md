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
| inspect an object | click it: it and its parts are shown, related objects highlighted; further clicks pick among its parts |
| objects on top of each other | click again on the same spot for the next one |
| zoom to an object | double-click it, or F |
| show everything | Home, or Reset |
| back to the normal view, close a dialog | Esc, or click on empty space |
| previous / next event | ← / →, or the arrows at the top |
| views: 3D, front, side, ρ–z | 1, 2, 3, 4 |
| replay | R: hits appear at their arrival time (display hint `time`, else time of flight, or the bundle's `replay` order), then each reconstruction stage in turn |
| tour | P, or the play button: replay with a moving camera, visit the main showers, next event; any key or touch stops it |
| live | the Live button: play new files as they appear in the site's index |
| help | ? |
| resize the side panel | drag its edge; double-click to reset |

## Side panel

- **Layers**: the colour mode and its key (below), preset buttons when the bundle has more than one preset, then
  visibility, legend and colour choice per layer.
- **Cuts**: a log-scale slider per `cut` group, ranging over the group's values in the shown event (the lowest
  position is no cut), and per-table filters (expressions).
- **Columns**: custom columns, e.g. `snr = energy / sigmaNoise`, computed in the browser for every event; usable for
  colour and filters like stored columns.
- **Tree** (named **Truth** when the bundle has truth layers): objects linked to objects of the same table, e.g.
  truth-graph particles and their children, as a collapsible tree.
- **Event**: run and event information, the bundle's `summaries` charts.

### Colour modes and the truth ↔ reco pair

"Colour by" at the top of the Layers tab colours every layer at once. How each layer reaches a candidate or a truth
particle is worked out from the bundle's relations (`viewer/src/model/modes.ts`), so the modes need no profile
settings; a bundle without reconstruction stages offers only "Per layer".

- **Particle type** (default): candidates by particle type, and everything they are made of in the same colour:
  interpretations and tracks (their candidate), tracksters and linked tracksters (the candidate holding most of their
  layer clusters), layer clusters, and hits (their layer cluster's candidate). Objects in no candidate are small and
  grey.
- **Per layer**: each layer's own colouring from the profile (energies, particle types).

**The pair view.** In the Particle type mode, selecting anything shows its truth ↔ reco pair
(`viewer/src/model/pair.ts`): first the selection's particle (a truth particle stands for its whole shower: its
highest ancestor that owns hits or is matched; a reco object takes its best truth match; a hit, the particle that left
the most simulated energy in it), then that particle's best candidate. So the particle, its candidate and anything
inside them give the same pair and the same picture; a selected candidate that is not its particle's best (a
fragment) shows as split. Without a particle (no truth in the file, or none matched) the pair is the selection's
candidate alone, and its objects show as "in the candidate". Every layer is coloured by where its objects ended up:

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
energy from the particle (purity). Efficiency counts each hit once per shower and any share of it; the colours use
each hit's dominant particle. Truth layers keep their own colours in the Particle type mode.

Colours are Okabe-Ito and Tol hues, checked for protan, deutan and tritan vision. Choosing a colour for one layer
overrides the mode and the pair view for that layer; switching mode clears those choices. The replay keeps each
stage's colours in the Per layer mode only.

Expressions (filters, custom columns, summary `where`) admit column names, numbers, `pi`, `+ - * / % ^`, comparisons,
`&& || !`, parentheses and a fixed list of Math functions. They are parsed, never evaluated as JavaScript
(`viewer/src/model/expr.ts`).

The URL keeps the bundle, event, view and selection, so links can be shared. Custom columns, filters, colour
choices and the active preset (per profile), the theme and the panel width are remembered per browser.
