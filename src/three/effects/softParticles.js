// GPU particle field for vapor plumes and cold mist.
// All motion is evaluated in the vertex shader from time + per-particle seeds: no CPU work per frame.
// Density per particle (aStrength) is set from simulation state in setStrengths().
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aStrength;
  uniform float uTime, uLifeMin, uLifeMax, uRise, uTurb, uSize0, uSize1, uOpacity, uScale;
  uniform vec3 uDrift, uJitter;
  varying float vAlpha;
  varying float vSeed;

  float h1(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    float life = mix(uLifeMin, uLifeMax, aSeed.x);
    float clock = uTime + aSeed.y * 37.0;
    float age = mod(clock, life);
    float t = age / life;
    float cyc = floor(clock / life);             // new spawn offset every cycle

    vec3 p = position + (vec3(h1(cyc * 12.9 + aSeed.x * 78.2), h1(cyc * 4.1 + aSeed.z * 31.7),
                              h1(cyc * 7.7 + aSeed.w * 53.3)) - 0.5) * uJitter;
    p += uDrift * age;
    p.y += uRise * age;

    // Turbulent wander that grows as the parcel ages
    float ph = aSeed.z * 6.2831;
    float amp = uTurb * (0.04 + 0.32 * t);
    p.x += amp * (sin(age * 1.7 + ph) + 0.5 * sin(age * 3.3 + ph * 2.3));
    p.z += amp * (cos(age * 1.3 + ph * 1.7) + 0.5 * sin(age * 2.9 + ph));
    p.y += amp * 0.35 * sin(age * 2.3 + ph * 0.7);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = mix(uSize0, uSize1, t) * (0.6 + 0.8 * aSeed.w);   // slow expansion
    gl_PointSize = size * uScale / max(-mv.z, 0.1);

    float dens = step(fract(aSeed.x * 13.17 + aSeed.w * 3.1), aStrength);   // density follows strength
    float fade = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.45, 1.0, t));
    vAlpha = uOpacity * dens * fade * (0.45 + 0.55 * aSeed.z) * clamp(aStrength * 1.5, 0.0, 1.0);
    vSeed = aSeed.y;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying float vAlpha;
  varying float vSeed;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    if (vAlpha < 0.001) discard;
    vec2 c = gl_PointCoord - 0.5;
    float n = fbm(c * 3.2 + vSeed * 17.0 + vec2(uTime * 0.06, -uTime * 0.04));
    // Noise-warped radial falloff → no visible disc edge
    float r = length(c) * 2.0 + (n - 0.5) * 0.7;
    float a = 1.0 - smoothstep(0.0, 1.0, r);
    a = a * a * smoothstep(0.2, 0.75, n);
    gl_FragColor = vec4(uColor, a * vAlpha);
  }`;

export class SoftParticleField {
  /**
   * @param {object} o
   * @param {number} o.count
   * @param {(i:number)=>number[]} o.spawn   returns [x,y,z] spawn position
   */
  constructor({ count, spawn, color, lifeMin, lifeMax, rise, drift = [0, 0, 0], jitter = [0.1, 0.05, 0.1],
    turb, size0, size1, opacity }) {
    const pos = new Float32Array(count * 3), seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos.set(spawn(i), i * 3);
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aStrength', new THREE.BufferAttribute(new Float32Array(count), 1));

    this.uniforms = {
      uTime: { value: 0 }, uLifeMin: { value: lifeMin }, uLifeMax: { value: lifeMax },
      uRise: { value: rise }, uTurb: { value: turb }, uSize0: { value: size0 }, uSize1: { value: size1 },
      uOpacity: { value: opacity }, uScale: { value: 500 },
      uDrift: { value: new THREE.Vector3(...drift) }, uJitter: { value: new THREE.Vector3(...jitter) },
      uColor: { value: new THREE.Color(color) },
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader, fragmentShader,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** strengthAt(x, y, z) → 0..1 particle density at that spawn point. */
  setStrengths(strengthAt) {
    const pos = this.points.geometry.attributes.position.array;
    const s = this.points.geometry.attributes.aStrength;
    for (let i = 0; i < s.count; i++) s.array[i] = strengthAt(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    s.needsUpdate = true;
  }

  update(time, pixelScale) {
    this.uniforms.uTime.value = time;
    this.uniforms.uScale.value = pixelScale;
  }
}
