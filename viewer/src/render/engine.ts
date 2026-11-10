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
      const dt = Math.min(0.1, (now - last) / 1000); // s; capped so a backgrounded tab does not jump on return
      last = now;
      if (this.replayClock) this.tick(now);
      if (this.highlightFade) this.fadeStep(now);
      if (this.flight) this.fly(now);
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
      const radius = Math.max(0.5 * size.length() + 15, 70); // cm: a shower and its surroundings
      const dir = this.cam3d.position.clone().sub(this.ctl3d.target);
      if (dir.lengthSq() < 1e-6) dir.set(...DIRECTIONS[this.view as Exclude<ViewName, "rz">]); // no direction yet
      dir.normalize();
      const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.cam3d.fov / 2));
      this.go(ctr.clone().addScaledVector(dir, dist), ctr, 1, animate, ms, swing);
    }
  }

  /** The object closest to a screen point, measured in units of its layer's pick radius (so a big shower and a
   *  small cell compete fairly); nothing beyond one radius is picked. Cut-away objects are ignored. */
  pick(clientX: number, clientY: number): Hit | null {
    const r = this.canvas.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    let best: Hit | null = null, bestScore = 1;
    for (const layer of this.layers) {
      for (let i = 0; i < layer.x.length; i++) {
        if (!layer.passes(i)) continue;
        const [x, y, z] = this.toView(layer, i);
        const w = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (w <= 0) continue;
        const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * r.width;
        const sy = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * r.height;
        const score = Math.hypot(sx - px, sy - py) / layer.pickRadius;
        if (score < bestScore) { bestScore = score; best = { table: layer.table, row: i, layer: layer.label }; }
      }
    }
    return best;
  }

  private box(selection?: Map<string, Iterable<number>>): [THREE.Vector3, THREE.Vector3] | null {
    const pts: number[][] = [[], [], []];
    const layers = this.layers.filter((l) => !selection || selection.has(l.table));
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
    return [new THREE.Vector3(...pts.map((a) => q(a, f[0]))), new THREE.Vector3(...pts.map((a) => q(a, f[1])))];
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
