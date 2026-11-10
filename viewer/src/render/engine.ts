// Renderer, cameras, navigation (presets, framing, smooth fly-to), and picking. Draws only when something
// changed. Knows nothing about bundles or tables beyond the Layer interface.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Layer } from "./layers";
import { REPLAY_OFF } from "./replay";

export type ViewName = "3d" | "front" | "side" | "rz";
export interface Hit { table: string; row: number; layer: string }
const DIRECTIONS: Record<Exclude<ViewName, "rz">, [number, number, number]> = {
  "3d": [0.62, 0.32, 0.72], front: [0, 0, 1], side: [1, 0, 0], // camera direction from the target
};

export class Engine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam3d = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  private readonly camRZ = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private readonly ctl3d: OrbitControls;
  private readonly ctlRZ: OrbitControls;
  private layers: Layer[] = [];
  private view: ViewName = "3d";
  private dirty = true;
  private flight: { t0: number; ms: number; swing: number; from: [THREE.Vector3, THREE.Vector3, number]; to: [THREE.Vector3, THREE.Vector3, number] } | null = null;
  private replayClock: { t0: number; seconds: number } | null = null;
  private highlightFade: { t0: number; ms: number } | null = null;
  private orbit = 0; // auto-rotation, turns per minute (3D)
  /** Smallest radius (cm) framed around objects (profile view.minRadius, set by the viewport). */
  minRadius = 70;
  /** Pixels on the right of the view covered by a panel (the inspector): framing centres objects in the rest. */
  insetRight = 0;
  /** Tour camera (collider data): looks at a target from a distance that fits it, at a 3/4 angle, turning slowly
   *  (whole event) or swaying (close-ups). Angle, elevation, distance (log) and target follow their goals as critically
   *  damped springs: each glide starts gently, is quickest in the middle and settles softly, and a new goal arriving
   *  mid-glide keeps the motion going (velocity is continuous), so the camera never stops dead. It never enters the
   *  detector: where the ideal position is inside the detector envelope it stops at the envelope along the line of
   *  sight and zooms optically by the difference, so the framing is the same. */
  private tour: {
    t: number; az: number; el: number; ld: number; target: THREE.Vector3; spin: number; spinW: number; // ld: ln(distance)
    v: { az: number; el: number; ld: number; target: THREE.Vector3 }; // velocities
    goal: { az: number; el: number; ld: number; target: THREE.Vector3; spinW: number; omega: number };
  } | null = null;
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
    this.gizmo = makeGizmo();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    let last = performance.now();
    const loop = (now: number) => {
      const real = (now - last) / 1000, dt = Math.min(0.1, real); // s; capped so a backgrounded tab does not jump on return
      last = now;
      if (this.replayClock) this.tick(now);
      if (this.highlightFade) this.fadeStep(now);
      if (this.tour) this.tourStep(Math.min(0.25, real)); // a looser cap: on slow frames the tour still keeps pace
      else if (this.flight) this.fly(now);
      else this.controls.update(dt); // damping and auto-rotation; emits "change" (-> redraw) only while moving
      if (this.dirty) { this.draw(); this.dirty = false; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private readonly gizmo: ReturnType<typeof makeGizmo>;

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

  private width = 1;
  private height = 1;

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
    this.replayClock = { t0: performance.now(), seconds };
    for (const l of this.layers) l.setClock(0);
    this.requestRender();
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

  /** Tour: glide to the given rows (or everything: both endcaps, from the side) in about `ms`. `room`: how much space
   *  around them is kept in view (1 is tight; larger is further out). */
  tourTo(selection: Map<string, Iterable<number>> | undefined, ms: number, room = 1.9) {
    const box = this.box(selection);
    if (!this.tour || !box) return;
    const s = this.tour, [lo, hi] = box, ctr = lo.clone().add(hi).multiplyScalar(0.5);
    const radius = Math.max(0.5 * hi.clone().sub(lo).length() + 15, 70); // cm (beam tours only: collider scale)
    const dist = ((selection ? room : 1.05) * radius) / Math.sin(THREE.MathUtils.degToRad(this.cam3d.fov / 2));
    s.az += s.spin; // the turn so far becomes the starting angle of the glide
    s.spin = 0;
    // A 3/4 view: from the side for the whole event, from outside its endcap for a shower; the nearer of the two
    // mirror angles, so the camera does not swing across.
    const base = !selection || Math.abs(ctr.z) < 100 ? 1.2 : ctr.z > 0 ? 0.55 : Math.PI - 0.55;
    const az = [base, -base].reduce((a, c) => (Math.abs(angle(c - s.az)) < Math.abs(angle(a - s.az)) ? c : a));
    // Critically damped: about 99% of the way after 6.6 / omega seconds.
    s.goal = { az: s.az + angle(az - s.az), el: selection ? 0.3 : 0.38, ld: Math.log(dist), target: ctr, spinW: selection ? 0 : 1,
      omega: 6.6 / Math.max(0.4, ms / 1000) };
  }

  private tourStep(dt: number) {
    const s = this.tour!, g = s.goal, w = g.omega;
    for (let left = dt; left > 1e-6; left -= 0.02) { // small steps keep the spring stable on slow frames
      const h = Math.min(0.02, left);
      const spring = (x: number, v: number, goal: number) => { const nv = v + (w * w * (goal - x) - 2 * w * v) * h; return [x + nv * h, nv]; };
      [s.az, s.v.az] = spring(s.az, s.v.az, g.az);
      [s.el, s.v.el] = spring(s.el, s.v.el, g.el);
      [s.ld, s.v.ld] = spring(s.ld, s.v.ld, g.ld);
      const acc = g.target.clone().sub(s.target).multiplyScalar(w * w).addScaledVector(s.v.target, -2 * w);
      s.v.target.addScaledVector(acc, h);
      s.target.addScaledVector(s.v.target, h);
    }
    s.t += dt;
    s.spinW += (g.spinW - s.spinW) * (1 - Math.exp(-dt * 1.5));
    s.spin += dt * TOUR_SPIN * s.spinW;
    const az = s.az + s.spin + (1 - s.spinW) * TOUR_SWAY * Math.sin((2 * Math.PI * s.t) / TOUR_PERIOD);
    const dir = new THREE.Vector3(Math.cos(s.el) * Math.sin(az), Math.sin(s.el), Math.cos(s.el) * Math.cos(az));
    const dist = Math.exp(s.ld), along = Math.max(dist, exitDistance(s.target, dir) + 20); // stop at the detector envelope
    this.cam3d.position.copy(s.target).addScaledVector(dir, along);
    this.cam3d.up.set(0, 1, 0);
    this.cam3d.lookAt(s.target);
    this.cam3d.zoom = along / dist;
    this.cam3d.updateProjectionMatrix();
    this.ctl3d.target.copy(s.target);
    this.requestRender();
  }

  /** Back to the normal view, animated: the whole event, centred, from the current preset's direction (3D: the
   *  standard 3/4 view). */
  home(ms = 700) {
    if (this.rz) return this.frame(undefined, true, ms);
    const box = this.box();
    if (!box) return;
    const [lo, hi] = box, ctr = lo.clone().add(hi).multiplyScalar(0.5);
    const radius = Math.max(0.68 * hi.clone().sub(lo).length() + 0.22 * this.minRadius, this.minRadius);
    const dir = new THREE.Vector3(...DIRECTIONS[this.view as Exclude<ViewName, "rz">]).normalize();
    this.go(ctr.clone().addScaledVector(dir, radius / Math.sin(THREE.MathUtils.degToRad(this.cam3d.fov / 2))), ctr, 1, true, ms, 0);
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
    for (const l of layers) { l.setProjection(this.rz); this.scene.add(l.object); }
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
    this.requestRender();
  }

  /** Switch camera preset or projection, keeping `selection` (if given) in frame. */
  setView(view: ViewName, selection?: Map<string, Iterable<number>>) {
    this.view = view;
    this.ctl3d.enabled = !this.rz;
    this.ctlRZ.enabled = this.rz;
    for (const l of this.layers) l.setProjection(this.rz);
    if (!this.rz) {
      const dist = Math.max(this.cam3d.position.distanceTo(this.ctl3d.target), 100);
      this.cam3d.position.copy(this.ctl3d.target).addScaledVector(new THREE.Vector3(...DIRECTIONS[view as Exclude<ViewName, "rz">]).normalize(), dist);
      this.cam3d.up.set(0, 1, 0);
      this.ctl3d.update();
    }
    this.frame(selection);
  }

  /** Fit the view to the drawn objects, or to the given rows per table; animated over `ms` if `animate`, swinging
   *  `swing` radians around the vertical on the way (3D). */
  frame(selection?: Map<string, Iterable<number>>, animate = false, ms = 450, swing = 0) {
    const box = this.box(selection);
    if (!box) return;
    const [lo, hi] = box;
    const ctr = lo.clone().add(hi).multiplyScalar(0.5), size = hi.clone().sub(lo);
    if (this.rz) {
      const zoom = 0.85 * Math.min((this.camRZ.right - this.camRZ.left) / Math.max(size.x + 30, 80), (this.camRZ.top - this.camRZ.bottom) / Math.max(size.y + 30, 80));
      this.go(new THREE.Vector3(ctr.x, ctr.y, 1000), new THREE.Vector3(ctr.x, ctr.y, 0), zoom, animate, ms, 0);
    } else {
      const radius = Math.max(0.68 * size.length() + 0.22 * this.minRadius, this.minRadius); // cm: conservative
      const dir = this.cam3d.position.clone().sub(this.ctl3d.target);
      if (dir.lengthSq() < 1e-6) dir.set(...DIRECTIONS[this.view as Exclude<ViewName, "rz">]); // no direction yet
      dir.normalize();
      // With a panel over the right of the view, fit the objects in the uncovered width and centre them there.
      const free = Math.max(0.4, 1 - this.insetRight / this.width), half = THREE.MathUtils.degToRad(this.cam3d.fov / 2);
      const fit = Math.min(1, free * this.cam3d.aspect); // horizontal room relative to the vertical
      const dist = radius / (Math.sin(half) * fit);
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      const shift = right.multiplyScalar((1 - free) * dist * Math.tan(half) * this.cam3d.aspect); // half the covered width
      const target = ctr.clone().add(shift);
      this.go(target.clone().addScaledVector(dir, dist), target, 1, animate, ms, swing);
    }
  }

  /** The object closest to a screen point, measured in units of its layer's pick radius (so a big shower and a
   *  small cell compete fairly; a layer's pickBias below 1 makes it win over others); nothing beyond one radius is
   *  picked. Cut-away objects, and those `accept` rejects, are ignored. */
  pick(clientX: number, clientY: number, accept?: (table: string, row: number) => boolean): Hit | null {
    return this.pickAll(clientX, clientY, accept)[0] ?? null;
  }

  /** Every layer's closest object under a screen point (one per layer), best first: what is stacked there, e.g. a
   *  candidate, its interpretation, the tracksters, a layer cluster, a hit, a truth line. Clicking again on the
   *  same spot walks through them. */
  pickAll(clientX: number, clientY: number, accept?: (table: string, row: number) => boolean): Hit[] {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    // One pass over every drawn object per pointer move (about 500k at PU200): no allocation per object, squared
    // distances, and the cut test (a call) only for objects close enough to win.
    // Screen position of a point (x, y, z) relative to the cursor, or null behind the camera.
    const screen = (X: Float32Array, Y: Float32Array, Z: Float32Array, i: number): [number, number] | null => {
      let x = X[i], y = Y[i], z = Z[i];
      if (this.rz) { y = Math.sqrt(x * x + y * y) * (y >= 0 ? 1 : -1); x = Z[i]; z = 0; }
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0) return null;
      return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * r.width - px, (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * r.height - py];
    };
    const found: { hit: Hit; score: number; context?: boolean }[] = [];
    for (const layer of this.layers) {
      const X = layer.x, Y = layer.y, Z = layer.z, rad2 = layer.pickRadius * layer.pickRadius, seg = layer.segment, bias = layer.pickBias ?? 1;
      let best = -1, bestScore = 1;
      for (let i = 0; i < X.length; i++) {
        const b = seg ? screen(seg.b[0], seg.b[1], seg.b[2], i) : screen(X, Y, Z, i);
        if (!b) continue;
        let dx = b[0], dy = b[1];
        if (seg) { // a line or a shower's axis: distance from the cursor to the segment on screen
          const a = screen(seg.a[0], seg.a[1], seg.a[2], i);
          if (a) {
            const ex = b[0] - a[0], ey = b[1] - a[1], len2 = ex * ex + ey * ey;
            const f = len2 > 0 ? Math.min(1, Math.max(0, -(a[0] * ex + a[1] * ey) / len2)) : 0;
            dx = a[0] + f * ex; dy = a[1] + f * ey;
          }
        }
        const score2 = (bias * bias * (dx * dx + dy * dy)) / rad2;
        if (score2 < bestScore && layer.passes(i) && (!accept || accept(layer.table, i))) { bestScore = score2; best = i; }
      }
      if (best >= 0) found.push({ hit: { table: layer.table, row: best, layer: layer.label }, score: bestScore, context: layer.context });
    }
    // Background (context) layers are picked only when nothing else is under the cursor.
    const fg = found.filter((f) => !f.context);
    return (fg.length ? fg : found).sort((a, c) => a.score - c.score).map((f) => f.hit);
  }

  private box(selection?: Map<string, Iterable<number>>): [THREE.Vector3, THREE.Vector3] | null {
    const pts: number[][] = [[], [], []];
    // Background (context) layers are framed only when nothing else is drawn or they are selected.
    const fg = this.layers.filter((l) => !l.context && l.x.length);
    const layers = this.layers.filter((l) => (selection ? selection.has(l.table) : !l.context || !fg.length));
    const total = layers.reduce((s, l) => s + l.x.length, 0);
    const step = Math.max(1, Math.floor(total / 20000));
    let k = 0;
    for (const l of layers)
      for (const i of selection?.get(l.table) ?? range(l.x.length))
        if (l.passes(i) && k++ % step === 0) this.toView(l, i).forEach((v, d) => pts[d].push(v));
    if (!pts[0].length) return null;
    const q = (a: number[], f: number) => a[Math.floor(f * (a.length - 1))];
    pts.forEach((a) => a.sort((u, v) => u - v));
    const f = pts[0].length > 50 ? [0.02, 0.98] : [0, 1];
    const lo = new THREE.Vector3(...pts.map((a) => q(a, f[0]))), hi = new THREE.Vector3(...pts.map((a) => q(a, f[1])));
    // The lines of a selection (e.g. a candidate's track, from the vertex) stay in view whole: their start points are
    // few, so the outlier trimming above would drop them.
    for (const l of layers) {
      if (!selection || !l.line || !l.segment) continue;
      const [X, Y, Z] = l.segment.a;
      for (const i of selection.get(l.table) ?? []) {
        if (!l.passes(i)) continue;
        const p = this.rz ? new THREE.Vector3(Z[i], Math.hypot(X[i], Y[i]) * (Y[i] >= 0 ? 1 : -1), 0) : new THREE.Vector3(X[i], Y[i], Z[i]);
        lo.min(p); hi.max(p);
      }
    }
    return [lo, hi];
  }

  private go(position: THREE.Vector3, target: THREE.Vector3, zoom: number, animate: boolean, ms: number, swing: number) {
    const to: [THREE.Vector3, THREE.Vector3, number] = [position, target, zoom];
    if (animate) {
      this.flight = { t0: performance.now(), ms, swing, from: [this.camera.position.clone(), this.controls.target.clone(), this.camera.zoom], to };
    } else {
      this.flight = null;
      this.place(...to);
    }
  }

  /** One step of a flight: the target moves in a straight line while the camera moves around it in spherical
   *  coordinates (shortest way round, plus the swing), with the distance changing geometrically, so zooming in
   *  and out feels even and the camera arcs rather than cutting through the scene. */
  private fly(now: number) {
    const f = this.flight!;
    const t = Math.min(1, (now - f.t0) / f.ms), e = t * t * (3 - 2 * t); // smoothstep
    const target = f.from[1].clone().lerp(f.to[1], e);
    const a = new THREE.Spherical().setFromVector3(f.from[0].clone().sub(f.from[1]));
    const b = new THREE.Spherical().setFromVector3(f.to[0].clone().sub(f.to[1]));
    const turn = THREE.MathUtils.euclideanModulo(b.theta - a.theta + Math.PI, 2 * Math.PI) - Math.PI + f.swing;
    // An orbit in progress carries on through the flight at its own speed, so the motion never stops and restarts.
    const spin = this.rz ? 0 : -((2 * Math.PI * this.orbit) / 60) * ((now - f.t0) / 1000);
    const r = Math.max(a.radius, 1e-3) * (Math.max(b.radius, 1e-3) / Math.max(a.radius, 1e-3)) ** e;
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

  private toView(l: Layer, i: number): [number, number, number] {
    return this.rz ? [l.z[i], Math.hypot(l.x[i], l.y[i]) * (l.y[i] >= 0 ? 1 : -1), 0] : [l.x[i], l.y[i], l.z[i]];
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

function* range(n: number) { for (let i = 0; i < n; i++) yield i; }

// Tour camera: a cylinder the camera never enters (the HGCal endcaps reach about 280 cm in radius and 520 cm in z),
// and a slow sway of its viewing angle.
const ENVELOPE_R = 300, ENVELOPE_Z = 560; // cm
const TOUR_SWAY = 0.35, TOUR_PERIOD = 30; // rad, s: close-ups sway around their view
const TOUR_SPIN = (2 * Math.PI) / 60; // rad/s: the whole event turns once a minute

/** An angle in (-pi, pi]. */
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** How far from `p` along `dir` the detector envelope is left (0 if `p` is outside it). */
function exitDistance(p: THREE.Vector3, dir: THREE.Vector3) {
  if (Math.hypot(p.x, p.y) >= ENVELOPE_R || Math.abs(p.z) >= ENVELOPE_Z) return 0;
  let t = Infinity;
  if (Math.abs(dir.z) > 1e-9) t = ((dir.z > 0 ? ENVELOPE_Z : -ENVELOPE_Z) - p.z) / dir.z;
  const a = dir.x * dir.x + dir.y * dir.y, b = 2 * (p.x * dir.x + p.y * dir.y), c = p.x * p.x + p.y * p.y - ENVELOPE_R * ENVELOPE_R;
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
