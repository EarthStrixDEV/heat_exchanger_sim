// Screen-space heat haze: a very small refractive offset in the air rising above hot surfaces.
// Each emitter is projected to screen space every frame; strength comes from surface temperature.
import * as THREE from 'three';

export const MAX_HAZE_EMITTERS = 6;

export const HeatHazeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uEmitters: { value: Array.from({ length: MAX_HAZE_EMITTERS }, () => new THREE.Vector4()) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect;
    uniform vec4 uEmitters[${MAX_HAZE_EMITTERS}];   // xy: source uv, z: plume height (uv), w: strength 0..1
    varying vec2 vUv;
    void main() {
      vec2 off = vec2(0.0);
      for (int i = 0; i < ${MAX_HAZE_EMITTERS}; i++) {
        vec4 e = uEmitters[i];
        if (e.w <= 0.0) continue;
        vec2 d = vUv - e.xy;
        d.x *= uAspect;
        float up = d.y / e.z;
        float width = e.z * (0.45 + 0.35 * max(up, 0.0));      // plume widens as it rises
        float m = smoothstep(-0.05, 0.2, up) * (1.0 - smoothstep(0.7, 2.2, up)) * exp(-pow(d.x / width, 2.0));
        vec2 n = vec2(
          sin(vUv.y * 140.0 - uTime * 5.5 + sin(vUv.x * 90.0 + uTime * 1.7) * 1.3),
          sin(vUv.y * 110.0 - uTime * 4.3 + vUv.x * 70.0));
        off += n * m * e.w;
      }
      gl_FragColor = texture2D(tDiffuse, vUv + off * 0.0028);
    }`,
};
