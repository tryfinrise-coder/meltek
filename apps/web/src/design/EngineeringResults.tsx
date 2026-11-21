import type { SolveResult } from '@meltek/engine';
import { Callout, Hint } from '../shared/primitives';
import { useCurrency } from '../shared/currency';
const n = (v: number | null, unit='') => v == null ? 'Not available' : `${v.toFixed(3)} ${unit}`;
export function EngineeringResults({result, onExport: handleExport}:{result:SolveResult; onExport: () => void}) {
  const r=result.engineering!;
  const { money } = useCurrency();
  const rows: [string,number|null,string,string][] = [
    ['Winding layers',r.layers,'','Number of concentric winding layers around the core.'],
    ['Turns per layer',r.turnsPerLayer,'','Secondary turns divided equally across the winding layers.'],
    ['Radial winding build',r.windingBuildMm,'mm','Total thickness of all winding layers on one side of the core.'],
    ['Finished axial width',r.finishedWidthMm,'mm','Core strip width plus any insulation overhang — the final CT width.'],
    ['Wire per strand',r.wireLengthPerStrandM,'m','Length of wire for one parallel strand of the secondary winding.'],
    ['Total wire',r.totalWireLengthM,'m','Total wire across all parallel strands, including practical additions.'],
    ['Resistance at 20 °C',r.resistance20Ohm,'Ω','DC winding resistance at the standard 20 °C reference temperature.'],
    ['Resistance at room temperature',r.resistanceRoomOhm,'Ω','Winding resistance adjusted to typical ambient (~25 °C).'],
    ['Resistance at 75 °C',r.resistance75Ohm,'Ω','Winding resistance at the rated thermal limit — worst-case burden contribution.'],
    ['Operating resistance',r.resistanceOperatingOhm,'Ω','Resistance at the expected operating temperature used in accuracy checks.'],
    ['Effective steel area',r.effectiveAreaCm2,'cm²','Net iron cross-section after stacking factor — the area carrying flux.'],
    ['Working flux',r.operatingFluxT,'T','Flux density the core operates at under rated burden and current.'],
    ['Required design voltage',r.voltageAtLimit,'V','Secondary voltage the CT must sustain at rated burden without exceeding the error limit.'],
    ['Characterised saturation voltage',r.saturationVoltage,'V','Voltage at which the core reaches its characterised saturation knee from the B–H curve.'],
    ['Estimated knee voltage',r.kneeVoltage,'V','Knee-point voltage (Vk) — the point where a 10% voltage increase causes a 50% excitation current increase.'],
    ['Area from specified Vk',r.areaFromKneeCm2,'cm²','Minimum core area needed to achieve the specified knee-point voltage.'],
    ['Area from PS resistance formula',r.areaFromResistanceCm2,'cm²','Core area derived from the protection-class resistance formula.'],
    ['Exciting current at check voltage',r.excitationCurrentA,'A','Magnetising current drawn by the core at the accuracy-check voltage.'],
    ['Working excitation',r.excitationAtCm,'AT/cm','Magnetising force the core needs at the working flux density.'],
    ['Composite error estimate',r.compositeErrorEstimatePercent,'%','Estimated total error combining ratio error and phase displacement — must stay within the accuracy class limit.'],
    ['Steel + copper including waste',r.materialCost,'¤','Raw material cost: (steel weight × steel rate) + (copper weight × copper rate) + wastage allowance.'],
    ['Manufacturing cost',r.manufacturingCost,'¤','Full cost including insulation, resin, labour, overhead and wastage.'],
  ];
  return <div className="flex flex-col gap-4 p-4"><div className="flex justify-end"><button type="button" onClick={handleExport} className="rounded-md border border-[var(--line)] px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-2)]" title="Download calculation as Excel">Download Excel</button></div><Callout tone={r.issues.length?'warn':'info'} title={r.issues.length?'Engineering screening needs attention':'Configured screening checks passed'}>Sinusoidal steady-state estimates. Protection composite error is excitation-based; knee voltage uses supplied characterised knee flux. These results do not establish standard compliance or transient fault performance. R75 source: {r.resistance75Source}.</Callout>
    {r.issues.length>0 && <ul className="list-disc pl-5 text-sm">{r.issues.map(i=><li key={i}>{i}</li>)}</ul>}
    <dl className="grid grid-cols-1 gap-3 md:grid-cols-3">{rows.map(([label,v,u,tip])=><div key={label} className="rounded-md border border-[var(--line)] p-3"><dt className="text-xs text-[var(--text-2)]">{label}<Hint label={label}>{tip}<br/><br/><strong>This design:</strong> {u === '¤' ? money(v) : n(v,u)}</Hint></dt><dd className="mt-1 num text-sm">{u === '¤' ? money(v) : n(v,u)}</dd></div>)}</dl>
    {!!r.checks.length && <div className="overflow-x-auto"><table className="data-table w-full text-xs"><thead><tr>{['Current %','Burden %','Ratio error %','Phase minutes','Screening'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{r.checks.map((p,i)=><tr key={i}><td className="p-2">{p.currentPercent}</td><td>{p.burdenPercent}</td><td>{n(p.ratioErrorPercent)}</td><td>{n(p.phaseMinutes)}</td><td>{p.passed===null?'Missing curve data':p.passed?'Pass':'Fail'}</td></tr>)}</tbody></table></div>}
    <div className="overflow-x-auto"><table className="data-table w-full text-xs"><thead><tr><th className="p-2">Calculation</th><th>Formula</th><th>Result</th></tr></thead><tbody>{result.steps.map(s=><tr key={s.key}><td className="p-2">{s.label}</td><td>{s.formula}</td><td className="p-2 num">{typeof s.value==='number'?n(s.value,s.unit):s.value}</td></tr>)}</tbody></table></div>
  </div>;
}
