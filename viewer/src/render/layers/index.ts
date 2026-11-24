// The drawable layers: one builder per representation a display hint can name (`repr`, io/format.ts REPRS), from a
// LayerInput to a Layer (layer.ts).
import { cells } from "./cells";
import { cones } from "./cones";
import { ellipsoids } from "./ellipsoids";
import { helices } from "./helices";
import { markers } from "./markers";
import { pointPaths } from "./polylines";
import { segments } from "./segments";

export type { Layer, LayerInput } from "./layer";

export const builders = { cells, markers, ellipsoids, segments, helix: helices, cones, polyline: pointPaths } as const;
