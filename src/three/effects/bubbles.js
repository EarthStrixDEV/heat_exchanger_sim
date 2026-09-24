// Sparse entrained air bubbles: carried by the flow, each at its own speed, with slight buoyancy
// and extra swirl + density where the flow is turbulent (baffles, nozzles, tube entries).
import * as THREE from 'three';
import { TRACER_SPEED, turbulenceMask } from '../layout.js';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    vAlpha = aAlpha;
  }`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0 || vAlpha < 0.01) discard;
    float rim = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.93, 1.0, r));   // refracting edge
    float hl = smoothstep(0.32, 0.0, length(c - vec2(-0.33, 0.35)));           // specular glint
    gl_FragColor = vec4(vec3(0.93, 0.96, 1.0), (rim * 0.5 + hl * 0.75 + 0.03) * vAlpha);
  }`;

export class Bubbles {
  /** @param {{lanes:object[], count:number, maxRise:number, swirl:number}[]} groups */
  constructor(groups, sampleLane) {
    this.sampleLane = sampleLane;
    this.groups = groups;
    const total = groups.reduce((n, g) => n + g.count, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    const size = new Float32Array(total);
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(total), 1));

    let o = 0;
    for (const g of groups) {
      g.offset = o;
      g.lane = new Uint16Array(g.count); g.u = new Float32Array(g.count);
      g.speedK = new Float32Array(g.count); g.rise = new Float32Array(g.count); g.seed = new Float32Array(g.count);
      for (let i = 0; i < g.count; i++) {
        g.lane[i] = Math.floor(Math.random() * g.lanes.length);
        g.u[i] = Math.random();
        g.speedK[i] = 0.75 + Math.random() * 0.5;
        g.seed[i] = Math.random();
        size[o + i] = 0.008 + Math.random() ** 2.5 * 0.026;   // mostly small, a few larger
      }
      g.flow = 0;
      o += g.count;
    }
    this.uniforms = { uScale: { value: 500 } };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.out = [0, 0, 0];
  }

  update(dt, time, pixelScale) {
    this.uniforms.uScale.value = pixelScale;
    const pos = this.points.geometry.attributes.position.array;
    const alpha = this.points.geometry.attributes.aAlpha.array;
    const size = this.points.geometry.attributes.aSize.array;
    const out = this.out;
    for (const g of this.groups) {
      const flowK = Math.min(g.flow / 3, 1);
      for (let i = 0; i < g.count; i++) {
        const k = g.offset + i, lane = g.lanes[g.lane[i]];
        const u = g.u[i] + (TRACER_SPEED * g.flow * g.speedK[i] * dt) / lane.length;
        if (u >= 1) { g.u[i] = u - 1; g.rise[i] = 0; g.lane[i] = Math.floor(Math.random() * g.lanes.length); }
        else g.u[i] = u;
        // Buoyancy: larger bubbles drift up faster, limited by the channel they are in
        g.rise[i] = Math.min(g.rise[i] + dt * size[k] * 2.2, g.maxRise);
        this.sampleLane(lane, g.u[i], out);
        const m = turbulenceMask(out[0]);
        const ph = time * (2 + 5 * flowK) + g.seed[i] * 40;
        const sw = g.swirl * m * (0.3 + flowK);
        pos[k * 3] = out[0];
        pos[k * 3 + 1] = out[1] + g.rise[i] + Math.cos(ph) * sw;
        pos[k * 3 + 2] = out[2] + Math.sin(ph) * sw;
        // Sparse in calm flow, a little denser in turbulent zones
        alpha[k] = g.seed[i] < 0.3 + 0.6 * m * (0.4 + flowK) ? 0.85 : 0;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
