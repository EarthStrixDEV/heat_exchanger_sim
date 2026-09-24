import { useEffect, useRef, useState } from 'react';
import { HeatExchangerView, COLOR_STOPS } from '../three/HeatExchangerView.js';

const SENSORS = {
  hotIn:   { name: 'TI-101 · Hot Inlet',   T: (r) => r.Thi, m: (r) => r.mh, side: 'Tube side' },
  hotOut:  { name: 'TI-102 · Hot Outlet',  T: (r) => r.Tho, m: (r) => r.mh, side: 'Tube side' },
  coldIn:  { name: 'TI-201 · Cold Inlet',  T: (r) => r.Tci, m: (r) => r.mc, side: 'Shell side' },
  coldOut: { name: 'TI-202 · Cold Outlet', T: (r) => r.Tco, m: (r) => r.mc, side: 'Shell side' },
};

export default function Viewport({ result, viewMode, ambient, shellMode, preset, onPresetMode }) {
  const containerRef = useRef(null);
  const popupRef = useRef(null);
  const viewRef = useRef(null);
  const selectedRef = useRef(null);
  const [selected, setSelected] = useState(null);

  // Create / dispose the Three.js view once
  useEffect(() => {
    const view = new HeatExchangerView(containerRef.current);
    viewRef.current = view;
    view.onSensorClick = (id) => setSelected(id);
    // Popup follows its sensor every frame without re-rendering React
    view.onFrame = () => {
      const el = popupRef.current, id = selectedRef.current;
      if (!el || !id) return;
      const p = view.projectSensor(id);
      el.style.visibility = p ? 'visible' : 'hidden';
      if (p) el.style.transform = `translate(${Math.round(p.x + 14)}px, ${Math.round(p.y - 20)}px)`;
    };
    return () => { view.dispose(); viewRef.current = null; };
  }, []);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { viewRef.current?.setResult(result); }, [result]);
  useEffect(() => { viewRef.current?.setShellMode(shellMode); }, [shellMode]);
  useEffect(() => { viewRef.current?.setViewMode(viewMode); }, [viewMode]);
  useEffect(() => { viewRef.current?.setAmbient(ambient); }, [ambient]);
  useEffect(() => {
    const mode = viewRef.current?.goPreset(preset.name, preset.seq === 0);
    if (mode && preset.seq > 0) onPresetMode(mode);
  }, [preset]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = selected && SENSORS[selected];

  return (
    <div id="viewport" ref={containerRef}>
      <div id="flow-key">
        <div><i className="tag hot" />Hot fluid → tubes (left → right)</div>
        <div><i className="tag cold" />Cold fluid → shell (right → left)</div>
      </div>
      <div id="legend" hidden={viewMode !== 'temperature'}>
        <div className="title">Fluid temperature</div>
        <div id="legend-bar" style={{ background: `linear-gradient(90deg, ${COLOR_STOPS.join(',')})` }} />
        <div className="ticks">
          <span>{result.Tci.toFixed(0)} °C</span>
          <span>{((result.Tci + result.Thi) / 2).toFixed(1)} °C</span>
          <span>{result.Thi.toFixed(0)} °C</span>
        </div>
      </div>
      <div id="hint">Drag: rotate · Right-drag: pan · Wheel: zoom · Click a sensor for readings</div>
      {s && (
        <div id="sensor-popup" ref={popupRef}>
          <div className="hd">
            <b>{s.name}</b>
            <button aria-label="Close" onClick={() => setSelected(null)}>×</button>
          </div>
          <div className="side">{s.side}</div>
          <div className="big">{s.T(result).toFixed(1)} °C</div>
          <div className="flow">
            {s.m(result).toFixed(2)} kg/s <span>≈</span> {(s.m(result) * 60).toFixed(1)} L/min
          </div>
        </div>
      )}
    </div>
  );
}
