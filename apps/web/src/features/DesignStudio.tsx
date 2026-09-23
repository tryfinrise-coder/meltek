import { useId } from 'react';
import type { DesignInputs, RankedOption } from '@meltek/engine';
import { AnimatedNumber, Badge } from '../components/primitives';

export function DesignStudio({ inputs, best, options, quantity, family }: {
  inputs: DesignInputs | null; best: RankedOption | null; options: RankedOption[]; quantity: number; family: string;
}) {
  const id = useId().replace(/:/g, '');
  const manufacturing = inputs?.engineering?.costing.basis === 'manufacturing';
  const feasible = options.filter(o => o.isFeasible);
  const next = feasible.find(o => o.rank === 2);
  const saving = best?.totalCost != null && next?.totalCost != null ? next.totalCost - best.totalCost : 0;
  const inner = inputs ? Math.max(20, Math.min(62, 85 * inputs.finishedIdMm / inputs.finishedOdMm)) : 45;
  return <section className="studio-hero" aria-label="LT CT design overview">
    <div className="studio-intro">
      <div className="flex flex-wrap items-center gap-2"><Badge tone="brand">Design studio 01</Badge><Badge tone="ok">LT CT available</Badge></div>
      <h2 className="mt-5 text-2xl md:text-3xl">Precision in every turn.</h2>
      <p className="mt-3 max-w-md text-sm text-[var(--text-2)]">Explore steel and copper combinations. Find the lowest material cost within your design and stock constraints.</p>
      <div className="mt-6 flex flex-wrap gap-3 text-xs text-[var(--text-2)]"><span className="studio-pill">{family}</span><span className="studio-pill">{feasible.length} feasible / {options.length} evaluated</span></div>
    </div>
    <div className="core-scene">
      <svg viewBox="0 0 260 230" role="img" aria-label="Illustrative ring core preview; not a manufacturing drawing">
        <defs>
          <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b8fff4"/><stop offset=".3" stopColor="#43b9ae"/><stop offset=".55" stopColor="#143e50"/><stop offset=".8" stopColor="#72ddcf"/><stop offset="1" stopColor="#20374d"/></linearGradient>
          <radialGradient id={`${id}-glow`}><stop stopColor="#65e4d0" stopOpacity=".28"/><stop offset="1" stopColor="#65e4d0" stopOpacity="0"/></radialGradient>
          <mask id={`${id}-hole`}><rect width="260" height="230" fill="white"/><circle cx="130" cy="105" r={inner} fill="black"/></mask>
        </defs>
        <ellipse cx="130" cy="191" rx="88" ry="17" fill={`url(#${id}-glow)`}/>
        <g className="core-float">
          <circle cx="130" cy="113" r="88" fill="#132c3d" mask={`url(#${id}-hole)`}/>
          <circle cx="130" cy="105" r="85" fill={`url(#${id}-metal)`} mask={`url(#${id}-hole)`}/>
          {[0,1,2,3,4].map(n => <circle key={n} cx="130" cy="105" r={80-n*3} fill="none" stroke="#d4fff4" strokeOpacity=".18"/>)}
          <circle cx="130" cy="105" r={inner+1} fill="none" stroke="#b5fff0" strokeOpacity=".65"/>
          <g className="core-flux"><circle cx="130" cy="105" r="96" fill="none" stroke="#7cf4dc" strokeWidth="1" strokeDasharray="35 20 2 25" opacity=".7"/></g>
        </g>
        <text x="130" y="220" textAnchor="middle" fill="currentColor" fontSize="10" letterSpacing="2">RING CORE · CONCEPT PREVIEW</text>
      </svg>
    </div>
    <div className="studio-recommendation" aria-live="polite">
      <div className="eyebrow">Lowest feasible {manufacturing ? 'manufacturing' : 'material'} cost</div>
      <div className="my-3 text-4xl font-semibold num"><AnimatedNumber value={best?.totalCost ?? null} prefix="₹" dp={2}/><span className="text-xs font-normal text-[var(--text-2)]"> / unit</span></div>
      <p className="text-sm">{best ? `${best.gradeLabel} · SWG ${best.swg}` : 'Awaiting a feasible specification'}</p>
      <div className="my-4 rule-fade"/>
      <div className="flex justify-between gap-3 text-xs"><span>{manufacturing ? 'Manufacturing' : 'Material'} estimate · {quantity} units</span><strong className="num">{best?.totalCost != null ? `₹${(best.totalCost * quantity).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</strong></div>
      <p className="mt-3 text-xs text-[var(--text-2)]">{saving > 0 ? `₹${saving.toFixed(2)} less per unit than the next feasible option. ` : ''}{manufacturing ? 'Includes entered insulation, resin, labour, overhead and wastage; excludes tax.' : 'Excludes labour, resin, overhead and tax.'} Tooling checks depend on your reference data.</p>
    </div>
  </section>;
}
