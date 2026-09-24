const VIEWS = [['realistic', 'Realistic'], ['temperature', 'Temperature'], ['flow', 'Flow']];
const MODES = [['solid', 'Solid'], ['transparent', 'Transparent'], ['cutaway', 'Cutaway']];
const PRESETS = [['overview', 'Overview'], ['cutaway', 'Cutaway'], ['bundle', 'Tube Bundle'], ['hot', 'Hot Side'], ['cold', 'Cold Side']];

export default function Toolbar({ viewMode, onViewMode, shellMode, onShellMode, preset, onPreset }) {
  return (
    <header>
      <h1>Shell &amp; Tube Heat Exchanger</h1>
      <span className="sub">Counter-flow · 37 tubes · 5 baffles</span>
      <div className="spacer" />
      <div className="group">
        <label>View</label>
        {VIEWS.map(([id, label]) => (
          <button key={id} className={viewMode === id ? 'active' : ''} onClick={() => onViewMode(id)}>{label}</button>
        ))}
      </div>
      <div className="group">
        <label>Shell</label>
        {MODES.map(([id, label]) => (
          <button key={id} className={shellMode === id ? 'active' : ''} onClick={() => onShellMode(id)}>{label}</button>
        ))}
      </div>
      <div className="group">
        <label>Camera</label>
        {PRESETS.map(([id, label]) => (
          <button key={id} className={preset === id ? 'active' : ''} onClick={() => onPreset(id)}>{label}</button>
        ))}
      </div>
    </header>
  );
}
