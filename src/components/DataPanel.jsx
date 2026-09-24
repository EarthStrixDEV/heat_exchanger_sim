function Row({ label, value, unit, tag, keyRow }) {
  return (
    <tr className={keyRow ? 'key' : undefined}>
      <td>{tag && <i className={`tag ${tag}`} />}{label}</td>
      <td>{value}</td>
      <td>{unit}</td>
    </tr>
  );
}

export default function DataPanel({ result: r }) {
  const f = (v, d = 1) => v.toFixed(d);
  return (
    <aside className="right">
      <h2>Engineering Data</h2>
      <table><tbody>
        <Row tag="hot" label="Hot inlet T" value={f(r.Thi)} unit="°C" />
        <Row tag="hot" label="Hot outlet T" value={f(r.Tho)} unit="°C" />
        <Row tag="cold" label="Cold inlet T" value={f(r.Tci)} unit="°C" />
        <Row tag="cold" label="Cold outlet T" value={f(r.Tco)} unit="°C" />
        <Row keyRow label="Heat transfer rate" value={f(r.Q / 1000)} unit="kW" />
        <Row keyRow label="Effectiveness" value={f(r.eps * 100)} unit="%" />
        <Row tag="hot" label="Hot flow rate" value={f(r.mh, 2)} unit="kg/s" />
        <Row tag="cold" label="Cold flow rate" value={f(r.mc, 2)} unit="kg/s" />
      </tbody></table>

      <h2>Energy Balance Check</h2>
      <table><tbody>
        <Row label="Q hot = ṁh·Cp·ΔTh" value={f(r.Ch * (r.Thi - r.Tho) / 1000)} unit="kW" />
        <Row label="Q cold = ṁc·Cp·ΔTc" value={f(r.Cc * (r.Tco - r.Tci) / 1000)} unit="kW" />
        <Row label="Q = U·A·ΔTlm" value={f(r.Q_UA / 1000)} unit="kW" />
        <Row label="ΔTlm" value={f(r.lmtd, 2)} unit="°C" />
      </tbody></table>

      <h2>Design Parameters</h2>
      <table><tbody>
        <Row label="Heat transfer area A" value={f(r.area, 2)} unit="m²" />
        <Row label="UA" value={f(r.UA / 1000, 2)} unit="kW/K" />
        <Row label="NTU" value={f(r.NTU, 2)} unit="–" />
        <Row label="Capacity ratio Cr" value={f(r.Cr, 3)} unit="–" />
        <Row label="Tube velocity" value={f(r.vTube, 2)} unit="m/s" />
        <Row label="Shell crossflow velocity" value={f(r.vShell, 2)} unit="m/s" />
      </tbody></table>
    </aside>
  );
}
