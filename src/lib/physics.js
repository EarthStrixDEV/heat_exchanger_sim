// Pure heat-transfer model: no Three.js / DOM dependencies.
// Counter-flow shell & tube exchanger. Hot fluid = tube side, cold fluid = shell side.

export const FLUIDS = {
  hot:  { name: 'Hot water (tube side)',  cp: 4190, rho: 970 },  // J/kg·K, kg/m³
  cold: { name: 'Cold water (shell side)', cp: 4180, rho: 998 },
};

export const GEOMETRY = {
  tubes: 37,          // 1-2-... hex bundle, 3 rings
  tubeOD: 0.025,      // m
  tubeID: 0.021,      // m
  length: 4.0,        // m, effective tube length
  shellFlowArea: 0.018, // m², approximate crossflow area between baffles
};

export const AREA = Math.PI * GEOMETRY.tubeOD * GEOMETRY.length * GEOMETRY.tubes; // m² (~11.6)
const TUBE_FLOW_AREA = GEOMETRY.tubes * Math.PI * GEOMETRY.tubeID ** 2 / 4;

/**
 * Solve outlet temperatures with the ε-NTU method (counter-flow), then
 * verify against Q = U·A·ΔTlm and Q = ṁ·Cp·ΔT.
 * @param {{Thi:number,Tci:number,mh:number,mc:number,U:number}} p  °C, °C, kg/s, kg/s, W/m²K
 */
export function solve({ Thi, Tci, mh, mc, U }) {
  const Ch = mh * FLUIDS.hot.cp;   // W/K
  const Cc = mc * FLUIDS.cold.cp;
  const Cmin = Math.min(Ch, Cc);
  const Cmax = Math.max(Ch, Cc);
  const Cr = Cmin / Cmax;
  const UA = U * AREA;
  const NTU = UA / Cmin;

  const eps = Math.abs(1 - Cr) < 1e-6
    ? NTU / (1 + NTU)
    : (1 - Math.exp(-NTU * (1 - Cr))) / (1 - Cr * Math.exp(-NTU * (1 - Cr)));

  const Qmax = Cmin * (Thi - Tci);
  const Q = eps * Qmax;                 // W
  const Tho = Thi - Q / Ch;             // Q = ṁh·Cph·(Thi − Tho)
  const Tco = Tci + Q / Cc;             // Q = ṁc·Cpc·(Tco − Tci)

  const dT1 = Thi - Tco;                // hot-inlet end
  const dT2 = Tho - Tci;                // hot-outlet end
  const lmtd = Math.abs(dT1 - dT2) < 1e-6 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
  const Q_UA = UA * lmtd;               // should equal Q

  // Axial profile. s ∈ [0,1] measured along hot flow (hot inlet at s=0, cold inlet at s=1).
  // Counter-flow ODE gives ΔT(s) = ΔT1·e^(−k s), k = UA(1/Ch − 1/Cc).
  const k = UA * (1 / Ch - 1 / Cc);
  const shape = (s) => Math.abs(k) < 1e-6 ? s : (1 - Math.exp(-k * s)) / (1 - Math.exp(-k));
  const profile = (s) => {
    const f = shape(Math.min(1, Math.max(0, s)));
    return { Th: Thi - (Thi - Tho) * f, Tc: Tco - (Tco - Tci) * f };
  };

  return {
    Thi, Tci, Tho, Tco, mh, mc, U,
    Ch, Cc, Cr, UA, NTU, eps, Q, Q_UA, lmtd, area: AREA,
    vTube: mh / (FLUIDS.hot.rho * TUBE_FLOW_AREA),        // m/s
    vShell: mc / (FLUIDS.cold.rho * GEOMETRY.shellFlowArea),
    profile,
  };
}
