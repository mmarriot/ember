// Renderer, cameras, navigation (presets, framing, smooth fly-to, tour camera), and picking. Draws only when
// something changed. Knows nothing about bundles or tables beyond the Layer interface.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Layer } from "./layers";
import { REPLAY_OFF } from "./replay";

export type ViewName = "3d" | "front" | "side" | "rz";
export interface Hit { table: string; row: number; layer: string }
type Rows = Map<string, Iterable<number>>;
type Pose = [position: THREE.Vector3, target: THREE.Vector3, zoom: number];

/** Default smallest radius (cm) framed around objects; profiles set their own (view.minRadius). */
export const MIN_RADIUS = 70;

const DIRECTIONS: Record<Exclude<ViewName, "rz">, [number, number, number]> = {
  "3d": [0.62, 0.32, 0.72], front: [0, 0, 1], side: [1, 0, 0], // camera direction from the target
};

// Tour camera (beam tours).
const TOUR_SWAY = 0.35, TOUR_PERIOD = 30; // rad, s: close-ups sway around their view
const TOUR_SPIN = (2 * Math.PI) / 60; // rad/s: the whole event turns once a minute
const SPRUNG = ["az", "el", "ld"] as const; // tour state that follows its goal on a spring (besides the target)

export class Engine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam3d = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  private readonly camRZ = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private readonly ctl3d: OrbitControls;
  private readonly ctlRZ: OrbitControls;
  private readonly gizmo = makeGizmo();
  private width = 1;
  private height = 1;
  private layers: Layer[] = [];
  private view: ViewName = "3d";
  private dirty = true;
  private flight: { t0: number; ms: number; swing: number; from: Pose; to: Pose } | null = null;
  private replayClock: { t0: number; seconds: number } | null = null;
  private highlightFade: { t0: number; ms: number } | null = null;
  private orbit = 0; // auto-rotation, turns per minute (3D)
  /** Tour camera: looks at a target from a 3/4 angle, turning slowly (whole event) or swaying (close-ups). Angle,
   *  elevation, ln(distance) and target follow their goals as critically damped springs, so glides start and settle
   *  softly and a new goal mid-glide keeps the motion continuous. The camera stays out of the detector envelope:
   *  where the ideal position is inside, it stops at the envelope and zooms optically by the difference. */
  private tour: {
    t: number; az: number; el: number; ld: number; target: THREE.Vector3; spin: number; spinW: number;
    v: { az: number; el: number; ld: number; target: THREE.Vector3 }; // velocities
    goal: { az: number; el: number; ld: number; target: THREE.Vector3; spinW: number; omega: number };
  } | null = null;
  private envelope: Envelope | null = null; // of the drawn layers, computed when the tour first needs it
  /** Smallest radius (cm) framed around objects (profile view.minRadius, set by the viewport). */
  minRadius = MIN_RADIUS;
  /** Pixels on the right of the view covered by a panel (the inspector): framing centres objects in the rest. */
  insetRight = 0;
  /** Called on every replay frame with the replay time (s), and with null when it ends. */
  onReplayTick: (t: number | null) => void = () => {};
  /** Called when the user starts rotating, panning or zooming. */
  onInteract = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, 2, 3);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6), sun);
    this.cam3d.position.set(...DIRECTIONS["3d"]).multiplyScalar(1500);
    this.camRZ.position.set(0, 0, 1000);
    this.ctl3d = new OrbitControls(this.cam3d, canvas);
    this.ctlRZ = new OrbitControls(this.camRZ, canvas);
    this.ctlRZ.enableRotate = false;
    this.ctlRZ.enabled = false;
    for (const c of [this.ctl3d, this.ctlRZ]) {
      Object.assign(c, { zoomToCursor: true, enableDamping: true, dampingFactor: 0.18, rotateSpeed: 0.6, zoomSpeed: 1.1, panSpeed: 0.9 });
      c.addEventListener("change", () => this.requestRender());
      c.addEventListener("start", () => { this.flight = null; this.onInteract(); });
    }
    Object.assign(this.ctl3d, { minDistance: 5, maxDistance: 6000 }); // cm: never inside a cell, never lost
    Object.assign(this.ctlRZ, { minZoom: 0.05, maxZoom: 300 });
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    let last = performance.now();
    const loop = (now: number) => {
      const real = (now - last) / 1000; // s
      last = now;
      if (this.replayClock) this.tick(now);
      if (this.highlightFade) this.fadeStep(now);
      // Capped, so a backgrounded tab does not jump on return; looser for the tour, so it keeps pace on slow frames.
      if (this.tour) this.tourStep(Math.min(0.25, real));
      else if (this.flight) this.fly(now);
      else this.controls.update(Math.min(0.1, real)); // damping and auto-rotation; emits "change" only while moving
      if (this.dirty) { this.draw(); this.dirty = false; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** The event, then a small axis gizmo in the bottom-right corner showing the camera orientation (3D views). */
  private draw() {
    const r = this.renderer;
    r.setViewport(0, 0, this.width, this.height);
    r.render(this.scene, this.camera);
    if (this.rz) return;
    const size = 110;
    this.gizmo.camera.position.copy(this.cam3d.position).sub(this.ctl3d.target).setLength(3);
    this.gizmo.camera.up.copy(this.cam3d.up);
    this.gizmo.camera.lookAt(0, 0, 0);
    r.autoClear = false;
    r.clearDepth();
    r.setViewport(this.width - size - 8, 8, size, size);
    r.render(this.gizmo.scene, this.gizmo.camera);
    r.setViewport(0, 0, this.width, this.height);
    r.autoClear = true;
  }

  private get rz() { return this.view === "rz"; }
  private get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera { return this.rz ? this.camRZ : this.cam3d; }
  private get controls() { return this.rz ? this.ctlRZ : this.ctl3d; }
  requestRender() { this.dirty = true; }

  setBackground(colour: number) {
    this.renderer.setClearColor(colour);
    this.requestRender();
  }

  /** Run the replay set up with planReplay() over `seconds`, from an empty view. */
  replay(seconds: number) {
    for (const l of this.layers) l.setClock(0);
    this.draw(); // the first draw uploads the rebuilt layers to the GPU: the clock starts after it, not during it
    this.replayClock = { t0: performance.now(), seconds };
  }

  stopReplay() {
    if (!this.replayClock) return;
    this.replayClock = null;
    for (const l of this.layers) l.setClock(REPLAY_OFF);
    this.onReplayTick(null);
    this.requestRender();
  }

  get replaying() { return this.replayClock !== null; }

  private tick(now: number) {
    const t = (now - this.replayClock!.t0) / 1000;
    if (t >= this.replayClock!.seconds) return this.stopReplay();
    for (const l of this.layers) l.setClock(t);
    this.onReplayTick(t);
    this.requestRender();
  }

  /** Start or stop the tour camera (see `tour`). Stopping hands the view back to the user with the same framing
   *  (the optical zoom is turned into distance). */
  tourCamera(on: boolean) {
    if (on && !this.tour) {
      if (this.rz) this.setView("3d");
      const target = this.ctl3d.target.clone(), off = this.cam3d.position.clone().sub(target);
      const ld = Math.log(Math.max(off.length() / this.cam3d.zoom, 50)), az = Math.atan2(off.x, off.z), el = Math.asin(THREE.MathUtils.clamp(off.y / off.length(), -1, 1));
      this.tour = { t: 0, az, el, ld, target, spin: 0, spinW: 1, v: { az: 0, el: 0, ld: 0, target: new THREE.Vector3() },
        goal: { az, el, ld, target: target.clone(), spinW: 1, omega: 3 } };
      this.flight = null;
      this.ctl3d.enabled = false;
    } else if (!on && this.tour) {
      const target = this.tour.target, zoom = this.cam3d.zoom;
      this.tour = null;
      this.cam3d.position.sub(target).divideScalar(zoom).add(target);
      this.cam3d.zoom = 1;
      this.cam3d.updateProjectionMatrix();
      this.ctl3d.target.copy(target);
      this.ctl3d.enabled = !this.rz;
      this.ctl3d.update();
    }
  }

  /** Tour: glide to the given rows (or everything, from the side) in about `ms`. `room`: how much space around
   *  them is kept in view (1 is tight; larger is further out). */
  tourTo(selection: Rows | undefined, ms: number, room = 1.9) {
    const box = this.box(selection);
    if (!this.tour || !box) return;
    const s = this.tour, [lo, hi] = box, ctr = lo.clone().add(hi).multiplyScalar(0.5);
    const radius = Math.max(0.5 * lo.distanceTo(hi) + 15, MIN_RADIUS);
    const dist = this.distanceFor((selection ? room : 1.05) * radius);
    s.az += s.spin; // the turn so far becomes the starting angle of the glide
    s.spin = 0;
    // A 3/4 view: from the side for the whole event, from outside its end for a forward shower; the nearer of the
    // two mirror angles, so the camera does not swing across.
    const base = !selection || Math.abs(ctr.z) < 100 ? 1.2 : ctr.z > 0 ? 0.55 : Math.PI - 0.55;
    const az = [base, -base].reduce((a, c) => (Math.abs(angle(c - s.az)) < Math.abs(angle(a - s.az)) ? c : a));
    s.goal = { az: s.az + angle(az - s.az), el: selection ? 0.3 : 0.38, ld: Math.log(dist), target: ctr, spinW: selection ? 0 : 1,
      omega: 6.6 / Math.max(0.4, ms / 1000) }; // critically damped: ~99% of the way after 6.6 / omega seconds
  }

  private tourStep(dt: number) {
    const s = this.tour!, g = s.goal, w = g.omega, acc = new THREE.Vector3();
    for (let left = dt; left > 1e-6; left -= 0.02) { // small steps keep the springs stable on slow frames
      const h = Math.min(0.02, left);
      for (const k of SPRUNG) {
        s.v[k] += (w * w * (g[k] - s[k]) - 2 * w * s.v[k]) * h;
        s[k] += s.v[k] * h;
      }
      acc.subVectors(g.target, s.target).multiplyScalar(w * w).addScaledVector(s.v.target, -2 * w);
      s.v.target.addScaledVector(acc, h);
      s.target.addScaledVector(s.v.target, h);
    }
    s.t += dt;
    s.spinW += (g.spinW - s.spinW) * (1 - Math.exp(-dt * 1.5));
    s.spin += dt * TOUR_SPIN * s.spinW;
    const az = s.az + s.spin + (1 - s.spinW) * TOUR_SWAY * Math.sin((2 * Math.PI * s.t) / TOUR_PERIOD);
    const dir = new THREE.Vector3(Math.cos(s.el) * Math.sin(az), Math.sin(s.el), Math.cos(s.el) * Math.cos(az));
    this.envelope ??= envelopeOf(this.layers);
    const dist = Math.exp(s.ld), along = Math.max(dist, exitDistance(this.envelope, s.target, dir) + 20);
    this.cam3d.position.copy(s.target).addScaledVector(dir, along);
    this.cam3d.up.set(0, 1, 0);
    this.cam3d.lookAt(s.target);
    this.cam3d.zoom = along / dist;
    this.cam3d.updateProjectionMatrix();
    this.ctl3d.target.copy(s.target);
    this.requestRender();
  }

  /** Back to the normal view, animated: the whole event from the current preset's direction (3D: the standard 3/4
   *  view). */
  home(ms = 700) {
    this.fit(undefined, true, ms, 0, this.rz ? undefined : presetDirection(this.view));
  }

  /** Orbit the 3D view around its target; `speed` in turns per minute, 0 stops. Flights keep orbiting. */
  autoRotate(speed: number) {
    this.orbit = speed;
    this.ctl3d.autoRotate = speed > 0;
    this.ctl3d.autoRotateSpeed = speed * 2; // three.js counts 2 as 30 s per turn
  }

  /** Cross-fade every layer from its previous selection to its current one (set with Layer.setHighlight). */
  fadeHighlight(ms: number) {
    this.highlightFade = { t0: performance.now(), ms };
    for (const l of this.layers) l.setHighlightMix(0);
    this.requestRender();
  }

  private fadeStep(now: number) {
    const t = Math.min(1, (now - this.highlightFade!.t0) / this.highlightFade!.ms), k = t * t * (3 - 2 * t);
    for (const l of this.layers) l.setHighlightMix(k);
    if (t >= 1) this.highlightFade = null;
    this.requestRender();
  }

  setLayers(layers: Layer[]) {
    if (this.replayClock) { this.replayClock = null; this.onReplayTick(null); } // new layers start in their final state
    for (const l of this.layers) { this.scene.remove(l.object); l.dispose(); }
    this.layers = layers;
    this.envelope = null;
    for (const l of layers) { l.setProjection(this.rz); this.scene.add(l.object); }
    this.requestRender();
  }

  /** Draw one more layer (e.g. a hidden layer the focus has objects in). */
  addLayer(layer: Layer) {
    layer.setProjection(this.rz);
    this.scene.add(layer.object);
    this.layers.push(layer);
    this.envelope = null;
    this.requestRender();
  }

  /** Stop drawing a layer, and free it. */
  removeLayer(layer: Layer) {
    const i = this.layers.indexOf(layer);
    if (i < 0) return;
    this.scene.remove(layer.object);
    layer.dispose();
    this.layers.splice(i, 1);
    this.envelope = null;
    this.requestRender();
  }

  /** Swap one drawn layer for a rebuilt one (e.g. a layer that shows only the selection's objects). */
  replaceLayer(old: Layer, next: Layer) {
    const i = this.layers.indexOf(old);
    if (i < 0) return;
    this.scene.remove(old.object);
    old.dispose();
    next.setProjection(this.rz);
    this.scene.add(next.object);
    this.layers[i] = next;
    this.envelope = null;
    this.requestRender();
  }

  /** Switch camera preset or projection, keeping `selection` (if given) in frame. */
  setView(view: ViewName, selection?: Rows) {
    this.view = view;
    this.ctl3d.enabled = !this.rz;
    this.ctlRZ.enabled = this.rz;
    for (const l of this.layers) l.setProjection(this.rz);
    if (!this.rz) {
      const dist = Math.max(this.cam3d.position.distanceTo(this.ctl3d.target), 100);
      this.cam3d.position.copy(this.ctl3d.target).addScaledVector(presetDirection(view), dist);
      this.cam3d.up.set(0, 1, 0);
      this.ctl3d.update();
    }
    this.frame(selection);
  }

  /** Fit the view to the drawn objects, or to the given rows per table; animated over `ms` if `animate`, swinging
   *  `swing` radians around the vertical on the way (3D). */
  frame(selection?: Rows, animate = false, ms = 450, swing = 0) {
    this.fit(selection, animate, ms, swing);
  }

  /** frame(), looking along `dir` (3D; default: the current direction). */
  private fit(selection: Rows | undefined, animate: boolean, ms: number, swing: number, dir?: THREE.Vector3) {
    const box = this.box(selection);
    if (!box) return;
    const [lo, hi] = box;
    const ctr = lo.clone().add(hi).multiplyScalar(0.5), size = hi.clone().sub(lo);
    if (this.rz) {
      const c = this.camRZ, zoom = 0.85 * Math.min((c.right - c.left) / Math.max(size.x + 30, 80), (c.top - c.bottom) / Math.max(size.y + 30, 80));
      return this.go([new THREE.Vector3(ctr.x, ctr.y, 1000), new THREE.Vector3(ctr.x, ctr.y, 0), zoom], animate, ms, 0);
    }
    const radius = Math.max(0.68 * size.length() + 0.22 * this.minRadius, this.minRadius); // cm: conservative
    if (!dir) {
      dir = this.cam3d.position.clone().sub(this.ctl3d.target);
      if (dir.lengthSq() < 1e-6) dir = presetDirection(this.view); // no direction yet
      dir.normalize();
    }
    // With a panel over the right of the view, fit the objects in the uncovered width and centre them there.
    const free = Math.max(0.4, 1 - this.insetRight / this.width), aspect = this.cam3d.aspect;
    const dist = this.distanceFor(radius / Math.min(1, free * aspect)); // the narrower side decides
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const shift = (1 - free) * dist * Math.tan(THREE.MathUtils.degToRad(this.cam3d.fov / 2)) * aspect; // half the covered width
    const target = ctr.addScaledVector(right, shift);
    this.go([target.clone().addScaledVector(dir, dist), target, 1], animate, ms, swing);
  }

  /** Camera distance at which a sphere of this radius fills the height of the 3D view. */
  private distanceFor(radius: number) {
    return radius / Math.sin(THREE.MathUtils.degToRad(this.cam3d.fov / 2));
  }

  /** The object closest to a screen point (see pickAll), or null. */
  pick(clientX: number, clientY: number, accept?: (table: string, row: number) => boolean): Hit | null {
    return this.pickAll(clientX, clientY, accept)[0] ?? null;
  }

  /** Every layer's closest object under a screen point (one per layer), best first: what is stacked there, e.g. a
   *  candidate, its tracksters, a hit, a truth line. Distances are in units of the layer's pick radius (times its
   *  pickBias), so a big shower and a small cell compete fairly; nothing beyond one radius is picked. Cut-away
   *  objects, and those `accept` rejects, are ignored. Background (context) layers count only when nothing else is
   *  under the cursor. */
  pickAll(clientX: number, clientY: number, accept?: (table: string, row: number) => boolean): Hit[] {
    const r = this.canvas.getBoundingClientRect(), rz = this.rz;
    const px = clientX - r.left, py = clientY - r.top, hw = 0.5 * r.width, hh = 0.5 * r.height;
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    // One pass over every drawn object per pointer move (~640k at PU200): nothing allocated per object (the
    // projection writes to a typed array: a double stored in a captured variable would be boxed on the heap),
    // squared distances, and the cut test (a call) only for objects close enough to win.
    const out = new Float64Array(2); // screen offset from the cursor of the last point projected
    const project = (X: Float32Array, Y: Float32Array, Z: Float32Array, i: number) => {
      let x = X[i], y = Y[i], z = Z[i];
      if (rz) { y = Math.sqrt(x * x + y * y) * (y >= 0 ? 1 : -1); x = Z[i]; z = 0; }
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0) return false; // behind the camera
      out[0] = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * hw - px;
      out[1] = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * hh - py;
      return true;
    };
    const found: { hit: Hit; score: number; context?: boolean }[] = [];
    // A polyline (helix): the closest point of its segments, squared, or Infinity when none is in front of the camera.
    const alongPath = (path: NonNullable<Layer["path"]>, i: number) => {
      let best = Infinity, ax = 0, ay = 0, prev = false;
      for (let j = i * path.points; j < (i + 1) * path.points; j++) {
        const ok = project(path.x, path.y, path.z, j), bx = out[0], by = out[1];
        if (ok && prev) {
          const ex = bx - ax, ey = by - ay, len2 = ex * ex + ey * ey;
          const f = len2 > 0 ? Math.min(1, Math.max(0, -(ax * ex + ay * ey) / len2)) : 0, dx = ax + f * ex, dy = ay + f * ey;
          best = Math.min(best, dx * dx + dy * dy);
        }
        prev = ok; ax = bx; ay = by;
      }
      return best;
    };
    for (const layer of this.layers) {
      const X = layer.x, Y = layer.y, Z = layer.z, seg = layer.segment, path = layer.path, bias = layer.pickBias ?? 1;
      const scale = (bias * bias) / (layer.pickRadius * layer.pickRadius);
      let best = -1, bestScore = 1;
      for (let i = 0; i < X.length; i++) {
        if (path) {
          const score = scale * alongPath(path, i);
          if (score < bestScore && layer.passes(i) && (!accept || accept(layer.table, i))) { bestScore = score; best = i; }
          continue;
        }
        if (!(seg ? project(seg.b[0], seg.b[1], seg.b[2], i) : project(X, Y, Z, i))) continue;
        let dx = out[0], dy = out[1];
        if (seg && project(seg.a[0], seg.a[1], seg.a[2], i)) { // a line or a shower's axis: closest point of the segment
          const ax = out[0], ay = out[1], ex = dx - ax, ey = dy - ay, len2 = ex * ex + ey * ey;
          const f = len2 > 0 ? Math.min(1, Math.max(0, -(ax * ex + ay * ey) / len2)) : 0;
          dx = ax + f * ex; dy = ay + f * ey;
        }
        const score = scale * (dx * dx + dy * dy);
        if (score < bestScore && layer.passes(i) && (!accept || accept(layer.table, i))) { bestScore = score; best = i; }
      }
      if (best >= 0) found.push({ hit: { table: layer.table, row: best, layer: layer.label }, score: bestScore, context: layer.context });
    }
    const fg = found.filter((f) => !f.context);
    return (fg.length ? fg : found).sort((a, c) => a.score - c.score).map((f) => f.hit);
  }

  /** Bounding box (view coordinates) of the bulk of the drawn objects, or of the given rows: 2nd to 98th
   *  percentile per axis, from at most ~20k objects. Context layers count only when nothing else is drawn. */
  private box(selection?: Rows): [THREE.Vector3, THREE.Vector3] | null {
    const fg = this.layers.some((l) => !l.context && l.x.length);
    const layers = this.layers.filter((l) => (selection ? selection.has(l.table) : !l.context || !fg));
    const step = Math.max(1, Math.floor(layers.reduce((s, l) => s + l.x.length, 0) / 20000));
    const pts: number[][] = [[], [], []], p = new THREE.Vector3();
    let k = 0;
    const add = (l: Layer, i: number) => {
      if (!l.passes(i) || k++ % step) return;
      this.toView(l.x, l.y, l.z, i, p);
      pts[0].push(p.x); pts[1].push(p.y); pts[2].push(p.z);
    };
    for (const l of layers) {
      const rows = selection?.get(l.table);
      if (rows) for (const i of rows) add(l, i);
      else for (let i = 0; i < l.x.length; i++) add(l, i);
    }
    if (!pts[0].length) return null;
    const sorted = pts.map((a) => Float64Array.from(a).sort());
    const q = (f: number) => new THREE.Vector3(...sorted.map((a) => a[Math.floor(f * (a.length - 1))]));
    const trim = pts[0].length > 50 ? 0.02 : 0;
    const lo = q(trim), hi = q(1 - trim);
    // A selection's lines (e.g. a candidate's track, from the vertex) stay in view whole: their start points are
    // few, so the trimming above would drop them.
    for (const l of layers) {
      if (!selection || !l.line) continue;
      const rows = selection.get(l.table) ?? [], path = l.path;
      if (path) {
        for (const i of rows) if (l.passes(i)) for (let j = i * path.points; j < (i + 1) * path.points; j++) { this.toView(path.x, path.y, path.z, j, p); lo.min(p); hi.max(p); }
      } else if (l.segment) {
        const [X, Y, Z] = l.segment.a;
        for (const i of rows) if (l.passes(i)) { this.toView(X, Y, Z, i, p); lo.min(p); hi.max(p); }
      }
    }
    return [lo, hi];
  }

  private toView(X: Float32Array, Y: Float32Array, Z: Float32Array, i: number, out: THREE.Vector3) {
    return this.rz ? out.set(Z[i], Math.hypot(X[i], Y[i]) * (Y[i] >= 0 ? 1 : -1), 0) : out.set(X[i], Y[i], Z[i]);
  }

  private go(to: Pose, animate: boolean, ms: number, swing: number) {
    this.flight = animate ? { t0: performance.now(), ms, swing, from: [this.camera.position.clone(), this.controls.target.clone(), this.camera.zoom], to } : null;
    if (!animate) this.place(...to);
  }

  /** One step of a flight: the target moves in a straight line while the camera moves around it in spherical
   *  coordinates (shortest way round, plus the swing) with the distance changing geometrically, so zooming feels
   *  even and the camera arcs rather than cutting through the scene. */
  private fly(now: number) {
    const f = this.flight!;
    const t = Math.min(1, (now - f.t0) / f.ms), e = t * t * (3 - 2 * t); // smoothstep
    const target = f.from[1].clone().lerp(f.to[1], e);
    const a = new THREE.Spherical().setFromVector3(f.from[0].clone().sub(f.from[1]));
    const b = new THREE.Spherical().setFromVector3(f.to[0].clone().sub(f.to[1]));
    const turn = THREE.MathUtils.euclideanModulo(b.theta - a.theta + Math.PI, 2 * Math.PI) - Math.PI + f.swing;
    // An orbit in progress carries on through the flight at its own speed, so the motion never stops and restarts.
    const spin = this.rz ? 0 : -((2 * Math.PI * this.orbit) / 60) * ((now - f.t0) / 1000);
    const r0 = Math.max(a.radius, 1e-3), r = r0 * (Math.max(b.radius, 1e-3) / r0) ** e;
    const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(r, a.phi + (b.phi - a.phi) * e, a.theta + turn * e + spin));
    this.place(target.clone().add(offset), target, f.from[2] + (f.to[2] - f.from[2]) * e);
    if (t >= 1) this.flight = null;
  }

  private place(position: THREE.Vector3, target: THREE.Vector3, zoom: number) {
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    const orbiting = this.controls.autoRotate;
    this.controls.autoRotate = false; // the flight already moved the camera; no extra orbit step here
    this.controls.update();
    this.controls.autoRotate = orbiting;
    this.requestRender();
  }

  private resize() {
    const p = this.canvas.parentElement!;
    const w = p.clientWidth, h = p.clientHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.cam3d.aspect = w / h;
    this.cam3d.updateProjectionMatrix();
    const half = Math.max(320, 600 / (w / h));
    Object.assign(this.camRZ, { left: (-half * w) / h, right: (half * w) / h, top: half, bottom: -half });
    this.camRZ.updateProjectionMatrix();
    this.requestRender();
  }
}

const presetDirection = (view: ViewName) => new THREE.Vector3(...DIRECTIONS[view as Exclude<ViewName, "rz">]).normalize();

/** An angle in (-pi, pi]. */
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The cylinder around the beam axis (z) that the tour camera stays out of. */
interface Envelope { r: number; z: number } // cm

/** The drawn objects' extent with 10% + 15 cm to spare. Lines (tracks, particles) are left out: they reach past
 *  the detector. */
function envelopeOf(layers: Layer[]): Envelope {
  let r2 = 0, z = 0;
  for (const l of layers) {
    if (l.line) continue;
    for (let i = 0; i < l.x.length; i++) {
      r2 = Math.max(r2, l.x[i] * l.x[i] + l.y[i] * l.y[i]);
      z = Math.max(z, Math.abs(l.z[i]));
    }
  }
  return { r: 1.1 * Math.sqrt(r2) + 15, z: 1.1 * z + 15 };
}

/** How far from `p` along `dir` the envelope is left (0 if `p` is outside it). */
function exitDistance(env: Envelope, p: THREE.Vector3, dir: THREE.Vector3) {
  if (Math.hypot(p.x, p.y) >= env.r || Math.abs(p.z) >= env.z) return 0;
  let t = Infinity;
  if (Math.abs(dir.z) > 1e-9) t = ((dir.z > 0 ? env.z : -env.z) - p.z) / dir.z;
  const a = dir.x * dir.x + dir.y * dir.y, b = 2 * (p.x * dir.x + p.y * dir.y), c = p.x * p.x + p.y * p.y - env.r * env.r;
  if (a > 1e-12) t = Math.min(t, (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a));
  return t;
}

/** x (red), y (green), z = beam (blue) axes with labels, drawn by a tiny camera that copies the main orientation. */
function makeGizmo() {
  const scene = new THREE.Scene();
  const label = (text: string, colour: string, at: THREE.Vector3) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.font = "bold 44px system-ui, sans-serif";
    g.fillStyle = colour;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 32, 34);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    sprite.position.copy(at);
    sprite.scale.setScalar(0.7);
    return sprite;
  };
  for (const [dir, colour, text] of [[new THREE.Vector3(1, 0, 0), "#d73a49", "x"], [new THREE.Vector3(0, 1, 0), "#22863a", "y"], [new THREE.Vector3(0, 0, 1), "#0366d6", "z"]] as const) {
    scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 0.95, colour, 0.3, 0.18));
    scene.add(label(text, colour, dir.clone().multiplyScalar(1.3)));
  }
  return { scene, camera: new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 10) };
}
