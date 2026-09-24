// Scene geometry shared by the view and the visual-effect modules (scene units ≈ m).
export const L = 6, HALF = L / 2;          // visual tube length (tubesheet to tubesheet)
export const R = 0.8;                      // shell inner radius
export const SHELL_OUTER_R = R + 0.03;
export const TUBE_R = 0.045, CORE_R = 0.036, PITCH = 0.17;
export const BAFFLE_X = [2, 1, 0, -1, -2]; // ordered along cold flow (right → left)
export const BAFFLE_CHORD = 0.4;           // 25 % segmental cut
export const HEAD_X = HALF + 0.33;         // channel-head nozzle position
export const COLD_NOZ_X = 2.45;
export const FLOOR_Y = -1.75;
export const TRACER_SPEED = 0.9;           // scene units/s per kg/s

export const xToS = (x) => Math.min(1, Math.max(0, (x + HALF) / L));

// Flow is disturbed at baffle edges, nozzles and tube entries/exits
const TURB_SITES = [...BAFFLE_X, COLD_NOZ_X, -COLD_NOZ_X, HALF, -HALF];
const TURB_WIDTH2 = 0.04;

/** 0..1 — how turbulent the flow is at axial position x. */
export function turbulenceMask(x) {
  let m = 0;
  for (const b of TURB_SITES) m += Math.exp(-((x - b) ** 2) / TURB_WIDTH2);
  return Math.min(m, 1);
}

/** Same mask as GLSL, for shaders. */
export const TURBULENCE_GLSL = `
float hxTurb(float x) {
  float m = 0.0;
  ${TURB_SITES.map((b) => `m += exp(-pow(x - (${b.toFixed(3)}), 2.0) / ${TURB_WIDTH2.toFixed(3)});`).join('\n  ')}
  return min(m, 1.0);
}`;
