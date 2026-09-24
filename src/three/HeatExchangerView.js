// Three.js rendering only. Receives solved results from physics.js; never computes heat transfer itself.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  L, HALF, R, SHELL_OUTER_R, TUBE_R, CORE_R, PITCH, BAFFLE_X, BAFFLE_CHORD, HEAD_X, COLD_NOZ_X, FLOOR_Y,
  TRACER_SPEED, xToS, turbulenceMask,
} from './layout.js';
import { dewPoint } from '../lib/ambient.js';
import { createWaterMaterial } from './effects/waterMaterial.js';
import { SoftParticleField } from './effects/softParticles.js';
import { Condensation } from './effects/condensation.js';
import { Bubbles } from './effects/bubbles.js';
import { HeatHazeShader, MAX_HAZE_EMITTERS } from './effects/heatHaze.js';

const HOT_TRACERS = 900, COLD_TRACERS = 700;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const FLOW_TRACER_COLORS = { hot: new THREE.Color('#d9a066'), cold: new THREE.Color('#4f86c6') };

// Colour scale stretches to the current Tci–Thi range (set in setResult)
const T_SCALE = { min: 0, max: 150 };
export const COLOR_STOPS = ['#1d3f8a', '#2b97c4', '#e2cf55', '#e8832e', '#b8321f'];
const STOPS = COLOR_STOPS.map((c, i) => [i / (COLOR_STOPS.length - 1), new THREE.Color(c)]);

export function tempToColor(T, out = new THREE.Color()) {
  const t = THREE.MathUtils.clamp((T - T_SCALE.min) / (T_SCALE.max - T_SCALE.min), 0, 1);
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i];
      return out.copy(c0).lerp(c1, (t - t0) / (t1 - t0));
    }
  }
  return out.copy(STOPS[STOPS.length - 1][1]);
}

/** Cylinder along X. */
function cylX(rTop, rBot, len, radial, heightSeg = 1, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, radial, heightSeg, open);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** Tileable ripple normal map for subtle liquid motion. */
function makeRippleNormalMap() {
  const N = 256, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N);
  const TAU = Math.PI * 2;
  const h = (x, y) =>
    Math.sin(TAU * (2 * x + 1 * y)) * 0.5 + Math.sin(TAU * (3 * x - 2 * y) + 1.3) * 0.35 +
    Math.sin(TAU * (5 * x + 4 * y) + 2.1) * 0.2 + Math.sin(TAU * (1 * x + 6 * y) + 0.7) * 0.25;
  const e = 1 / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / N, y = j / N;
    const dx = (h(x + e, y) - h(x - e, y)) * 0.5, dy = (h(x, y + e) - h(x, y - e)) * 0.5;
    const n = new THREE.Vector3(-dx * 40, -dy * 40, 1).normalize();
    const k = (j * N + i) * 4;
    img.data[k] = (n.x * 0.5 + 0.5) * 255;
    img.data[k + 1] = (n.y * 0.5 + 0.5) * 255;
    img.data[k + 2] = (n.z * 0.5 + 0.5) * 255;
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeDotSprite() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

/** Resample a curve into evenly spaced points (arc-length) for fast lookup. */
function laneFromCurve(curve, n = 320) {
  const pts = curve.getSpacedPoints(n - 1);
  const arr = new Float32Array(n * 3);
  pts.forEach((p, i) => p.toArray(arr, i * 3));
  return { pts: arr, n, length: curve.getLength() };
}

function sampleLane(lane, u, out) {
  const f = u * (lane.n - 1), i = Math.min(Math.floor(f), lane.n - 2), t = f - i, a = i * 3, b = a + 3, p = lane.pts;
  out[0] = p[a] + (p[b] - p[a]) * t;
  out[1] = p[a + 1] + (p[b + 1] - p[a + 1]) * t;
  out[2] = p[a + 2] + (p[b + 2] - p[a + 2]) * t;
}

export const CAMERA_PRESETS = {
  overview:  { pos: [8.5, 5, 11], target: [0, -0.2, 0], mode: 'solid' },
  cutaway:   { pos: [1, 3.4, 10.5], target: [0, -0.2, 0], mode: 'cutaway' },
  bundle:    { pos: [-1.9, 0.35, 1.7], target: [1.6, 0, -0.2], mode: 'cutaway' },
  hot:       { pos: [-6.4, 2.2, 3.6], target: [-3.1, 0.3, 0], mode: 'cutaway' },
  cold:      { pos: [4.6, -0.2, 4.2], target: [2.2, 0, 0], mode: 'cutaway' },
};

export class HeatExchangerView {
  constructor(container) {
    this.container = container;
    this.onSensorClick = null;
    this.onFrame = null;
    this.result = null;
    this.lut = { Th: new Float32Array(101), Tc: new Float32Array(101) };

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.localClippingEnabled = true;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#1e2023');
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 25;

    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.001); // removes z > 0 half

    this.#buildLights();
    this.#buildMaterials();
    this.#buildEquipment();
    this.#buildFluids();
    this.#buildTracers();
    this.#buildSensors();
    this.#buildEffects();

    // Post: scene → heat haze → tone mapping / sRGB
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.hazePass = new ShaderPass(HeatHazeShader);
    this.composer.addPass(this.hazePass);
    this.composer.addPass(new OutputPass());

    this.raycaster = new THREE.Raycaster();
    this.#bindPointer();

    this.clock = new THREE.Clock();
    this.time = 0;
    this.tween = null;
    this.ambient = { Ta: 30, RH: 70 };
    this.setViewMode('realistic');
    this.setShellMode('cutaway');
    this.goPreset('cutaway', true);

    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(container);
    this.#resize();
    r.setAnimationLoop(() => this.#tick());
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) { m.map?.dispose(); m.normalMap?.dispose(); m.dispose(); }
    });
    for (const m of Object.values(this.water)) { m.normalMap?.dispose(); m.dispose(); }
    this.scene.environment?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- build ----------
  #buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#c9d2dc', '#2a2622', 0.35));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 5, bottom: -5, near: 1, far: 30 });
    key.shadow.bias = -0.0004;
    s.add(key);
    const rim = new THREE.DirectionalLight('#9fb4cc', 0.5);
    rim.position.set(-6, 3, -5);
    s.add(rim);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: '#26292d', roughness: 0.92, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    s.add(floor);
    const grid = new THREE.GridHelper(40, 80, '#34383d', '#2d3034');
    grid.position.y = FLOOR_Y + 0.002;
    s.add(grid);
  }

  #buildMaterials() {
    const steel = (color, rough) => new THREE.MeshPhysicalMaterial({
      color, metalness: 1, roughness: rough, side: THREE.DoubleSide, envMapIntensity: 0.85,
    });
    this.mats = {
      shell: steel('#c3c7cc', 0.3),
      head: steel('#bcc1c7', 0.34),
      flange: steel('#9aa0a7', 0.4),
      tubesheet: steel('#a9aeb4', 0.36),
      tube: steel('#d2d5d9', 0.24),
      baffle: steel('#8f959c', 0.45),
      nozzle: steel('#b6bbc1', 0.32),
      support: new THREE.MeshStandardMaterial({ color: '#3f4448', roughness: 0.7, metalness: 0.4 }),
      sensorBody: new THREE.MeshStandardMaterial({ color: '#2f3337', roughness: 0.5, metalness: 0.6 }),
    };
    this.ripple = makeRippleNormalMap();
    const fluid = (opacity, repeat) => {
      const nm = this.ripple.clone();
      nm.repeat.set(...repeat);
      nm.needsUpdate = true;
      return new THREE.MeshPhysicalMaterial({
        // Low env/clearcoat so reflections don't wash out the temperature colour
        color: '#ffffff', vertexColors: true, metalness: 0, roughness: 0.2,
        clearcoat: 0.25, clearcoatRoughness: 0.15, ior: 1.33, specularIntensity: 0.4,
        transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
        normalMap: nm, normalScale: new THREE.Vector2(0.18, 0.18), envMapIntensity: 0.3,
      });
    };
    this.mats.tubeFluid = fluid(0.95, [2, 24]);
    this.mats.tubeFluid.side = THREE.FrontSide;
    this.mats.shellFluid = fluid(0.4, [6, 5]);
    this.mats.headFluidL = fluid(0.55, [3, 1]);
    this.mats.headFluidR = fluid(0.55, [3, 1]);
    this.mats.headFluidL.vertexColors = this.mats.headFluidR.vertexColors = false;

    const m = this.mats;
    this.sectionMats = [m.shell, m.head, m.flange, m.tubesheet, m.tube, m.shellFluid, m.headFluidL, m.headFluidR];
    this.housingMats = [m.shell, m.head];
  }

  #add(geo, mat, pos = [0, 0, 0], shadow = true) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    this.scene.add(mesh);
    return mesh;
  }

  #buildEquipment() {
    const m = this.mats;
    // Shell
    this.#add(cylX(R + 0.03, R + 0.03, L - 0.1, 128, 1, true), m.shell);

    // Tubesheets, flanges & bolts at both ends
    const boltGeo = cylX(0.028, 0.028, 0.34, 10);
    const bolts = new THREE.InstancedMesh(boltGeo, m.flange, 48);
    let bi = 0;
    const dummy = new THREE.Object3D();
    for (const sgn of [-1, 1]) {
      this.#add(cylX(R + 0.1, R + 0.1, 0.06, 128), m.tubesheet, [sgn * HALF, 0, 0]);
      this.#add(cylX(R + 0.24, R + 0.24, 0.09, 128), m.flange, [sgn * (HALF - 0.075), 0, 0]);
      this.#add(cylX(R + 0.24, R + 0.24, 0.09, 128), m.flange, [sgn * (HALF + 0.075), 0, 0]);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        dummy.position.set(sgn * HALF, Math.cos(a) * (R + 0.17), Math.sin(a) * (R + 0.17));
        dummy.updateMatrix();
        bolts.setMatrixAt(bi++, dummy.matrix);
      }
      // Channel head: short barrel + elliptical dome
      this.#add(cylX(R + 0.03, R + 0.03, 0.44, 128, 1, true), m.head, [sgn * (HALF + 0.34), 0, 0]);
      const dome = new THREE.SphereGeometry(R + 0.03, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.rotateZ(sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
      this.#add(dome, m.head, [sgn * (HALF + 0.56), 0, 0]).scale.set(0.45, 1, 1);
    }
    bolts.castShadow = true;
    this.scene.add(bolts);

    // Tube bundle (hex, 3 rings = 37 tubes)
    this.tubePositions = [];
    for (let q = -3; q <= 3; q++) for (let rr = -3; rr <= 3; rr++) {
      if (Math.max(Math.abs(q), Math.abs(rr), Math.abs(q + rr)) > 3) continue;
      this.tubePositions.push([PITCH * rr * Math.sqrt(3) / 2, PITCH * (q + rr / 2)]);
    }
    const tubes = new THREE.InstancedMesh(cylX(TUBE_R, TUBE_R, L, 20, 1, true), m.tube, this.tubePositions.length);
    this.tubePositions.forEach(([y, z], i) => {
      dummy.position.set(0, y, z);
      dummy.updateMatrix();
      tubes.setMatrixAt(i, dummy.matrix);
    });
    tubes.castShadow = true;
    this.scene.add(tubes);

    // Segmental baffles, alternating window bottom / top
    const a = Math.asin(BAFFLE_CHORD / R);
    const shape = new THREE.Shape();
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const th = (Math.PI - a) + (i / steps) * (Math.PI + 2 * a); // arc below the chord
      const p = [Math.cos(th) * (R - 0.01), Math.sin(th) * (R - 0.01)];
      i === 0 ? shape.moveTo(...p) : shape.lineTo(...p);
    }
    shape.closePath();
    const baffleGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false, curveSegments: 1 });
    baffleGeo.translate(0, 0, -0.0125);
    baffleGeo.rotateY(Math.PI / 2);
    BAFFLE_X.forEach((x, j) => {
      const b = this.#add(baffleGeo, m.baffle, [x, 0, 0]);
      // shape covers y ≤ chord (window on top). Even j → window at bottom → flip.
      if (j % 2 === 0) b.rotation.x = Math.PI;
    });

    // Nozzles
    this.nozzles = {
      hotIn:   this.#nozzle(-HEAD_X, 1),
      hotOut:  this.#nozzle(HEAD_X, -1),
      coldIn:  this.#nozzle(COLD_NOZ_X, 1),
      coldOut: this.#nozzle(-COLD_NOZ_X, -1),
    };

    // Saddle supports
    for (const x of [-1.6, 1.6]) {
      const h = -R - 0.04 - FLOOR_Y;
      this.#add(new THREE.BoxGeometry(0.22, h, 1.3), m.support, [x, FLOOR_Y + h / 2, 0]);
      this.#add(new THREE.BoxGeometry(0.5, 0.05, 1.5), m.support, [x, FLOOR_Y + 0.025, 0]);
    }
  }

  #nozzle(x, dir) {
    const m = this.mats;
    const g = new THREE.CylinderGeometry(0.13, 0.13, 0.62, 48, 1, true);
    this.#add(g, m.nozzle, [x, dir * (R + 0.26), 0]);
    this.#add(new THREE.CylinderGeometry(0.23, 0.23, 0.07, 48), m.flange, [x, dir * (R + 0.57), 0]);
    this.#add(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 48), m.nozzle, [x, dir * (R + 0.08), 0]); // reinforcement pad
    return { x, dir, sensorPos: new THREE.Vector3(x, dir * (R + 0.36), 0.13) };
  }

  #buildFluids() {
    const m = this.mats;
    // Tube-side fluid cores (share one geometry → one colour update)
    this.coreGeo = cylX(CORE_R, CORE_R, L, 14, 90);
    this.coreGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.coreGeo.attributes.position.count * 3), 3));
    const cores = this.coreMesh = new THREE.InstancedMesh(this.coreGeo, m.tubeFluid, this.tubePositions.length);
    cores.renderOrder = 1; // no depth write → tracers inside the core stay visible
    const d = new THREE.Object3D();
    this.tubePositions.forEach(([y, z], i) => { d.position.set(0, y, z); d.updateMatrix(); cores.setMatrixAt(i, d.matrix); });
    this.scene.add(cores);

    // Shell-side fluid volume
    this.shellFluidGeo = cylX(R - 0.005, R - 0.005, L - 0.07, 96, 90);
    this.shellFluidGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.shellFluidGeo.attributes.position.count * 3), 3));
    const sf = this.shellFluidMesh = new THREE.Mesh(this.shellFluidGeo, m.shellFluid);
    sf.renderOrder = 2;
    this.scene.add(sf);

    // Channel-head fluid (uniform: inlet / outlet temperature)
    this.headFluidMeshes = [];
    for (const [sgn, mat] of [[-1, m.headFluidL], [1, m.headFluidR]]) {
      const barrel = new THREE.Mesh(cylX(R - 0.01, R - 0.01, 0.44, 64), mat);
      barrel.position.x = sgn * (HALF + 0.34);
      const dome = new THREE.SphereGeometry(R - 0.01, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.rotateZ(sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
      const dm = new THREE.Mesh(dome, mat);
      dm.position.x = sgn * (HALF + 0.56);
      dm.scale.set(0.43, 1, 1);
      barrel.renderOrder = dm.renderOrder = 2;
      this.scene.add(barrel, dm);
      this.headFluidMeshes.push({ mesh: barrel, tempMat: mat }, { mesh: dm, tempMat: mat });
    }
  }

  #buildTracers() {
    const rnd = (a, b) => a + Math.random() * (b - a);
    // Hot lanes: inlet nozzle → left head → tube → right head → outlet nozzle
    this.hotLanes = this.tubePositions.map(([ty, tz]) => {
      const pts = [
        new THREE.Vector3(-HEAD_X, R + 0.6, 0),
        new THREE.Vector3(-HEAD_X, R - 0.1, tz * 0.3),
        new THREE.Vector3(-HEAD_X + 0.05, ty * 0.7 + 0.15, tz * 0.8),
        new THREE.Vector3(-HALF - 0.04, ty, tz),
      ];
      for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(-HALF + (L * i) / 8, ty, tz));
      pts.push(
        new THREE.Vector3(HALF + 0.04, ty, tz),
        new THREE.Vector3(HEAD_X - 0.05, ty * 0.7 - 0.15, tz * 0.8),
        new THREE.Vector3(HEAD_X, -R + 0.1, tz * 0.3),
        new THREE.Vector3(HEAD_X, -R - 0.6, 0),
      );
      return laneFromCurve(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 400);
    });

    // Cold lanes: shell-side zig-zag through baffle windows
    this.coldLanes = [];
    for (let k = 0; k < 28; k++) {
      const zr = rnd(-1, 1);
      const pts = [
        new THREE.Vector3(COLD_NOZ_X, R + 0.6, 0),
        new THREE.Vector3(COLD_NOZ_X - rnd(0, 0.1), R * 0.5, zr * 0.25),
      ];
      BAFFLE_X.forEach((bx, j) => {
        const wy = j % 2 === 0 ? -0.6 : 0.6;
        pts.push(new THREE.Vector3(bx + 0.5, rnd(-0.15, 0.15), zr * 0.55));
        pts.push(new THREE.Vector3(bx, wy + rnd(-0.08, 0.08), zr * 0.38));
      });
      pts.push(
        new THREE.Vector3(-COLD_NOZ_X + rnd(0, 0.1), -R * 0.5, zr * 0.25),
        new THREE.Vector3(-COLD_NOZ_X, -R - 0.6, 0),
      );
      this.coldLanes.push(laneFromCurve(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 500));
    }

    const sprite = makeDotSprite();
    const mk = (count, lanes) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.065, map: sprite, vertexColors: true, transparent: true, alphaTest: 0.25,
        depthWrite: false, sizeAttenuation: true,
      }));
      pts.renderOrder = 3;
      pts.frustumCulled = false;
      this.scene.add(pts);
      const lane = new Uint16Array(count), u = new Float32Array(count);
      for (let i = 0; i < count; i++) { lane[i] = i % lanes.length; u[i] = Math.random(); }
      return { pts, geo, lane, u, lanes, speed: 0 };
    };
    this.hotTracers = Object.assign(mk(HOT_TRACERS, this.hotLanes), { side: 'hot', swirl: 0.012 });
    this.coldTracers = Object.assign(mk(COLD_TRACERS, this.coldLanes), { side: 'cold', swirl: 0.05 });
  }

  #buildEffects() {
    const rnd = (a, b) => a + Math.random() * (b - a);

    // Real water for Realistic / Flow modes (tube cores are not section-cut, heads & shell are)
    this.water = {
      hot: createWaterMaterial(this.ripple, [2, 24]),
      head: createWaterMaterial(this.ripple, [3, 1]),
      cold: createWaterMaterial(this.ripple, [6, 5]),
    };
    this.water.hot.side = THREE.FrontSide;
    this.water.hot.thickness = 0.05;   // tube core is only ~0.07 across
    this.water.cold.userData.uniforms.uDir.value = -1;
    this.sectionMats.push(this.water.head, this.water.cold);

    // Water surfaces exposed by the section cut (z = 0): shell side + both channel heads
    this.water.capShell = createWaterMaterial(this.ripple, [6, 2]);
    this.water.capShell.userData.uniforms.uDir.value = -1;
    this.water.capHead = createWaterMaterial(this.ripple, [2, 2]);
    for (const m of [this.water.capShell, this.water.capHead]) { m.side = THREE.FrontSide; m.thickness = 0.25; m.attenuationDistance = 0.3; }
    const shellCap = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.07, 2 * (R - 0.005), 1, 1), this.water.capShell);
    this.capMeshes = [shellCap];
    const hb = R - 0.01, ha = 0.43 * hb, x0 = HALF + 0.12, x1 = HALF + 0.56;
    for (const sgn of [-1, 1]) {
      const s = new THREE.Shape();
      if (sgn > 0) {
        s.moveTo(x0, -hb); s.lineTo(x1, -hb); s.absellipse(x1, 0, ha, hb, -Math.PI / 2, Math.PI / 2, false); s.lineTo(x0, hb);
      } else {
        s.moveTo(-x0, hb); s.lineTo(-x1, hb); s.absellipse(-x1, 0, ha, hb, Math.PI / 2, Math.PI * 1.5, false); s.lineTo(-x0, -hb);
      }
      s.closePath();
      this.capMeshes.push(new THREE.Mesh(new THREE.ShapeGeometry(s, 32), this.water.capHead));
    }
    for (const c of this.capMeshes) { c.renderOrder = 2; this.scene.add(c); }

    // Hot outer surfaces that heat the surrounding air (vapor + haze sources)
    this.hotSurfaces = [
      { pos: [-(HALF + 0.4), SHELL_OUTER_R, 0], spread: [0.45, 0.4], T: (r) => r.Thi },   // hot inlet channel head
      { pos: [-HEAD_X, R + 0.62, 0], spread: [0.18, 0.18], T: (r) => r.Thi },            // hot inlet nozzle flange
      { pos: [HALF + 0.4, SHELL_OUTER_R, 0], spread: [0.45, 0.4], T: (r) => r.Tho },      // hot outlet channel head
      { pos: [-2.3, SHELL_OUTER_R, 0], spread: [0.6, 0.35], T: (r) => r.Tco },            // warmest shell zone
    ];
    this.vapor = new SoftParticleField({
      count: 360, color: '#e9edf0', lifeMin: 3, lifeMax: 6, rise: 0.2, drift: [0.02, 0, 0],
      jitter: [0.3, 0.02, 0.3], turb: 0.6, size0: 0.22, size1: 0.9, opacity: 0.06,
      spawn: (i) => {
        const s = this.hotSurfaces[i % this.hotSurfaces.length];
        return [s.pos[0] + rnd(-1, 1) * s.spread[0], s.pos[1] + 0.02, s.pos[2] + rnd(-1, 1) * s.spread[1]];
      },
    });

    // Cold mist forms around the lower shell and the cold inlet nozzle, then sinks
    this.mist = new SoftParticleField({
      count: 300, color: '#dde5ea', lifeMin: 4, lifeMax: 8, rise: -0.045, drift: [0, 0, 0.012],
      jitter: [0.35, 0.05, 0.12], turb: 0.25, size0: 0.14, size1: 0.55, opacity: 0.07,
      spawn: (i) => {
        if (i % 5 === 0) {
          const a = rnd(0, Math.PI * 2);
          return [COLD_NOZ_X + Math.cos(a) * 0.17, rnd(R + 0.12, R + 0.52), Math.sin(a) * 0.17];
        }
        const phi = rnd(0.35, 1.65) * Math.PI, rr = SHELL_OUTER_R + 0.04;
        return [rnd(-HALF + 0.15, HALF - 0.15), rr * Math.cos(phi), rr * Math.sin(phi)];
      },
    });

    this.dropletMat = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.012, ior: 1.333,
      specularIntensity: 1, envMapIntensity: 1.3,
    });
    this.sectionMats.push(this.dropletMat);
    this.condensation = new Condensation(this.dropletMat);

    this.bubbles = new Bubbles([
      { lanes: this.hotLanes, count: 240, maxRise: CORE_R * 0.55, swirl: 0.012 },
      { lanes: this.coldLanes, count: 260, maxRise: 0.15, swirl: 0.06 },
    ], sampleLane);

    this.scene.add(this.vapor.points, this.mist.points, this.condensation.group, this.bubbles.points);
  }

  /** Recompute every simulation-driven visual intensity (called on new result or ambient). */
  #applyConditions() {
    const r = this.result;
    if (!r) return;
    const { Ta, RH } = this.ambient;
    const Td = this.dewPoint = dewPoint(Ta, RH);
    const shellT = (x) => this.#lookup(this.lut.Tc, xToS(x));
    const thermal = clamp01((r.Thi - 20) / 100);

    // Vapor: visible only where the surface is well above ambient; humid air shows it more
    const vaporK = (T) => clamp01((T - Ta - 25) / 60) * (0.5 + 0.5 * RH / 100);
    this.vapor.setStrengths((x, y, z) => {
      let best = this.hotSurfaces[0], bd = Infinity;
      for (const s of this.hotSurfaces) {
        const d = (x - s.pos[0]) ** 2 + (y - s.pos[1]) ** 2 + (z - s.pos[2]) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      return vaporK(best.T(r));
    });
    this.vapor.uniforms.uRise.value = 0.12 + 0.3 * thermal;
    this.vapor.uniforms.uTurb.value = 0.4 + 0.6 * thermal;

    // Mist & condensation: only where the wall is below the dew point
    this.mist.setStrengths((x, y) => clamp01((Td - (y > SHELL_OUTER_R + 0.08 ? r.Tci : shellT(x))) / 6));
    this.condensation.coverageAt = (x) => clamp01((Td - shellT(x)) / 4);

    // Water motion: flow rate → ripple & turbulence, temperature → thermal shimmer
    const fh = clamp01(r.mh / 3), fc = clamp01(r.mc / 3);
    const setWater = (mat, flow, ripple, turb) => {
      const u = mat.userData.uniforms;
      u.uFlow.value = flow; u.uRipple.value = ripple; u.uTurb.value = turb;
      mat.normalScale.setScalar(0.02 + 0.05 * clamp01(flow / 3));
    };
    setWater(this.water.hot, r.mh, 0.01 + 0.025 * fh + 0.01 * thermal, 0.02 + 0.08 * fh);
    setWater(this.water.head, r.mh, 0.01 + 0.025 * fh + 0.01 * thermal, 0.03 + 0.08 * fh);
    setWater(this.water.cold, r.mc, 0.008 + 0.022 * fc, 0.02 + 0.09 * fc);
    setWater(this.water.capShell, r.mc, 0.008 + 0.022 * fc, 0.02 + 0.09 * fc);
    setWater(this.water.capHead, r.mh, 0.01 + 0.025 * fh + 0.01 * thermal, 0.03 + 0.08 * fh);

    this.bubbles.groups[0].flow = r.mh;
    this.bubbles.groups[1].flow = r.mc;
  }

  #buildSensors() {
    this.sensors = {};
    this.sensorMeshes = [];
    for (const [id, noz] of Object.entries(this.nozzles)) {
      const g = new THREE.Group();
      g.position.copy(noz.sensorPos);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 16), this.mats.nozzle);
      stem.rotation.x = Math.PI / 2;
      stem.position.z = 0.06;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.1, 24), this.mats.sensorBody);
      body.rotation.x = Math.PI / 2;
      body.position.z = 0.18;
      const ringMat = new THREE.MeshStandardMaterial({ color: '#888', roughness: 0.4, metalness: 0.1 });
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.025, 24), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.z = 0.235;
      g.add(stem, body, ring);
      g.traverse((o) => { o.userData.sensorId = id; o.castShadow = true; });
      this.scene.add(g);
      this.sensors[id] = { group: g, ringMat };
      this.sensorMeshes.push(stem, body, ring);
    }
  }

  #bindPointer() {
    const el = this.renderer.domElement, ndc = new THREE.Vector2();
    let down = null;
    const pick = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      return this.raycaster.intersectObjects(this.sensorMeshes, false)[0]?.object.userData.sensorId ?? null;
    };
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; // was a drag
      this.onSensorClick?.(pick(e));
    });
    el.addEventListener('pointermove', (e) => { el.style.cursor = pick(e) ? 'pointer' : ''; });
  }

  // ---------- public API ----------
  setResult(res) {
    this.result = res;
    T_SCALE.min = res.Tci;
    T_SCALE.max = res.Thi;
    for (let i = 0; i <= 100; i++) {
      const p = res.profile(i / 100);
      this.lut.Th[i] = p.Th;
      this.lut.Tc[i] = p.Tc;
    }
    const c = new THREE.Color();
    const paint = (geo, table) => {
      const pos = geo.attributes.position, col = geo.attributes.color;
      for (let i = 0; i < pos.count; i++) {
        tempToColor(this.#lookup(table, xToS(pos.getX(i))), c);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    };
    paint(this.coreGeo, this.lut.Th);
    paint(this.shellFluidGeo, this.lut.Tc);
    tempToColor(res.Thi, this.mats.headFluidL.color);
    tempToColor(res.Tho, this.mats.headFluidR.color);

    tempToColor(res.Thi, this.sensors.hotIn.ringMat.color);
    tempToColor(res.Tho, this.sensors.hotOut.ringMat.color);
    tempToColor(res.Tci, this.sensors.coldIn.ringMat.color);
    tempToColor(res.Tco, this.sensors.coldOut.ringMat.color);

    this.hotTracers.speed = TRACER_SPEED * res.mh;
    this.coldTracers.speed = TRACER_SPEED * res.mc;
    this.#applyConditions();
  }

  /** Ambient air for visual effects only: Ta (°C), RH (%). Returns the dew point. */
  setAmbient({ Ta, RH }) {
    this.ambient = { Ta, RH };
    this.#applyConditions();
    return dewPoint(Ta, RH);
  }

  /** 'realistic' | 'temperature' | 'flow' */
  setViewMode(mode) {
    this.viewMode = mode;
    const temp = mode === 'temperature', real = mode === 'realistic';
    this.coreMesh.material = temp ? this.mats.tubeFluid : this.water.hot;
    this.shellFluidMesh.material = temp ? this.mats.shellFluid : this.water.cold;
    for (const h of this.headFluidMeshes) h.mesh.material = temp ? h.tempMat : this.water.head;
    this.hotTracers.pts.visible = this.coldTracers.pts.visible = !real;
    this.hotTracers.pts.material.size = this.coldTracers.pts.material.size = mode === 'flow' ? 0.085 : 0.065;
    this.bubbles.points.visible = !temp;
    this.vapor.points.visible = this.mist.points.visible = this.condensation.group.visible = real;
    this.hazePass.enabled = real;
    if (!real) { this.mats.shell.roughness = 0.3; this.mats.shell.clearcoat = 0; }
    this.#updateCaps();
  }

  #updateCaps() {
    const show = this.shellMode === 'cutaway' && this.viewMode !== 'temperature';
    for (const c of this.capMeshes ?? []) c.visible = show;
  }

  setShellMode(mode) {
    this.shellMode = mode;
    const cut = mode === 'cutaway', tr = mode === 'transparent';
    for (const m of this.sectionMats) { m.clippingPlanes = cut ? [this.clipPlane] : null; m.needsUpdate = true; }
    for (const m of this.housingMats) {
      m.transparent = tr;
      m.opacity = tr ? 0.17 : 1;
      m.depthWrite = !tr;
      m.needsUpdate = true;
    }
    this.#updateCaps();
  }

  goPreset(name, instant = false) {
    const p = CAMERA_PRESETS[name];
    if (!p) return;
    const to = { pos: new THREE.Vector3(...p.pos), target: new THREE.Vector3(...p.target) };
    if (instant) {
      this.camera.position.copy(to.pos);
      this.controls.target.copy(to.target);
      this.controls.update();
    } else {
      this.tween = { t: 0, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), to };
    }
    return p.mode;
  }

  /** Screen position (CSS px, relative to container) of a sensor, or null if behind camera. */
  projectSensor(id) {
    const v = this.sensors[id].group.getWorldPosition(new THREE.Vector3());
    v.z += 0.25;
    v.project(this.camera);
    if (v.z > 1) return null;
    const { clientWidth: w, clientHeight: h } = this.container;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
  }

  // ---------- frame ----------
  #lookup(table, s) {
    const f = s * 100, i = Math.min(Math.floor(f), 99);
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  }

  #updateTracers(tr, table, dt) {
    const pos = tr.geo.attributes.position.array, col = tr.geo.attributes.color.array;
    const out = [0, 0, 0], c = new THREE.Color(), white = new THREE.Color(1, 1, 1);
    const flowK = clamp01(tr.speed / (TRACER_SPEED * 3));
    const flowMode = this.viewMode === 'flow';
    for (let i = 0; i < tr.u.length; i++) {
      const lane = tr.lanes[tr.lane[i]];
      tr.u[i] = (tr.u[i] + (tr.speed * dt) / lane.length) % 1;
      sampleLane(lane, tr.u[i], out);
      // Small eddies where the flow is disturbed; stronger at higher flow
      const sw = tr.swirl * turbulenceMask(out[0]) * (0.3 + flowK);
      const ph = this.time * (2 + 5 * flowK) + i * 2.399;
      pos[i * 3] = out[0]; pos[i * 3 + 1] = out[1] + Math.cos(ph) * sw; pos[i * 3 + 2] = out[2] + Math.sin(ph) * sw;
      if (flowMode) c.copy(FLOW_TRACER_COLORS[tr.side]);
      else tempToColor(this.#lookup(table, xToS(out[0])), c).lerp(white, 0.2);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    tr.geo.attributes.position.needsUpdate = true;
    tr.geo.attributes.color.needsUpdate = true;
  }

  #tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 1.1);
      const e = tw.t * tw.t * (3 - 2 * tw.t);
      this.camera.position.lerpVectors(tw.fromPos, tw.to.pos, e);
      this.controls.target.lerpVectors(tw.fromTarget, tw.to.target, e);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();

    this.time += dt;
    if (this.result) {
      const real = this.viewMode === 'realistic';
      if (this.viewMode !== 'realistic') {
        this.#updateTracers(this.hotTracers, this.lut.Th, dt);
        this.#updateTracers(this.coldTracers, this.lut.Tc, dt);
      }
      // Liquid surface motion follows flow direction & rate (UV v runs along +x)
      const m = this.mats, { mh, mc } = this.result;
      m.tubeFluid.normalMap.offset.y -= dt * 0.25 * mh;
      m.shellFluid.normalMap.offset.y += dt * 0.08 * mc;
      m.headFluidL.normalMap.offset.x += dt * 0.03;
      m.headFluidR.normalMap.offset.x -= dt * 0.03;
      const w = this.water;
      w.hot.normalMap.offset.y -= dt * 0.25 * mh;
      w.cold.normalMap.offset.y += dt * 0.08 * mc;
      w.head.normalMap.offset.x += dt * 0.02 * (1 + mh);
      w.capShell.normalMap.offset.x += dt * 0.05 * mc;
      w.capHead.normalMap.offset.y += dt * 0.03 * (1 + mh);
      for (const mat of Object.values(w)) mat.userData.uniforms.uTime.value = this.time;

      if (this.viewMode !== 'temperature') this.bubbles.update(dt, this.time, this.pixelScale);
      if (real) {
        this.vapor.update(this.time, this.pixelScale);
        this.mist.update(this.time, this.pixelScale);
        this.condensation.update(dt);
        // Wet metal where condensate film forms
        const wet = clamp01(this.condensation.wetness * 1.5);
        m.shell.roughness = 0.3 - 0.13 * wet;
        m.shell.clearcoat = 0.6 * wet;
        this.#updateHaze();
      }
    }

    this.composer.render(dt);
    this.onFrame?.();
  }

  #updateHaze() {
    const u = this.hazePass.uniforms, v = new THREE.Vector3(), top = new THREE.Vector3();
    u.uTime.value = this.time;
    u.uAspect.value = this.camera.aspect;
    u.uEmitters.value.forEach((e, i) => {
      const s = this.hotSurfaces[i];
      const k = s ? clamp01((s.T(this.result) - this.ambient.Ta - 15) / 90) : 0;
      if (!s || k <= 0) { e.set(0, 0, 0, 0); return; }
      v.set(...s.pos).project(this.camera);
      top.set(s.pos[0], s.pos[1] + 1, s.pos[2]).project(this.camera);
      if (v.z > 1) { e.set(0, 0, 0, 0); return; }
      e.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, Math.max(0.01, (top.y - v.y) * 0.5), k);
    });
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // world size → pixel size factor for point sprites
    this.pixelScale = (h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }
}
