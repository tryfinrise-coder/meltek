import type { EngineeringSpec, ReferenceData } from '@meltek/engine';
import { engineeringSpecSchema } from '@meltek/schema';
import { useState } from 'react';
import { Card, Button, Callout } from '../components/primitives';
import { TextField, SelectField } from '../components/fields';

export function newEngineeringSpec(): EngineeringSpec {
  return { purpose: 'metering', standard: '', confirmed: false, frequencyHz: 50, roomTemperatureC: 20, operatingTemperatureC: 75, copperTemperatureConstant: 234.5, burdenPowerFactor: 1, leadResistanceOhm: 0, parallelStrands: 1, strandArrangement: 'side-by-side', selectedSwg: null,
    coreInsulation: { type: 'Polyester tape with cotton adhesive', thicknessMm: null }, outerInsulation: { type: 'Non-adhesive tape', thicknessMm: null }, interlayerThicknessMm: null, interlayerType: '', wires: [], materials: [], allowedAtLoss: null, accuracyLimitFactor: null, maxCompositeErrorPercent: null, requiredKneeVoltage: null, maxExcitationCurrentA: null, excitationCheckVoltage: null, maxResistance75Ohm: null, psVoltageFactor: null, testPoints: [],
    costing: { basis: 'material', insulationPerUnit: null, resinPerUnit: null, labourPerUnit: null, overheadPerUnit: null, steelWastePercent: 0, copperWastePercent: 0 } };
}

function Numeric({ label, value, change }: { label: string; value: number | null; change: (n: number | null) => void }) {
  return <TextField label={label} aria-label={label} type="number" step="any" value={value === null || !Number.isFinite(value) ? '' : value} onChange={e => change(e.target.value === '' ? null : Number(e.target.value))}/>;
}

export function EngineeringEditor({ value, onChange, reference }: { value: EngineeringSpec | null; onChange: (v: EngineeringSpec | null) => void; reference?: ReferenceData }) {
  const [importError, setImportError] = useState('');
  const e = value;
  const patch = (p: Partial<EngineeringSpec>) => e && onChange({ ...e, ...p, confirmed: p.confirmed ?? false });
  const numeric = (label: string, key: keyof EngineeringSpec) => <Numeric key={key} label={label} value={e![key] as number | null} change={n => patch({ [key]: n })}/>;
  const valid = e ? engineeringSpecSchema.safeParse(e) : null;
  return <Card title="Construction & electrical engineering" subtitle="Enable the extended workflow for insulation, parallel winding, temperature, metering accuracy and protection/PS screening.">
    <div className="flex flex-col gap-4 p-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Enable engineering mode" checked={!!e} onChange={ev => onChange(ev.target.checked ? newEngineeringSpec() : null)}/>Enable engineering mode</label>
      {!e && <p className="text-xs text-[var(--text-2)]">Legacy mode reproduces the existing metering calculation using fixed process allowances.</p>}
      {e && <>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SelectField label="Design purpose" aria-label="Design purpose" value={e.purpose} onChange={ev => patch({ purpose: ev.target.value as EngineeringSpec['purpose'] })}><option value="metering">Metering CT</option><option value="protection">Protection CT (5P / 10P)</option><option value="ps">Special protection (PS / PX)</option></SelectField>
          <TextField label="Standard & edition / client specification" value={e.standard} onChange={ev => patch({ standard: ev.target.value })}/>
          <SelectField label="SWG search" value={e.selectedSwg ?? ''} onChange={ev => patch({ selectedSwg: ev.target.value ? Number(ev.target.value) : null })}><option value="">All configured gauges</option>{reference?.gauges.map(w => <option key={w.swg} value={w.swg}>SWG {w.swg}</option>)}</SelectField>
          {numeric('Frequency (Hz)', 'frequencyHz')}{numeric('Room temperature (°C)', 'roomTemperatureC')}{numeric('Winding operating temperature (°C)', 'operatingTemperatureC')}
          {numeric('Copper temperature constant (°C)', 'copperTemperatureConstant')}{numeric('Burden power factor (lagging)', 'burdenPowerFactor')}{numeric('External loop resistance, additional to burden (Ω)', 'leadResistanceOhm')}
        </div>
        <details open><summary className="cursor-pointer text-sm font-semibold">Insulation and winding construction</summary>
          <p className="my-2 text-xs text-[var(--text-2)]">Enter installed thickness per side, including tape overlaps. The model assumes uniform build on the bore, OD and axial faces. 300 µm = 0.3 mm; 500 µm = 0.5 mm. Nominal sheet thickness is not automatically installed build.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SelectField label="Core insulation" value={e.coreInsulation.type} onChange={ev => patch({ coreInsulation: { type: ev.target.value, thicknessMm: null } })}>{Array.from(new Set([e.coreInsulation.type, 'Polyester tape with cotton adhesive','Blister cap (nominal 300 µm)','PVC cap (nominal 1.5 mm per side)','DMC capping','Epoxy coating (nominal 1 mm)'])).map(t => <option key={t}>{t}</option>)}</SelectField>
            <Numeric label="Installed core insulation / side (mm)" value={e.coreInsulation.thicknessMm} change={n => patch({ coreInsulation: { ...e.coreInsulation, thicknessMm: n } })}/>
            <SelectField label="Outer insulation" value={e.outerInsulation.type} onChange={ev => patch({ outerInsulation: { type: ev.target.value, thicknessMm: null } })}>{Array.from(new Set([e.outerInsulation.type, 'Non-adhesive tape','Tape + blister cap (nominal 500 µm)','DMC caps','Polyester resin cast','Cold-setting epoxy'])).map(t => <option key={t}>{t}</option>)}</SelectField>
            <Numeric label="Installed outer insulation / side (mm)" value={e.outerInsulation.thicknessMm} change={n => patch({ outerInsulation: { ...e.outerInsulation, thicknessMm: n } })}/>
            <TextField label="Interlayer material" value={e.interlayerType} onChange={ev => patch({ interlayerType: ev.target.value })}/>
            {numeric('Interlayer thickness (mm)', 'interlayerThicknessMm')}{numeric('Parallel strands', 'parallelStrands')}
            <SelectField label="Strand arrangement" value={e.strandArrangement} onChange={ev => patch({ strandArrangement: ev.target.value as EngineeringSpec['strandArrangement'] })}><option value="side-by-side">Side by side</option><option value="radial-stack">Radially stacked</option></SelectField>
          </div>
          <p className="my-3 text-xs text-[var(--text-2)]">Enter gauge-specific insulated diameters and packing factors. Unconfigured gauges are excluded.</p>
          {e.wires.map((w,i) => <div className="my-2 grid grid-cols-2 gap-3 md:grid-cols-4" key={i}>
            <SelectField label="Gauge" value={w.swg} onChange={ev => patch({ wires:e.wires.map((v,j) => j===i?{...v,swg:Number(ev.target.value)}:v) })}>{reference?.gauges.map(g => <option key={g.swg} value={g.swg}>SWG {g.swg}</option>)}</SelectField>
            <Numeric label="Insulated diameter (mm)" value={w.insulatedDiameterMm} change={n => patch({wires:e.wires.map((v,j)=>j===i?{...v,insulatedDiameterMm:n ?? 0}:v)})}/>
            <Numeric label="Packing factor (0–1)" value={w.packingFactor} change={n => patch({wires:e.wires.map((v,j)=>j===i?{...v,packingFactor:n ?? 0}:v)})}/>
            <Button size="sm" onClick={()=>patch({wires:e.wires.filter((_,j)=>j!==i)})}>Remove wire</Button>
          </div>)}
          <Button size="sm" onClick={()=>patch({wires:[...e.wires,{swg:reference?.gauges.find(g=>!e.wires.some(w=>w.swg===g.swg))?.swg ?? 17,insulatedDiameterMm:0,packingFactor:0}]})}>Add wire construction</Button>
        </details>
        <details><summary className="cursor-pointer text-sm font-semibold">Magnetic data by steel grade</summary>
          <p className="my-2 text-xs text-[var(--text-2)]">Flux limits and RMS excitation components must come from characterised material data at the specified frequency. No extrapolation is used. Each component is AT/cm; the software converts it to secondary exciting current using magnetic length and turns.</p>
          {e.materials.map((m,i)=><div key={i} className="my-3 border border-[var(--line)] p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4"><SelectField label="Steel grade" value={m.gradeCode} onChange={ev=>patch({materials:e.materials.map((v,j)=>j===i?{...v,gradeCode:ev.target.value}:v)})}>{reference?.grades.map(g=><option key={g.code} value={g.code}>{g.label}</option>)}</SelectField>
              {(['workingFluxT','saturationFluxT','kneeFluxT'] as const).map(key=><Numeric key={key} label={key==='workingFluxT'?'Working flux ceiling (T)':key==='kneeFluxT'?'Characterised knee flux (T)':'Characterised saturation flux (T)'} value={m[key]} change={n=>patch({materials:e.materials.map((v,j)=>j===i?{...v,[key]:n}:v)})}/>)}</div>
            {m.lossCurve.map((p,k)=><div key={k} className="my-2 grid grid-cols-2 gap-3 md:grid-cols-4">{(['fluxT','lossAtCm','magnetisingAtCm'] as const).map(key=><Numeric key={key} label={key==='fluxT'?'Flux (T)':key==='lossAtCm'?'Loss component (AT/cm)':'Magnetising component (AT/cm)'} value={p[key]} change={n=>patch({materials:e.materials.map((v,j)=>j===i?{...v,lossCurve:v.lossCurve.map((q,l)=>l===k?{...q,[key]:n ?? 0}:q)}:v)})}/>)}<Button size="sm" onClick={()=>patch({materials:e.materials.map((v,j)=>j===i?{...v,lossCurve:v.lossCurve.filter((_,l)=>l!==k)}:v)})}>Remove point</Button></div>)}
            <div className="mt-3 flex gap-2"><Button size="sm" onClick={()=>patch({materials:e.materials.map((v,j)=>j===i?{...v,lossCurve:[...v.lossCurve,{fluxT:0,lossAtCm:0,magnetisingAtCm:0}]}:v)})}>Add flux point</Button><Button size="sm" onClick={()=>patch({materials:e.materials.filter((_,j)=>j!==i)})}>Remove grade</Button></div>
          </div>)}
          <Button size="sm" onClick={()=>patch({materials:[...e.materials,{gradeCode:reference?.grades.find(g=>!e.materials.some(m=>m.gradeCode===g.code))?.code ?? 'M-4',workingFluxT:0,saturationFluxT:null,kneeFluxT:null,lossCurve:[]}]})}>Add magnetic grade data</Button>
        </details>
        <details open><summary className="cursor-pointer text-sm font-semibold">Acceptance requirements · {e.purpose}</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {numeric('Allowed working AT loss', 'allowedAtLoss')}{numeric('Maximum exciting current (A)', 'maxExcitationCurrentA')}{numeric('Excitation check voltage (V)', 'excitationCheckVoltage')}{numeric('Maximum Rct at 75 °C (Ω)', 'maxResistance75Ohm')}
            {e.purpose==='protection' && <>{numeric('Accuracy limit factor', 'accuracyLimitFactor')}{numeric('Composite error screening limit (%)', 'maxCompositeErrorPercent')}</>}
            {e.purpose==='ps' && <>{numeric('Required knee-point voltage (V)', 'requiredKneeVoltage')}{numeric('Approved PS resistance formula multiplier', 'psVoltageFactor')}<p className="text-xs">Vk ≥ multiplier × Is × (Rct75 + external loop resistance + resistive burden). Confirm this formula against the client’s protection scheme.</p></>}
          </div>
          {e.purpose==='metering' && <><p className="my-3 text-xs text-[var(--text-2)]">Supply every required current/burden test point and its ratio/phase limits from the applicable specification.</p>
          {e.testPoints.map((p,i)=><div key={i} className="my-2 grid grid-cols-2 gap-3 md:grid-cols-5">{(['currentPercent','burdenPercent','maxRatioErrorPercent','maxPhaseMinutes'] as const).map(key=><Numeric key={key} label={{currentPercent:'Rated current (%)',burdenPercent:'Rated burden (%)',maxRatioErrorPercent:'Max ratio error (%)',maxPhaseMinutes:'Max phase error (minutes)'}[key]} value={p[key]} change={n=>patch({testPoints:e.testPoints.map((v,j)=>j===i?{...v,[key]:n ?? 0}:v)})}/>)}<Button size="sm" onClick={()=>patch({testPoints:e.testPoints.filter((_,j)=>j!==i)})}>Remove test</Button></div>)}
          <Button size="sm" onClick={()=>patch({testPoints:[...e.testPoints,{currentPercent:100,burdenPercent:100,maxRatioErrorPercent:0,maxPhaseMinutes:0}]})}>Add required test point</Button></>}
        </details>
        <details><summary className="cursor-pointer text-sm font-semibold">Costing basis and manufacturing costs</summary><div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <SelectField label="Rank by" value={e.costing.basis} onChange={ev=>patch({costing:{...e.costing,basis:ev.target.value as 'material'|'manufacturing'}})}><option value="material">Steel + copper, including wastage</option><option value="manufacturing">Complete entered manufacturing cost</option></SelectField>
          {(['insulationPerUnit','resinPerUnit','labourPerUnit','overheadPerUnit','steelWastePercent','copperWastePercent'] as const).map(key=><Numeric key={key} label={{insulationPerUnit:'Insulation / unit (₹)',resinPerUnit:'Resin / unit (₹)',labourPerUnit:'Labour / unit (₹)',overheadPerUnit:'Overhead / unit (₹)',steelWastePercent:'Steel wastage (%)',copperWastePercent:'Copper wastage (%)'}[key]} value={e.costing[key]} change={n=>patch({costing:{...e.costing,[key]:n}})}/>)}</div></details>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label="Confirm engineering inputs" checked={e.confirmed} onChange={ev=>patch({confirmed:ev.target.checked})}/>The responsible engineer has confirmed these inputs, the uniform-build model and the complete acceptance test matrix.</label>
        {valid && !valid.success && <Callout tone="warn" title="Engineering fields need attention">{valid.error.issues.slice(0,5).map(i=><p key={i.path.join('.')}>{i.path.join('.')}: {i.message}</p>)}</Callout>}
        <div className="flex flex-wrap items-center gap-3"><Button size="sm" onClick={()=>{ const a=document.createElement('a');const u=URL.createObjectURL(new Blob([JSON.stringify(e,null,2)],{type:'application/json'}));a.href=u;a.download='ct-engineering-spec.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000); }}>Export engineering inputs</Button>
          <label className="text-xs">Import client inputs (JSON)<input aria-label="Import engineering inputs" className="block mt-1 text-xs" type="file" accept=".json,application/json" onChange={async ev=>{const f=ev.target.files?.[0];if(!f)return;try{if(f.size>500000)throw new Error('Input file is too large.');const parsed=engineeringSpecSchema.parse(JSON.parse(await f.text()));onChange({...parsed,confirmed:false});setImportError('');}catch(err){setImportError(err instanceof Error?err.message:'Invalid input file.');}ev.target.value='';}}/></label>
        </div>{importError && <Callout tone="warn" title="Import failed">{importError}</Callout>}
      </>}
    </div>
  </Card>;
}
