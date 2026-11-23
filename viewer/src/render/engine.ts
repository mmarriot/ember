// The renderer and its cameras: the 3D view and the 2D views (front, side, rho-z), framing and flights, the replay
// clock and picking. It draws a frame only when something changed, and knows the event only through the Layer
// interface (render/layers).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Outline, ViewName } from "../io/format";
import {
  type Area,
  boxOf,
  DIRECTIONS,
  type Envelope,
  envelopeOf,
  FLAT_DISTANCE,
  flatAim,
  flatView,
  freeArea,
  presetDirection,
  type Rows,
} from "./camera";
import type { Layer } from "./layers";
import { outlineObject } from "./outlines";
import { type Hit, pickAll } from "./picking";
import { REPLAY_OFF } from "./replay";
import { TourCamera } from "./tourCamera";

type Pose = [position: THREE.Vector3, target: THREE.Vector3, zoom: number];

/** Default smallest radius (cm) framed around objects; profiles set their own (view.minRadius). */
export const MIN_RADIUS = 70;

export class Engine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  /** The 3D view's camera, and the one shared by the 2D views (front, side, rho-z), each with its mouse controls. */
  private readonly cam3d = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  private readonly cam2d = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
  private readonly ctl3d: OrbitControls;
  private readonly ctl2d: OrbitControls;
  private readonly gizmo = makeGizmo();
  /** The canvas's size in CSS pixels. */
  private width = 1;
  private height = 1;
  private layers: Layer[] = [];
  /** Layers taken out of the scene, freed after the next draw: three.js frees a shader program with the last material
   *  using it, so freeing them before the replacements are drawn would compile every program again. */
  private retired: Layer[] = [];
  private outlines: ReturnType<typeof outlineObject> | null = null; // the detector's outlines (header `outlines`)
  private view: ViewName = "3d";
  /** Something changed since the last frame: the next animation frame draws. */
  private dirty = true;
  /** The camera's flight in progress (see fly), started at `t0` (ms, performance.now()). */
  private flight: { t0: number; ms: number; swing: number; from: Pose; to: Pose } | null = null;
  /** The replay in progress: started at `t0`, ends after `seconds`; `only`: the layers whose clocks run; `pace`: real
   *  seconds per second of replay. */
  private replayClock: { t0: number; seconds: number; only?: Layer[]; pace: number } | null = null;
  /** Something is selected: the detector outlines are faded (see setFocused). */
  private focused = false;
  /** The selection's cross-fade in progress (see fadeHighlight). */
  private highlightFade: { t0: number; ms: number } | null = null;
  /** Auto-rotation of the 3D view, turns per minute (0: none). */
  private orbit = 0;
  /** The tour camera, while it drives the 3D view (beam tours). */
  private tour: TourCamera | null = null;
  /** The drawn layers' envelope (camera.ts envelopeOf), computed when the tour camera first needs it. */
  private envelope: Envelope | null = null;
  /** Smallest radius (cm) framed around objects (profile view.minRadius, set by control/scene.ts). */
  minRadius = MIN_RADIUS;
  /** The rectangle of the view covered by a panel (the card), in px from its top left, or null: framing fits and
   *  centres objects in the largest part it leaves free (camera.ts freeArea). Asked at each framing. */
  cover: () => Area | null = () => null;
  /** Called on every replay frame with the replay time (s), and with null when it ends. */
  onReplayTick: (t: number | null) => void = () => {};
  /** Called when the user starts rotating, panning or zooming. */
  onInteract = () => {};
  /** Called after every frame drawn (only when something changed), e.g. to move HTML labels with the objects. */
  onDraw = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, 2, 3);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6), sun);
    this.cam3d.position.set(...DIRECTIONS["3d"]).multiplyScalar(1500);
    this.cam2d.position.set(0, 0, 1000);
    this.ctl3d = new OrbitControls(this.cam3d, canvas);
    this.ctl2d = new OrbitControls(this.cam2d, canvas);
    this.ctl2d.enableRotate = false;
    this.ctl2d.enabled = false;
    for (const c of [this.ctl3d, this.ctl2d]) {
      Object.assign(c, {
        zoomToCursor: true,
        enableDamping: true,
        dampingFactor: 0.18,
        rotateSpeed: 0.6,
        zoomSpeed: 1.1,
        panSpeed: 0.9,
      });
      c.addEventListener("change", () => this.requestRender());
      c.addEventListener("start", () => {
        this.flight = null;
        this.onInteract();
      });
    }
    Object.assign(this.ctl3d, { minDistance: 5, maxDistance: 6000 }); // cm: never inside a cell, never lost
    Object.assign(this.ctl2d, { minZoom: 0.05, maxZoom: 300 });
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
      if (this.dirty) {
        this.draw();
        this.dirty = false;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** The event, then (`gizmo`) a small axis gizmo in the bottom-right corner showing the camera orientation (3D
   *  views). */
  private draw(gizmo = true) {
    const r = this.renderer;
    r.setViewport(0, 0, this.width, this.height);
    // The outlines fade near the 3D camera, on the scale of its distance to what it looks at.
    this.outlines?.setReach(this.ctl3d.target, this.cam3d.position.distanceTo(this.ctl3d.target) / this.cam3d.zoom);
    r.render(this.scene, this.camera);
    for (const l of this.retired.splice(0)) l.dispose();
    this.onDraw();
    if (this.rz || !gizmo) return;
    const size = 110;
    this.gizmo.camera.position.copy(this.camera.position).sub(this.controls.target).setLength(3);
    this.gizmo.camera.up.copy(this.camera.up);
    this.gizmo.camera.lookAt(0, 0, 0);
    r.autoClear = false;
    r.clearDepth();
    r.setViewport(this.width - size - 8, 8, size, size);
    r.render(this.gizmo.scene, this.gizmo.camera);
    r.setViewport(0, 0, this.width, this.height);
    r.autoClear = true;
  }

  /** Follow the size of the canvas's parent: the drawing buffer and both cameras' frustums. */
  private resize() {
    const p = this.canvas.parentElement!;
    const w = p.clientWidth,
      h = p.clientHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.cam3d.aspect = w / h;
    this.cam3d.updateProjectionMatrix();
    const half = Math.max(320, 600 / (w / h));
    Object.assign(this.cam2d, { left: (-half * w) / h, right: (half * w) / h, top: half, bottom: -half });
    this.cam2d.updateProjectionMatrix();
    this.requestRender();
  }

  /** Draw a new frame at the next animation frame (several requests before it make one frame). */
  requestRender() {
    this.dirty = true;
  }

  /** The rho-z view: its layers project (x, y, z) to (z, ±rho) in their shaders. */
  private get rz() {
    return this.view === "rz";
  }

  /** A 2D view (front, side, rho-z): the orthographic camera, pan and zoom only. */
  private get flat() {
    return this.view !== "3d";
  }

  /** The camera and controls of the current view. */
  private get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.flat ? this.cam2d : this.cam3d;
  }

  private get controls() {
    return this.flat ? this.ctl2d : this.ctl3d;
  }

  /** The layers drawn in the current view (display hint `views`). */
  private get drawn() {
    return this.layers.filter((l) => l.object.visible);
  }

  /** Show or hide a layer for the current view, and tell it which view that is. */
  private showIn(layer: Layer) {
    layer.object.visible = !layer.views || layer.views.includes(this.view);
    layer.setView?.(this.view);
  }

  /** Put a layer in the scene, drawn as the current view asks. */
  private attach(layer: Layer) {
    layer.setProjection(this.rz);
    this.showIn(layer);
    this.scene.add(layer.object);
  }

  /** Take a layer out of the scene; it is freed after the next draw (see `retired`). */
  private detach(layer: Layer) {
    this.scene.remove(layer.object);
    this.retired.push(layer);
  }

  // What is drawn: the layers, the detector outlines, the background.

  /** Draw these layers instead of the current ones (a new event, new colours, new cuts). */
  setLayers(layers: Layer[]) {
    // New layers start in their final state: a replay in progress ends.
    if (this.replayClock) {
      this.replayClock = null;
      this.onReplayTick(null);
    }
    // Layers retired without a draw since (a background tab draws nothing) go now: at most one event's layers wait.
    for (const l of this.retired.splice(0)) l.dispose();
    for (const l of this.layers) this.detach(l);
    this.layers = layers;
    this.envelope = null;
    for (const l of layers) this.attach(l);
    this.requestRender();
  }

  /** Draw one more layer (e.g. a hidden layer the focus has objects in). */
  addLayer(layer: Layer) {
    this.attach(layer);
    this.layers.push(layer);
    this.envelope = null;
    this.requestRender();
  }

  /** Stop drawing a layer, and free it. */
  removeLayer(layer: Layer) {
    const i = this.layers.indexOf(layer);
    if (i < 0) return;
    this.detach(layer);
    this.layers.splice(i, 1);
    this.envelope = null;
    this.requestRender();
  }

  /** Swap one drawn layer for a rebuilt one (e.g. a layer that shows only the selection's objects). */
  replaceLayer(old: Layer, next: Layer) {
    const i = this.layers.indexOf(old);
    if (i < 0) return;
    this.detach(old);
    this.attach(next);
    this.layers[i] = next;
    this.envelope = null;
    this.requestRender();
  }

  /** The layer drawn for a table, if any (e.g. for HTML labels: its objects' positions and ends). */
  drawnLayer(table: string): Layer | undefined {
    return this.layers.find((l) => l.table === table);
  }

  /** Draw faint outlines of the detector's parts (header `outlines`), in `colour` mixed towards `background`; none
   *  for an empty list. */
  setOutlines(outlines: readonly Outline[], colour: THREE.Color, background: THREE.Color) {
    if (this.outlines) {
      this.scene.remove(this.outlines.object);
      this.outlines.dispose();
    }
    this.outlines = outlines.length ? outlineObject(outlines, colour, background) : null;
    if (this.outlines) {
      this.outlines.setView(this.view);
      this.outlines.setHighlight(this.focused);
      this.outlines.setHighlightMix(1);
      this.scene.add(this.outlines.object);
    }
    this.requestRender();
  }

  /** The colour the frame is cleared to (the theme's background). */
  setBackground(colour: number) {
    this.renderer.setClearColor(colour);
    this.requestRender();
  }

  // Views and framing: where the camera looks.

  /** Switch camera preset or projection, keeping `selection` (if given) in frame. */
  setView(view: ViewName, selection?: Rows) {
    this.view = view;
    this.ctl3d.enabled = !this.flat;
    this.ctl2d.enabled = this.flat;
    for (const l of this.layers) {
      l.setProjection(this.rz);
      this.showIn(l);
    }
    this.outlines?.setView(view);
    this.envelope = null;
    if (view !== "3d") {
      // look along the view's axis; frame() below moves the target
      this.cam2d.position.copy(this.ctl2d.target).addScaledVector(flatView(view).dir, FLAT_DISTANCE);
      this.cam2d.up.set(0, 1, 0);
      this.cam2d.lookAt(this.ctl2d.target);
      this.ctl2d.update();
    } else {
      const dist = Math.max(this.cam3d.position.distanceTo(this.ctl3d.target), 100);
      this.cam3d.position.copy(this.ctl3d.target).addScaledVector(presetDirection(view), dist);
      this.cam3d.up.set(0, 1, 0);
      this.ctl3d.update();
    }
    this.frame(selection);
  }

  /** Fit the view to the drawn objects, or to the given rows per table; animated over `ms` if `animate`, swinging
   *  `swing` radians around the vertical on the way (3D). `least`: the smallest radius framed (cm), instead of
   *  minRadius. */
  frame(selection?: Rows, animate = false, ms = 450, swing = 0, least?: number) {
    this.fit(selection, animate, ms, swing, undefined, least);
  }

  /** Frame a cylinder around the beam axis (radius rMax, |z| up to zMax; cm), e.g. a part of the detector, from the
   *  current direction: whole in the 3D view; in the 2D views, its section (the disc of radius rMax end-on, the
   *  2 zMax x 2 rMax rectangle from the side and in rho-z), which then fills the view. */
  frameRegion(rMax: number, zMax: number, animate = true, ms = 700) {
    if (this.view === "rz") return this.aimFlat(new THREE.Vector3(), 2 * zMax, 2 * rMax, animate, ms);
    if (this.view !== "3d")
      return this.aimFlat(
        new THREE.Vector3(),
        ...flatView(this.view).extent(new THREE.Vector3(2 * rMax, 2 * rMax, 2 * zMax)),
        animate,
        ms,
      );
    // The camera distance that keeps each point of its rims in view, in perspective: a point `a` nearer the camera
    // than the centre and `r` off the line of sight needs r / (distance - a) <= tan(fov / 2).
    const dir = this.direction(),
      p = new THREE.Vector3(),
      tan = Math.tan(THREE.MathUtils.degToRad(this.cam3d.fov / 2));
    let need = 0;
    for (let i = 0; i < 32; i++)
      for (const z of [-zMax, zMax]) {
        p.set(rMax * Math.cos((i * Math.PI) / 16), rMax * Math.sin((i * Math.PI) / 16), z);
        const a = p.dot(dir),
          off = p.addScaledVector(dir, -p.dot(dir)).length();
        need = Math.max(need, a + off / tan);
      }
    this.aim(
      new THREE.Vector3(),
      1.05 * need * Math.sin(THREE.MathUtils.degToRad(this.cam3d.fov / 2)),
      animate,
      ms,
      0,
      dir,
    );
  }

  /** Back to the normal view, animated: the whole event from the current preset's direction (3D: the standard 3/4
   *  view). */
  home(ms = 700) {
    this.fit(undefined, true, ms, 0, this.flat ? undefined : presetDirection(this.view));
  }

  /** frame(), looking along `dir` (3D; default: the current direction). */
  private fit(
    selection: Rows | undefined,
    animate: boolean,
    ms: number,
    swing: number,
    dir?: THREE.Vector3,
    min = this.minRadius,
  ) {
    const box = this.box(selection);
    if (!box) return;
    const [lo, hi] = box;
    const ctr = lo.clone().add(hi).multiplyScalar(0.5),
      size = hi.clone().sub(lo);
    if (this.view !== "3d") {
      // 2D: a margin, and at least the smallest radius framed, as in 3D (a jet's calorimeter part)
      const [w, h] = flatView(this.view).extent(size),
        least = 2 * min;
      return this.aimFlat(ctr, Math.max(1.2 * w, least), Math.max(1.2 * h, least), animate, ms);
    }
    const radius = Math.max(0.68 * size.length() + 0.22 * min, min); // cm: conservative
    this.aim(ctr, radius, animate, ms, swing, dir);
  }

  /** The direction from the target to the 3D camera (unit). */
  private direction() {
    const dir = this.cam3d.position.clone().sub(this.ctl3d.target);
    return dir.lengthSq() < 1e-6 ? presetDirection(this.view) : dir.normalize(); // no direction yet: the preset's
  }

  /** A 2D view: centre on `ctr` (view coordinates) and fit a width x height (cm on screen). */
  private aimFlat(ctr: THREE.Vector3, w: number, h: number, animate: boolean, ms: number) {
    const c = this.cam2d,
      dir = flatView(this.view as Exclude<ViewName, "3d">).dir;
    const { zoom, target } = flatAim(ctr, dir, c.right - c.left, c.top - c.bottom, w, h, this.free());
    this.go([target.clone().addScaledVector(dir, FLAT_DISTANCE), target, zoom], animate, ms, 0);
  }

  /** The part of the view a panel leaves free (fractions of the view). */
  private free() {
    return freeArea(this.width, this.height, this.cover());
  }

  /** 3D: look at a sphere around `ctr` of this radius along `dir` (default: the current direction), filling the part
   *  of the view a panel leaves free and centred there. */
  private aim(ctr: THREE.Vector3, radius: number, animate: boolean, ms: number, swing: number, dir = this.direction()) {
    const f = this.free(),
      aspect = this.cam3d.aspect;
    const dist = this.distanceFor(radius / Math.min(f.y1 - f.y0, (f.x1 - f.x0) * aspect)); // the narrower side decides
    // The free part's centre is off the view's centre: the target moves the other way, by as much at its distance.
    const half = dist * Math.tan(THREE.MathUtils.degToRad(this.cam3d.fov / 2)), // half the view's height there (cm)
      right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize(),
      up = new THREE.Vector3().crossVectors(dir, right);
    const target = ctr
      .addScaledVector(right, -(f.x0 + f.x1 - 1) * half * aspect)
      .addScaledVector(up, (f.y0 + f.y1 - 1) * half);
    this.go([target.clone().addScaledVector(dir, dist), target, 1], animate, ms, swing);
  }

  /** Camera distance at which a sphere of this radius fills the height of the 3D view. */
  private distanceFor(radius: number) {
    return radius / Math.sin(THREE.MathUtils.degToRad(this.cam3d.fov / 2));
  }

  /** Bounding box (view coordinates) of the bulk of the drawn objects, or of the given rows (see boxOf). */
  private box(selection?: Rows): [THREE.Vector3, THREE.Vector3] | null {
    return boxOf(this.drawn, selection, (X, Y, Z, i, out, sideY) => this.toView(X, Y, Z, i, out, sideY));
  }

  /** A point in view coordinates. ρ-z: ρ signed by the side of y, or of `sideY` (a line's end, so a line crossing
   *  y = 0 stays on one side, as drawn). */
  private toView(X: Float32Array, Y: Float32Array, Z: Float32Array, i: number, out: THREE.Vector3, sideY = Y[i]) {
    return this.rz ? out.set(Z[i], Math.hypot(X[i], Y[i]) * (sideY >= 0 ? 1 : -1), 0) : out.set(X[i], Y[i], Z[i]);
  }

  // Camera motion: flights and auto-rotation.

  /** Move the camera to a pose: at once, or in a flight of `ms` (see fly). */
  private go(to: Pose, animate: boolean, ms: number, swing: number) {
    this.flight = animate
      ? {
          t0: performance.now(),
          ms,
          swing,
          from: [this.camera.position.clone(), this.controls.target.clone(), this.camera.zoom],
          to,
        }
      : null;
    if (!animate) this.place(...to);
  }

  /** One step of a flight: the target moves in a straight line while the camera moves around it in spherical
   *  coordinates (shortest way round, plus the swing) with the distance changing geometrically, so zooming feels
   *  even and the camera arcs rather than cutting through the scene. */
  private fly(now: number) {
    const f = this.flight!;
    const t = Math.min(1, (now - f.t0) / f.ms),
      e = t * t * (3 - 2 * t); // smoothstep
    const target = f.from[1].clone().lerp(f.to[1], e);
    const a = new THREE.Spherical().setFromVector3(f.from[0].clone().sub(f.from[1]));
    const b = new THREE.Spherical().setFromVector3(f.to[0].clone().sub(f.to[1]));
    const turn = THREE.MathUtils.euclideanModulo(b.theta - a.theta + Math.PI, 2 * Math.PI) - Math.PI + f.swing;
    // An orbit in progress carries on through the flight at its own speed, so the motion never stops and restarts.
    const spin = this.flat ? 0 : -((2 * Math.PI * this.orbit) / 60) * ((now - f.t0) / 1000);
    const r0 = Math.max(a.radius, 1e-3),
      r = r0 * (Math.max(b.radius, 1e-3) / r0) ** e;
    const offset = new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(r, a.phi + (b.phi - a.phi) * e, a.theta + turn * e + spin),
    );
    this.place(target.clone().add(offset), target, f.from[2] + (f.to[2] - f.from[2]) * e);
    if (t >= 1) this.flight = null;
  }

  /** Put the current camera at `position`, looking at `target`, with this zoom. */
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

  /** Orbit the 3D view around its target; `speed` in turns per minute, 0 stops. Flights keep orbiting. */
  autoRotate(speed: number) {
    this.orbit = speed;
    this.ctl3d.autoRotate = speed > 0;
    this.ctl3d.autoRotateSpeed = speed * 2; // three.js counts 2 as 30 s per turn
  }

  // The tour camera.

  /** Start or stop the tour camera (render/tourCamera.ts). Stopping hands the view back to the user with the same
   *  framing (the optical zoom is turned into distance). */
  tourCamera(on: boolean) {
    if (on && !this.tour) {
      if (this.flat) this.setView("3d");
      this.tour = new TourCamera(this.cam3d.position, this.ctl3d.target, this.cam3d.zoom);
      this.flight = null;
      this.ctl3d.enabled = false;
    } else if (!on && this.tour) {
      const target = this.tour.target,
        zoom = this.cam3d.zoom;
      this.tour = null;
      this.cam3d.position.sub(target).divideScalar(zoom).add(target);
      this.cam3d.zoom = 1;
      this.cam3d.updateProjectionMatrix();
      this.ctl3d.target.copy(target);
      this.ctl3d.enabled = !this.flat;
      this.ctl3d.update();
    }
  }

  /** Tour: glide to the given rows (or everything, from the side) in about `ms`. `room`: how much space around
   *  them is kept in view (1 is tight; larger is further out). */
  tourTo(selection: Rows | undefined, ms: number, room = 1.9) {
    const box = this.box(selection);
    if (!this.tour || !box) return;
    const [lo, hi] = box,
      centre = lo.clone().add(hi).multiplyScalar(0.5),
      radius = Math.max(0.5 * lo.distanceTo(hi) + 15, MIN_RADIUS);
    this.tour.glideTo(centre, this.distanceFor((selection ? room : 1.05) * radius), !!selection, ms);
  }

  /** One frame of the tour camera, `dt` seconds after the last. */
  private tourStep(dt: number) {
    this.envelope ??= envelopeOf(this.drawn);
    this.tour!.step(dt, this.envelope, this.cam3d);
    this.ctl3d.target.copy(this.tour!.target);
    this.requestRender();
  }

  // Animations of the scene: the replay and the selection's cross-fade.

  /** Run the replay set up with planReplay() over `seconds`, from an empty view; `only`: just these layers replay,
   *  the others stay in their final state (e.g. the tour growing in one step's objects). `pace`: real seconds per
   *  second of replay (the tour's pace; 2 is half speed). */
  replay(seconds: number, only?: Layer[], pace = 1) {
    for (const l of only ?? this.layers) l.setClock(0);
    this.draw(); // the first draw uploads the rebuilt layers to the GPU: the clock starts after it, not during it
    this.replayClock = { t0: performance.now(), seconds, only, pace };
  }

  stopReplay() {
    if (!this.replayClock) return;
    this.replayClock = null;
    for (const l of this.layers) l.setClock(REPLAY_OFF);
    this.onReplayTick(null);
    this.requestRender();
  }

  get replaying() {
    return this.replayClock !== null;
  }

  /** One frame of the replay: every replaying layer's clock to the time since its start. */
  private tick(now: number) {
    const t = (now - this.replayClock!.t0) / 1000 / this.replayClock!.pace;
    if (t >= this.replayClock!.seconds) return this.stopReplay();
    for (const l of this.replayClock!.only ?? this.layers) l.setClock(t);
    this.onReplayTick(t);
    this.requestRender();
  }

  /** Whether something is selected: the detector outlines fade as the layers' unrelated objects do (shown at once;
   *  fadeHighlight cross-fades them with the layers). */
  setFocused(on: boolean) {
    this.outlines?.setHighlight(on); // also when unchanged: fadeHighlight then cross-fades from on to on
    this.focused = on;
    this.outlines?.setHighlightMix(1);
    this.requestRender();
  }

  /** Cross-fade every layer from its previous selection to its current one (set with Layer.setHighlight), and the
   *  detector outlines with them. */
  fadeHighlight(ms: number) {
    this.highlightFade = { t0: performance.now(), ms };
    for (const l of this.layers) l.setHighlightMix(0);
    this.outlines?.setHighlightMix(0);
    this.requestRender();
  }

  /** One frame of the selection's cross-fade (smoothstep in time). */
  private fadeStep(now: number) {
    const t = Math.min(1, (now - this.highlightFade!.t0) / this.highlightFade!.ms),
      k = t * t * (3 - 2 * t);
    for (const l of this.layers) l.setHighlightMix(k);
    this.outlines?.setHighlightMix(k);
    if (t >= 1) this.highlightFade = null;
    this.requestRender();
  }

  // From the screen to the objects and back: picking, and where a point is drawn.

  /** The object closest to a screen point (see pickAll), or null. */
  pick(clientX: number, clientY: number, accept?: (table: string, row: number) => boolean): Hit | null {
    return this.pickAll(clientX, clientY, accept)[0] ?? null;
  }

  /** Every layer's closest object under a screen point, best first (see picking.ts pickAll). */
  pickAll(clientX: number, clientY: number, accept?: (table: string, row: number) => boolean): Hit[] {
    const view = { rect: this.canvas.getBoundingClientRect(), camera: this.camera, rz: this.rz };
    return pickAll(this.drawn, view, clientX, clientY, accept);
  }

  /** The view drawn `scale` times its size on screen, copied to a canvas of its own; null when the graphics card
   *  cannot draw that large. Line widths and marker sizes (drawing-buffer pixels) scale with it, so the picture looks
   *  like the screen, only sharper. WebGL clears its drawing buffer once the browser has shown it, so the buffer is
   *  resized, drawn and copied in this one task, then put back. Memory: 4 B per pixel for the buffer and the copy
   *  each (4x of a 1260x890 view: ~72 MB), and several times that for the buffer's antialiasing samples on the GPU. */
  picture(scale: number): HTMLCanvasElement | null {
    const r = this.renderer,
      ratio = r.getPixelRatio(),
      w = Math.floor(this.width * scale), // as three.js sizes the drawing buffer
      h = Math.floor(this.height * scale);
    const f = scale / (globalThis.devicePixelRatio || 1),
      sized: [{ value: number }, number][] = [];
    this.scene.traverse((o) => {
      const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms;
      for (const k of ["uWidth", "uPx"]) if (typeof u?.[k]?.value === "number") sized.push([u[k], u[k].value]);
    });
    let out: HTMLCanvasElement | null = null;
    try {
      r.setPixelRatio(scale);
      const gl = r.getContext();
      if (gl.drawingBufferWidth === w && gl.drawingBufferHeight === h && !gl.isContextLost()) {
        for (const [u, v] of sized) u.value = v * f;
        this.draw(false); // the view alone, without the axis gizmo
        out = Object.assign(document.createElement("canvas"), { width: w, height: h });
        if (!gl.isContextLost()) out.getContext("2d")!.drawImage(this.canvas, 0, 0);
        else out = null; // the card ran out of memory for it
      }
    } finally {
      for (const [u, v] of sized) u.value = v;
      r.setPixelRatio(ratio);
      this.requestRender();
    }
    return out;
  }

  /** Where a point (cm) is drawn, in CSS pixels from the canvas's top left (rho-z: on its own side of the axis), or
   *  null behind the camera. For HTML overlays (labels): call from `onDraw`, which follows every camera move. */
  project(x: number, y: number, z: number): [number, number] | null {
    const v = this.rz ? new THREE.Vector3(z, Math.hypot(x, y) * (y >= 0 ? 1 : -1), 0) : new THREE.Vector3(x, y, z);
    v.applyMatrix4(this.camera.matrixWorldInverse);
    if (!this.flat && v.z >= 0) return null; // behind the perspective camera
    v.applyMatrix4(this.camera.projectionMatrix);
    return [((v.x + 1) / 2) * this.width, ((1 - v.y) / 2) * this.height];
  }
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
  for (const [dir, colour, text] of [
    [new THREE.Vector3(1, 0, 0), "#d73a49", "x"],
    [new THREE.Vector3(0, 1, 0), "#22863a", "y"],
    [new THREE.Vector3(0, 0, 1), "#0366d6", "z"],
  ] as const) {
    scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 0.95, colour, 0.3, 0.18));
    scene.add(label(text, colour, dir.clone().multiplyScalar(1.3)));
  }
  return { scene, camera: new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 10) };
}
