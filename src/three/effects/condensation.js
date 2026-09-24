// Condensation on the outer shell wherever the local wall temperature is below the dew point.
// Droplets nucleate, grow and merge; big ones slide down the curved shell leaving a thin
// wet trail, then drip off the bottom edge. Two InstancedMeshes, CPU-updated (~1k instances).
import * as THREE from 'three';
import { HALF, SHELL_OUTER_R, FLOOR_Y } from '../layout.js';

const N = 650, TRAIL_N = 500;
const R_CRIT = 0.016;         // radius where gravity beats surface tension
const TRAIL_LIFE = 5;         // s
const X_SPAN = HALF - 0.14;   // shell outer surface between the flanges
const GRAVITY = 3.5;          // visual units/s²

const GROW = 0, SLIDE = 1, FALL = 2;

export class Condensation {
  constructor(material) {
    const geo = new THREE.SphereGeometry(1, 10, 8);
    this.drops = new THREE.InstancedMesh(geo, material, N);
    this.trails = new THREE.InstancedMesh(geo, material, TRAIL_N);
    for (const m of [this.drops, this.trails]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
    }
    this.group = new THREE.Group();
    this.group.add(this.drops, this.trails);

    this.x = new Float32Array(N); this.phi = new Float32Array(N); this.r = new Float32Array(N);
    this.state = new Uint8Array(N); this.seed = new Float32Array(N);
    this.fy = new Float32Array(N); this.fz = new Float32Array(N); this.vy = new Float32Array(N);
    this.lastTrail = new Float32Array(N);
    for (let i = 0; i < N; i++) this.#spawn(i, true);

    this.tx = new Float32Array(TRAIL_N); this.tphi = new Float32Array(TRAIL_N);
    this.tr = new Float32Array(TRAIL_N); this.tage = new Float32Array(TRAIL_N).fill(TRAIL_LIFE);
    this.trailHead = 0;

    this.coverageAt = () => 0; // (x) → 0..1, set from simulation
    this.wetness = 0;
    this.m = new THREE.Matrix4();
    this.v = { a: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(), t: new THREE.Vector3(), p: new THREE.Vector3() };
  }

  #spawn(i, initial = false) {
    this.x[i] = (Math.random() * 2 - 1) * X_SPAN;
    this.phi[i] = Math.random() * Math.PI * 2;   // 0 = top, π = bottom
    this.r[i] = (initial ? Math.random() : 0.15) * R_CRIT * 0.8;
    this.state[i] = GROW;
    this.seed[i] = Math.random();
    this.lastTrail[i] = this.phi[i];
  }

  #emitTrail(x, phi, r) {
    const k = this.trailHead;
    this.trailHead = (k + 1) % TRAIL_N;
    this.tx[k] = x; this.tphi[k] = phi; this.tr[k] = r; this.tage[k] = 0;
  }

  /** Orient a flattened ellipsoid on the shell surface; stretch along the downhill tangent. */
  #surfaceMatrix(x, phi, rx, rn, rt) {
    const { a, n, t, p } = this.v;
    const c = Math.cos(phi), s = Math.sin(phi);
    n.set(0, c, s);
    t.set(0, -s, c);
    p.set(x, SHELL_OUTER_R * c, SHELL_OUTER_R * s).addScaledVector(n, rn * 0.35);
    this.m.makeBasis(a.clone().multiplyScalar(rx), n.clone().multiplyScalar(rn), t.clone().multiplyScalar(rt));
    return this.m.setPosition(p);
  }

  update(dt) {
    const zero = this.m.makeScale(0, 0, 0).clone();
    let wetSum = 0;
    for (let i = 0; i < N; i++) {
      const cov = this.coverageAt(this.x[i]);
      wetSum += cov;
      if (this.state[i] !== FALL && this.seed[i] >= cov * 0.95) {
        // Wall too warm here: this droplet evaporates / never forms
        this.r[i] = Math.max(0, this.r[i] - dt * 0.004);
        if (this.r[i] <= 0.0005) { this.drops.setMatrixAt(i, zero); continue; }
      } else if (this.state[i] === GROW) {
        this.r[i] += dt * 0.0025 * cov * (0.3 + this.seed[i]);
        if (Math.random() < dt * 0.03 * cov) this.r[i] *= 1.26;            // coalescence with a neighbour
        if (this.r[i] > R_CRIT && Math.abs(Math.cos(this.phi[i])) < 0.97) this.state[i] = SLIDE;
      } else if (this.state[i] === SLIDE) {
        const dir = this.phi[i] < Math.PI ? 1 : -1;
        const speed = 0.06 * (this.r[i] / R_CRIT) ** 2 * Math.abs(Math.sin(this.phi[i]) + 0.25 * dir);
        this.phi[i] += (dir * speed * dt) / SHELL_OUTER_R;
        this.r[i] += dt * 0.0015 * cov;                                     // sweeps up small drops
        if (Math.abs(this.phi[i] - this.lastTrail[i]) * SHELL_OUTER_R > 0.018) {
          this.#emitTrail(this.x[i], this.phi[i], this.r[i]);
          this.lastTrail[i] = this.phi[i];
        }
        if (Math.abs(this.phi[i] - Math.PI) < 0.06) {                      // reached the bottom edge → drip
          this.state[i] = FALL;
          this.fy[i] = -SHELL_OUTER_R - this.r[i];
          this.fz[i] = SHELL_OUTER_R * Math.sin(this.phi[i]);
          this.vy[i] = 0;
        }
      }

      if (this.state[i] === FALL) {
        this.vy[i] -= GRAVITY * dt;
        this.fy[i] += this.vy[i] * dt;
        if (this.fy[i] < FLOOR_Y) { this.#spawn(i); this.drops.setMatrixAt(i, zero); continue; }
        const r = Math.min(this.r[i], 0.02);
        this.m.makeScale(r, r * 1.5, r).setPosition(this.x[i], this.fy[i], this.fz[i]);
        this.drops.setMatrixAt(i, this.m);
        continue;
      }
      const r = this.r[i], sliding = this.state[i] === SLIDE;
      this.drops.setMatrixAt(i, this.#surfaceMatrix(this.x[i], this.phi[i], r, r * 0.55, sliding ? r * 1.6 : r));
    }

    for (let k = 0; k < TRAIL_N; k++) {
      this.tage[k] += dt;
      const life = 1 - this.tage[k] / TRAIL_LIFE;
      if (life <= 0) { this.trails.setMatrixAt(k, zero); continue; }
      const r = this.tr[k] * 0.55 * life;
      this.trails.setMatrixAt(k, this.#surfaceMatrix(this.tx[k], this.tphi[k], r, r * 0.12, r * 2.2));
    }

    this.drops.instanceMatrix.needsUpdate = true;
    this.trails.instanceMatrix.needsUpdate = true;
    this.wetness = wetSum / N;
  }
}
