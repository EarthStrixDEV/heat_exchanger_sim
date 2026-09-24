// Physically based water for Realistic / Flow modes: transmission + refraction (IOR 1.333),
// Fresnel & environment reflection, slight blue-green absorption, and an animated normal
// perturbation whose strength comes from flow rate, temperature and local turbulence.
import * as THREE from 'three';
import { TURBULENCE_GLSL } from '../layout.js';

export function createWaterMaterial(normalMap, repeat) {
  const nm = normalMap.clone();
  nm.repeat.set(...repeat);
  nm.needsUpdate = true;

  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', metalness: 0, roughness: 0.03,
    transmission: 1, thickness: 0.15, ior: 1.333,
    attenuationColor: new THREE.Color('#9fcfc6'), attenuationDistance: 0.9,
    specularIntensity: 0.8, envMapIntensity: 0.8,
    side: THREE.DoubleSide, depthWrite: false,
    normalMap: nm, normalScale: new THREE.Vector2(0.12, 0.12),
  });

  // uRipple: base micro-ripple, uTurb: extra eddies near baffles/nozzles,
  // uFlow: advection speed, uDir: +1 flows to +x, −1 to −x
  const uniforms = {
    uTime: { value: 0 }, uRipple: { value: 0.05 }, uTurb: { value: 0.1 },
    uFlow: { value: 1 }, uDir: { value: 1 },
  };
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHxPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 hxP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          hxP = instanceMatrix * hxP;
        #endif
        vHxPos = (modelMatrix * hxP).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vHxPos;
        uniform float uTime, uRipple, uTurb, uFlow, uDir;
        ${TURBULENCE_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float t = uTime;
          vec3 q = vHxPos * 6.0;
          q.x -= t * uFlow * uDir * 3.0;           // ripples advect with the flow
          vec2 d = vec2(
            sin(q.x * 0.9 + q.y * 1.3 + t * 2.1) + 0.6 * sin(q.z * 1.7 - q.x * 0.6 + t * 1.3),
            cos(q.y * 1.1 - q.z * 0.8 + t * 1.7) + 0.6 * cos(q.x * 1.4 + q.z * 0.9 - t * 2.6));
          vec3 e = vHxPos * 22.0;                  // fine eddies where the flow is disturbed
          e.x -= t * uFlow * uDir * 6.0;
          vec2 d2 = vec2(sin(e.y + e.z * 1.3 + e.x * 0.7 + t * 5.0), cos(e.z - e.y * 1.1 + e.x * 0.5 + t * 4.3));
          normal = normalize(normal + vec3(d * uRipple + d2 * hxTurb(vHxPos.x) * uTurb, 0.0));
        }`);
  };
  mat.customProgramCacheKey = () => 'hx-water';
  return mat;
}
