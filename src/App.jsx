import { useMemo, useState } from 'react';
import { solve } from './lib/physics.js';
import Toolbar from './components/Toolbar.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import DataPanel from './components/DataPanel.jsx';
import Viewport from './components/Viewport.jsx';

const MIN_APPROACH = 5; // keep Thi at least 5 °C above Tci

export default function App() {
  const [params, setParams] = useState({ Thi: 90, Tci: 20, mh: 1.0, mc: 1.5, U: 600 });
  const [shellMode, setShellMode] = useState('cutaway');
  const [viewMode, setViewMode] = useState('realistic');
  const [ambient, setAmbient] = useState({ Ta: 30, RH: 70 }); // visual effects only
  const [preset, setPreset] = useState({ name: 'cutaway', seq: 0 });

  const result = useMemo(() => solve(params), [params]);

  const updateParam = (key, value) => setParams((p) => {
    const next = { ...p, [key]: value };
    if (next.Thi < next.Tci + MIN_APPROACH) next.Thi = next.Tci + MIN_APPROACH;
    return next;
  });

  return (
    <div id="app">
      <Toolbar
        viewMode={viewMode}
        onViewMode={setViewMode}
        shellMode={shellMode}
        onShellMode={setShellMode}
        preset={preset.name}
        onPreset={(name) => setPreset((p) => ({ name, seq: p.seq + 1 }))}
      />
      <ControlPanel
        params={params}
        onChange={updateParam}
        ambient={ambient}
        onAmbient={(key, value) => setAmbient((a) => ({ ...a, [key]: value }))}
      />
      <Viewport
        result={result}
        viewMode={viewMode}
        ambient={ambient}
        shellMode={shellMode}
        preset={preset}
        onPresetMode={setShellMode}
      />
      <DataPanel result={result} />
    </div>
  );
}
