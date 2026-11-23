// The tour camera (beam tours, control/tour.ts): looks at a target from a 3/4 angle, turning slowly (whole event) or
// swaying (close-ups). Angle, elevation, ln(distance) and target follow their goals as critically damped springs, so
// glides start and settle softly and a new goal mid-glide keeps the motion continuous. The camera stays out of the
// detector envelope: where the ideal position is inside, it stops at the envelope and zooms optically by the difference.
import * as THREE from "three";
import { toCylinder } from "./geometry";
import type { Layer } from "./layers";

// Close-ups sway SWAY rad around their view with a period of PERIOD s; the whole event turns once a minute.
const SWAY = 0.35,
  PERIOD = 30,
  SPIN = (2 * Math.PI) / 60; // rad/s
const SPRUNG = ["az", "el", "ld"] as const;

/** An angle in (-pi, pi]. */
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The cylinder around the beam axis (z) that the tour camera stays out of: radius `r` and half length `z` (cm). */
export interface Envelope {
  r: number;
  z: number;
}

/** The drawn objects' extent with 10% + 15 cm to spare. Lines (tracks, particles) are left out: they reach past
 *  the detector. */
export function envelopeOf(layers: Layer[]): Envelope {
  let r2 = 0,
    z = 0;
  for (const l of layers) {
    if (l.line) continue;
    for (let i = 0; i < l.x.length; i++) {
      r2 = Math.max(r2, l.x[i] * l.x[i] + l.y[i] * l.y[i]);
      z = Math.max(z, Math.abs(l.z[i]));
    }
  }
  return { r: 1.1 * Math.sqrt(r2) + 15, z: 1.1 * z + 15 };
}

/** How far from `p` along the unit direction `dir` the envelope is left (0 if `p` is outside it). */
const exitDistance = (env: Envelope, p: THREE.Vector3, dir: THREE.Vector3) =>
  toCylinder(p.x, p.y, p.z, dir.x, dir.y, dir.z, env.r, env.z);

export class TourCamera {
  /** Azimuth and elevation of the camera seen from the target (rad), and ln of its distance (cm). */
  private readonly pose: Record<(typeof SPRUNG)[number], number>;
  readonly target: THREE.Vector3;
  private readonly velocity = { az: 0, el: 0, ld: 0, target: new THREE.Vector3() };
  private goal: { az: number; el: number; ld: number; target: THREE.Vector3; spinWeight: number; omega: number };
  private time = 0; // s since the start, for the sway
  private spin = 0; // rad turned since the last goal
  private spinWeight = 1; // 1: turning (whole event), 0: swaying (close-up); eases towards the goal's
  private readonly acc = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  /** Starts where the camera at `position`, looking at `target` with `zoom`, is. */
  constructor(position: THREE.Vector3, target: THREE.Vector3, zoom: number) {
    this.target = target.clone();
    const off = position.clone().sub(target);
    const ld = Math.log(Math.max(off.length() / zoom, 50)),
      az = Math.atan2(off.x, off.z),
      el = Math.asin(THREE.MathUtils.clamp(off.y / off.length(), -1, 1));
    this.pose = { az, el, ld };
    this.goal = { az, el, ld, target: target.clone(), spinWeight: 1, omega: 3 };
  }

  /** Glide in about `ms` to look at `centre` from `distance` (cm): a close-up (`close`) or the whole event. */
  glideTo(centre: THREE.Vector3, distance: number, close: boolean, ms: number) {
    const p = this.pose;
    p.az += this.spin; // the turn so far becomes the starting angle of the glide
    this.spin = 0;
    // A 3/4 view: from the side for the whole event, from outside its end for a forward shower; the nearer of the two
    // mirror angles, so the camera does not swing across.
    const base = !close || Math.abs(centre.z) < 100 ? 1.2 : centre.z > 0 ? 0.55 : Math.PI - 0.55;
    const az = [base, -base].reduce((a, c) => (Math.abs(angle(c - p.az)) < Math.abs(angle(a - p.az)) ? c : a));
    this.goal = {
      az: p.az + angle(az - p.az),
      el: close ? 0.3 : 0.38,
      ld: Math.log(distance),
      target: centre,
      spinWeight: close ? 0 : 1,
      omega: 6.6 / Math.max(0.4, ms / 1000), // critically damped: about 99% of the way after 6.6 / omega s
    };
  }

  /** Move `dt` seconds on and place `camera` there, outside `envelope`. */
  step(dt: number, envelope: Envelope, camera: THREE.PerspectiveCamera) {
    const p = this.pose,
      v = this.velocity,
      g = this.goal,
      w = g.omega;
    for (let left = dt; left > 1e-6; left -= 0.02) {
      // small steps keep the springs stable on slow frames
      const h = Math.min(0.02, left);
      for (const k of SPRUNG) {
        v[k] += (w * w * (g[k] - p[k]) - 2 * w * v[k]) * h;
        p[k] += v[k] * h;
      }
      this.acc
        .subVectors(g.target, this.target)
        .multiplyScalar(w * w)
        .addScaledVector(v.target, -2 * w);
      v.target.addScaledVector(this.acc, h);
      this.target.addScaledVector(v.target, h);
    }
    this.time += dt;
    this.spinWeight += (g.spinWeight - this.spinWeight) * (1 - Math.exp(-dt * 1.5));
    this.spin += dt * SPIN * this.spinWeight;
    const az = p.az + this.spin + (1 - this.spinWeight) * SWAY * Math.sin((2 * Math.PI * this.time) / PERIOD);
    const dir = this.dir.set(Math.cos(p.el) * Math.sin(az), Math.sin(p.el), Math.cos(p.el) * Math.cos(az));
    const dist = Math.exp(p.ld),
      along = Math.max(dist, exitDistance(envelope, this.target, dir) + 20);
    camera.position.copy(this.target).addScaledVector(dir, along);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    camera.zoom = along / dist;
    camera.updateProjectionMatrix();
  }
}
