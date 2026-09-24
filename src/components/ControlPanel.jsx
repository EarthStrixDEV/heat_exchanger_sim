import { dewPoint } from '../lib/ambient.js';

const CONTROLS = [
  { key: 'Thi', label: 'Hot inlet temperature', unit: '°C', min: 40, max: 150, step: 1, tag: 'hot', digits: 0 },
  { key: 'Tci', label: 'Cold inlet temperature', unit: '°C', min: 5, max: 40, step: 1, tag: 'cold', digits: 0 },
  { key: 'mh', label: 'Hot flow rate', unit: 'kg/s', min: 0.1, max: 3, step: 0.05, tag: 'hot', digits: 2 },
  { key: 'mc', label: 'Cold flow rate', unit: 'kg/s', min: 0.1, max: 3, step: 0.05, tag: 'cold', digits: 2 },
  { key: 'U', label: 'Overall U', unit: 'W/m²K', min: 100, max: 2000, step: 10, tag: 'neutral', digits: 0 },
];

const AMBIENT = [
  { key: 'Ta', label: 'Ambient air temperature', unit: '°C', min: 10, max: 40, step: 1, tag: 'neutral', digits: 0 },
  { key: 'RH', label: 'Relative humidity', unit: '%', min: 20, max: 100, step: 1, tag: 'neutral', digits: 0 },
];

function Slider({ c, values, onChange }) {
  return (
    <div className="ctrl">
      <div className="row">
        <span><i className={`tag ${c.tag}`} />{c.label}</span>
        <span><span className="val">{values[c.key].toFixed(c.digits)}</span><span className="unit">{c.unit}</span></span>
      </div>
      <input
        type="range" min={c.min} max={c.max} step={c.step} value={values[c.key]}
        onChange={(e) => onChange(c.key, parseFloat(e.target.value))}
      />
    </div>
  );
}

export default function ControlPanel({ params, onChange, ambient, onAmbient }) {
  return (
    <aside className="left">
      <h2>Process Inputs</h2>
      {CONTROLS.map((c) => <Slider key={c.key} c={c} values={params} onChange={onChange} />)}

      <h2>Ambient Air</h2>
      {AMBIENT.map((c) => <Slider key={c.key} c={c} values={ambient} onChange={onAmbient} />)}
      <div className="ctrl"><div className="row">
        <span>Dew point</span>
        <span><span className="val">{dewPoint(ambient.Ta, ambient.RH).toFixed(1)}</span><span className="unit">°C</span></span>
      </div></div>
      <p className="note">Visual only: drives condensation, mist and vapor. Not used in the heat-transfer calculation.</p>

      <h2>Model</h2>
      <div className="eq">
        Q = ṁ·Cp·ΔT<br />
        Q = U·A·ΔT<sub>lm</sub><br />
        ε = f(NTU, C<sub>r</sub>) counter-flow<br />
        NTU = UA / C<sub>min</sub>
      </div>
      <p className="note">
        Hot water on the tube side, cold water on the shell side. Cp<sub>hot</sub> = 4190, Cp<sub>cold</sub> = 4180 J/kg·K.
        Simplified lumped model (ε-NTU); no CFD. The axial temperature profile comes from the counter-flow energy balance.
      </p>
    </aside>
  );
}
