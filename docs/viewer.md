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

### Colour modes

"Colour by" at the top of the Layers tab colours every layer at once, so that a colour means one object in all of
them. The modes are worked out from the bundle's relations (`viewer/src/model/modes.ts`); a mode a bundle cannot
support is not offered.

| mode | one colour per | how the other layers take it |
|---|---|---|
| **Truth particle** (default with truth) | truth particle (`truth` layer with associations), largest first | hits: the particle with the most simulated energy in them; layer clusters: the particle with the most simulated energy in their hits, weighted by the hit fractions (worked out in the viewer: the truth graph has no layer-cluster association); tracksters, candidates, tracks: their best truth match. A particle shares the colour of its highest ancestor that owns hits or is matched (one colour per truth shower) |
| **Reconstruction** (default without truth) | object of the last reconstruction stage (candidates), largest first | what contains it, step by step: layer clusters, tracks and interpretations their candidate, hits their layer cluster's; tracksters the candidate of their first layer cluster; truth particles the candidate that reconstructs the largest share of them |
| **Per layer** | — | each layer's own colouring from the profile (energies, particle types) |

Seven colours (Okabe-Ito and Tol hues, checked for protan, deutan and tritan vision); the other objects share one
grey, and objects with nothing to take a colour from are drawn small and dark. The key under the switch names the
object behind each colour (click to select it). Choosing a colour for one layer overrides the mode for that layer;
switching mode clears those choices. The replay keeps the mode's colours (per layer: each stage's).

Expressions (filters, custom columns, summary `where`) admit column names, numbers, `pi`, `+ - * / % ^`, comparisons,
`&& || !`, parentheses and a fixed list of Math functions. They are parsed, never evaluated as JavaScript
(`viewer/src/model/expr.ts`).

The URL keeps the bundle, event, view and selection, so links can be shared. Custom columns, filters, colour
choices and the active preset (per profile), the theme and the panel width are remembered per browser.
