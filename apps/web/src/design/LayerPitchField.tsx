import { resolveLayerPitchMm, type ProcessSettings, type WireGauge } from '@meltek/engine';

export function LayerPitchField({ gauge, settings, value, onChange }: {
  gauge: WireGauge; settings: ProcessSettings; value?: number; onChange: (value: number | undefined) => void;
}) {
  const insulated = gauge.diaMm + settings.wireInsulationMm;
  let saved: number | undefined;
  let message: string | undefined;
  try { saved = resolveLayerPitchMm({...gauge,layerPitchMm:gauge.layerPitchMm ?? null},insulated); }
  catch { message = 'Saved pitch is smaller than the insulated wire. Override it or edit the wire reference.'; }
  if (value !== undefined && (!Number.isFinite(value) || value < insulated)) message = `Minimum ${insulated.toFixed(3)} mm including insulation.`;
  else if (value !== undefined) message = undefined;
  return <div className="wire-layer-pitch-field">
    <input type="number" min={insulated} step="0.01" value={value ?? ''} placeholder={saved?.toFixed(2) ?? 'Review'}
      aria-label={`${gauge.swg} SWG layer pitch`} aria-invalid={Boolean(message)}
      title={`SWG ${gauge.swg}: total wire + air allowance per layer. Default ${saved?.toFixed(2) ?? 'needs review'} mm; tape is added separately.`}
      onChange={event => { const raw=event.target.value; if(raw==='') onChange(undefined); else if(Number.isFinite(Number(raw))) onChange(Number(raw)); }}
      className="num rounded border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1 text-center text-[13px]" />
    {message && <span className="wire-pitch-error" role="alert">{message}</span>}
  </div>;
}
