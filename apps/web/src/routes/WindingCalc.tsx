import { useCallback, useMemo, useReducer } from 'react';
import { useReducedMotion, motion } from 'motion/react';
import { Card, PageHeader } from '../components/primitives';
import { TextField, SelectField, FieldShell } from '../components/fields';
import { useReference } from '../features/useCalculator';
import { pageVariants, stagger, fadeUp } from '../lib/motion';
import type { WireGauge } from '@meltek/engine';

const PI = Math.PI;
const CU_DENSITY = 8.89; // g/cm³

interface State {
  coreID: number;
  coreOD: number;
  coreWidth: number;
  density: number;
  stackingFactor: number;
  primaryA: number;
  secondaryA: number;
  leadLength: number;
  insThickness: number;
  layerTape: number;
  spacingFactor: number;
  flatAllowance: number;
  wireMap: Record<number, number>;
}

const initial: State = {
  coreID: 48, coreOD: 66, coreWidth: 30,
  density: 7.89, stackingFactor: 0.97,
  primaryA: 200, secondaryA: 5,
  leadLength: 0, insThickness: 0.15, layerTape: 0.10,
  spacingFactor: 1.10, flatAllowance: 15,
  wireMap: { 21: 1, 22: 2, 23: 1 },
};

type Action =
  | { type: 'field'; key: keyof Omit<State, 'wireMap'>; value: number }
  | { type: 'wire'; swg: number; count: number };

function reducer(s: State, a: Action): State {
  if (a.type === 'field') return { ...s, [a.key]: a.value };
  return { ...s, wireMap: { ...s.wireMap, [a.swg]: a.count } };
}

interface LayerRow {
  layer: number;
  turns: number;
  mlt: number;
  wire: number;
}

interface CalcResult {
  coreWeight: number;
  coreArea: number;
  turns: number;
  mltBase: number;
  mltFlat: number;
  mltPractical: number;
  actualAllowancePct: number;
  flatWireLength: number;
  practicalWireLength: number;
  layers: LayerRow[];
  copperByGauge: { swg: number; count: number; dia: number; area: number; weightPractical: number; weightFlat: number }[];
  totalCuPractical: number;
  totalCuFlat: number;
}

function calculate(s: State, gauges: WireGauge[]): CalcResult | null {
  const { coreID: ID, coreOD: OD, coreWidth: W, density, stackingFactor: sf } = s;
  if (ID <= 0 || OD <= ID || W <= 0 || s.secondaryA <= 0) return null;

  const turns = s.primaryA / s.secondaryA;
  const meanCirc = (ID + OD) / 2 * PI;
  const crossSection = (OD - ID) / 2 * W;
  const coreWeight = meanCirc * crossSection * density * sf / 1e6;

  const mltBase = (OD - ID) + W * 2;
  const flatFactor = 1 + s.flatAllowance / 100;
  const mltFlat = mltBase * flatFactor;

  const wires = gauges
    .filter(g => (s.wireMap[g.swg] ?? 0) > 0)
    .map(g => ({ swg: g.swg, count: s.wireMap[g.swg], dia: g.diaMm, area: g.areaSqmm }));

  const totalWireWidth = wires.reduce((sum, w) => sum + w.count * (w.dia + s.insThickness), 0);
  const effectiveDia = wires.length > 0
    ? Math.max(...wires.map(w => w.dia)) + s.insThickness
    : 0;

  const turnPitch = totalWireWidth * s.spacingFactor;
  const turnsPerLayer = turnPitch > 0 ? Math.max(1, Math.floor(W / turnPitch)) : turns;
  const numLayers = Math.ceil(turns / turnsPerLayer);
  const layerThickness = effectiveDia + s.layerTape;

  const layers: LayerRow[] = [];
  let totalWireLength = 0;
  let turnsLeft = turns;

  for (let i = 0; i < numLayers; i++) {
    const layerTurns = Math.min(turnsPerLayer, turnsLeft);
    turnsLeft -= layerTurns;
    const radialOffset = i * layerThickness + layerThickness / 2;
    const layerMLT = mltBase + 2 * PI * radialOffset;
    const layerWire = layerTurns * layerMLT;
    layers.push({ layer: i + 1, turns: layerTurns, mlt: layerMLT, wire: layerWire });
    totalWireLength += layerWire;
  }

  const totalWithLead = totalWireLength + s.leadLength * 2;
  const flatWireLength = turns * mltFlat + s.leadLength * 2;
  const practicalAvgMLT = turns > 0 ? totalWireLength / turns : 0;
  const actualAllowancePct = mltBase > 0 ? ((practicalAvgMLT / mltBase) - 1) * 100 : 0;

  let totalCuPractical = 0;
  let totalCuFlat = 0;
  const copperByGauge = wires.map(w => {
    const wp = w.count * w.area * totalWithLead * CU_DENSITY / 1e6;
    const wf = w.count * w.area * flatWireLength * CU_DENSITY / 1e6;
    totalCuPractical += wp;
    totalCuFlat += wf;
    return { ...w, weightPractical: wp, weightFlat: wf };
  });

  return {
    coreWeight, coreArea: crossSection, turns,
    mltBase, mltFlat, mltPractical: practicalAvgMLT,
    actualAllowancePct, flatWireLength, practicalWireLength: totalWithLead,
    layers, copperByGauge, totalCuPractical, totalCuFlat,
  };
}

function fmt(n: number, d = 2) { return n.toFixed(d); }

export function WindingCalc() {
  const reduce = useReducedMotion() ?? false;
  const { data: ref } = useReference();
  const [s, dispatch] = useReducer(reducer, initial);

  const setField = useCallback((key: keyof Omit<State, 'wireMap'>, v: string) => {
    dispatch({ type: 'field', key, value: parseFloat(v) || 0 });
  }, []);

  const gauges = ref?.gauges ?? [];
  const result = useMemo(() => calculate(s, gauges), [s, gauges]);

  const maxLen = result ? Math.max(result.flatWireLength, result.practicalWireLength, 1) : 1;
  const diff = result ? result.practicalWireLength - result.flatWireLength : 0;

  return (
    <motion.div
      variants={pageVariants(reduce)}
      initial="hidden" animate="show" exit="exit"
      className="flex flex-col gap-6 pb-12"
    >
      <PageHeader eyebrow="Tools" title="Winding Calculator">
        Layer-by-layer copper weight analysis — practical MLT vs adjustable flat allowance
      </PageHeader>

      <motion.div variants={stagger(reduce)} initial="hidden" animate="show"
        className="grid gap-5 lg:grid-cols-2 items-start"
      >
        {/* ─── LEFT: INPUTS ─── */}
        <div className="flex flex-col gap-4">
          <motion.div variants={fadeUp(reduce)}>
            <Card title="Core Dimensions" eyebrow="Toroidal">
              <div className="grid grid-cols-3 gap-4 px-5 py-4">
                <TextField label="ID" unit="mm" type="number" value={s.coreID}
                  onChange={e => setField('coreID', e.target.value)} />
                <TextField label="OD" unit="mm" type="number" value={s.coreOD}
                  onChange={e => setField('coreOD', e.target.value)} />
                <TextField label="Width" unit="mm" type="number" value={s.coreWidth}
                  onChange={e => setField('coreWidth', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-[var(--line)] px-5 py-4">
                <TextField label="Density" unit="g/cm³" type="number" step="0.01" value={s.density}
                  hint="CRGO ≈ 7.89, Nano ≈ 7.18"
                  onChange={e => setField('density', e.target.value)} />
                <TextField label="Stacking Factor" type="number" step="0.01" value={s.stackingFactor}
                  onChange={e => setField('stackingFactor', e.target.value)} />
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp(reduce)}>
            <Card title="CT Ratio & Winding">
              <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
                <TextField label="Primary" unit="A" type="number" value={s.primaryA}
                  onChange={e => setField('primaryA', e.target.value)} />
                <TextField label="Secondary" unit="A" type="number" value={s.secondaryA}
                  onChange={e => setField('secondaryA', e.target.value)} />
                <TextField label="Lead Length" unit="mm" type="number" value={s.leadLength}
                  onChange={e => setField('leadLength', e.target.value)} />
                <TextField label="Insulation" unit="mm" type="number" step="0.01" value={s.insThickness}
                  hint="Per-turn wire insulation thickness"
                  onChange={e => setField('insThickness', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-[var(--line)] px-5 py-4">
                <TextField label="Inter-layer Tape" unit="mm" type="number" step="0.01" value={s.layerTape}
                  onChange={e => setField('layerTape', e.target.value)} />
                <SelectField label="Winding Spacing"
                  value={String(s.spacingFactor)}
                  onChange={e => setField('spacingFactor', e.target.value)}>
                  <option value="1.05">Tight (×1.05)</option>
                  <option value="1.10">Normal (×1.10)</option>
                  <option value="1.20">Loose / Hand (×1.20)</option>
                </SelectField>
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp(reduce)}>
            <Card title="Wire Gauges" subtitle="Number of wires in parallel per gauge">
              <div className="px-5 py-3">
                {gauges.filter(g => g.isAvailable).map(g => (
                  <div key={g.swg}
                    className="flex items-center gap-3 border-b border-[var(--line)] py-2 last:border-0"
                  >
                    <span className="w-16 shrink-0 text-[13px] font-medium">{g.swg} SWG</span>
                    <span className="flex-1 text-[12px] text-[var(--text-3)] mono">⌀ {g.diaMm.toFixed(3)} mm</span>
                    <input
                      type="number" min={0} step={1}
                      value={s.wireMap[g.swg] ?? 0}
                      onChange={e => dispatch({ type: 'wire', swg: g.swg, count: parseInt(e.target.value) || 0 })}
                      className="w-16 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-center text-[13px] font-medium num focus:border-[var(--brand)] focus:outline-none"
                    />
                  </div>
                ))}
                {gauges.length === 0 && (
                  <p className="py-4 text-center text-[13px] text-[var(--text-3)]">
                    Loading wire gauges from reference data…
                  </p>
                )}
              </div>
            </Card>
          </motion.div>
        </div>

        {/* ─── RIGHT: RESULTS ─── */}
        <div className="flex flex-col gap-4">
          <motion.div variants={fadeUp(reduce)}>
            <Card title="Core">
              <div className="divide-y divide-[var(--line)]">
                <StatRow label="Core Weight" value={result ? fmt(result.coreWeight, 4) + ' kg' : '—'} />
                <StatRow label="Cross-section Area" value={result ? fmt(result.coreArea, 1) + ' mm²' : '—'} />
                <StatRow label="Turns (Ratio)" value={result ? `${result.turns} T  (${s.primaryA}/${s.secondaryA})` : '—'} />
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp(reduce)}>
            <Card title="MLT Comparison">
              <div className="px-5 pt-3 pb-1">
                <FieldShell label={`Flat Allowance — ${s.flatAllowance}%`}
                  help="Drag to compare against any flat percentage">
                  <input type="range" min={0} max={40} step={0.5}
                    value={s.flatAllowance}
                    onChange={e => setField('flatAllowance', e.target.value)}
                    className="w-full accent-[var(--brand)] cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-[var(--text-3)] mt-0.5">
                    <span>0%</span><span>10%</span><span>20%</span><span>30%</span><span>40%</span>
                  </div>
                </FieldShell>
              </div>
              <div className="divide-y divide-[var(--line)] mt-2">
                <StatRow label="Theoretical MLT (no allowance)" value={result ? fmt(result.mltBase, 1) + ' mm' : '—'} />
                <StatRow label={`Flat ${s.flatAllowance}% MLT`} value={result ? fmt(result.mltFlat, 1) + ' mm' : '—'} />
                <StatRow label="Practical MLT (layer avg)" value={result ? fmt(result.mltPractical, 1) + ' mm' : '—'} accent />
                <StatRow label="Actual Winding Allowance"
                  value={result ? <>
                    {fmt(result.actualAllowancePct, 1)}%
                    <DiffTag diff={result.actualAllowancePct - s.flatAllowance}
                      label={`vs flat ${s.flatAllowance}%`} />
                  </> : '—'} />
              </div>

              {result && (
                <div className="mx-5 mb-4 mt-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3">
                  <div className="flex justify-between text-[11.5px] text-[var(--text-3)] mb-2">
                    <span>Wire Length Comparison</span>
                    <span className="mono">
                      {diff >= 0 ? '+' : ''}{diff.toFixed(0)} mm
                      ({diff >= 0 ? '+' : ''}{(result.flatWireLength > 0 ? (diff / result.flatWireLength * 100) : 0).toFixed(1)}%)
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-[11px] text-[var(--text-3)]">Flat</span>
                      <div className="h-2 flex-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                        <div className="h-full rounded-full bg-[var(--text-3)] transition-all duration-300"
                          style={{ width: `${(result.flatWireLength / maxLen) * 100}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-[11px] text-[var(--text-3)]">Practical</span>
                      <div className="h-2 flex-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
                        <div className="h-full rounded-full bg-[var(--brand)] transition-all duration-300"
                          style={{ width: `${(result.practicalWireLength / maxLen) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>

          <motion.div variants={fadeUp(reduce)}>
            <Card title="Layer-by-Layer Breakdown">
              <div className="overflow-x-auto px-5 py-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">
                      <th className="text-left py-1.5 font-semibold">Layer</th>
                      <th className="text-right py-1.5 font-semibold">Turns</th>
                      <th className="text-right py-1.5 font-semibold">MLT (mm)</th>
                      <th className="text-right py-1.5 font-semibold">Wire (mm)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {result?.layers.map(l => (
                      <tr key={l.layer}>
                        <td className="py-1.5 mono">{l.layer}</td>
                        <td className="py-1.5 text-right mono">{l.turns}</td>
                        <td className="py-1.5 text-right mono">{fmt(l.mlt, 1)}</td>
                        <td className="py-1.5 text-right mono">{l.wire.toFixed(0)}</td>
                      </tr>
                    ))}
                    {result && (
                      <tr className="border-t-2 border-[var(--brand)] font-semibold" style={{ color: 'var(--brand)' }}>
                        <td className="py-1.5">Total</td>
                        <td className="py-1.5 text-right mono">{result.turns}</td>
                        <td className="py-1.5 text-right mono">{fmt(result.mltPractical, 1)} avg</td>
                        <td className="py-1.5 text-right mono">{result.practicalWireLength.toFixed(0)}</td>
                      </tr>
                    )}
                    {!result && (
                      <tr><td colSpan={4} className="py-4 text-center text-[var(--text-3)]">Enter valid inputs</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp(reduce)}>
            <Card title="Copper Weight">
              <div className="divide-y divide-[var(--line)]">
                {result?.copperByGauge.map(c => (
                  <StatRow key={c.swg} label={`${c.swg} SWG × ${c.count}`}
                    value={fmt(c.weightPractical, 4) + ' kg'} />
                ))}
              </div>
              <div className="border-t-2 border-[var(--line-strong)] divide-y divide-[var(--line)]">
                <StatRow label="Total Copper (Practical)" value={result ? fmt(result.totalCuPractical, 4) + ' kg' : '—'} accent />
                <StatRow label={`Total Copper (Flat ${s.flatAllowance}%)`} value={result ? fmt(result.totalCuFlat, 4) + ' kg' : '—'} />
                <StatRow label="Difference" value={result ? <>
                  {((result.totalCuPractical - result.totalCuFlat) * 1000).toFixed(1)} g
                  <DiffTag diff={result.totalCuPractical - result.totalCuFlat}
                    label={result.totalCuFlat > 0
                      ? ((result.totalCuPractical - result.totalCuFlat) / result.totalCuFlat * 100).toFixed(1) + '%'
                      : '0%'} />
                </> : '—'} />
              </div>
            </Card>
          </motion.div>

          <motion.div variants={fadeUp(reduce)}>
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 text-[13px] leading-relaxed text-[var(--text-2)]">
              <strong className="text-[var(--text)]">How Practical MLT works:</strong> Instead of
              adding a flat {s.flatAllowance}%, this computes how many turns fit per layer based on wire
              diameter + insulation. Each successive layer sits further from the core, increasing its
              MLT by 2π × (wire_dia + inter-layer tape). The weighted average across all layers gives
              the true winding allowance.
            </div>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function StatRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13px]">
      <span className="text-[var(--text-2)]">{label}</span>
      <span className={`mono font-medium shrink-0 ${accent ? 'text-[var(--brand)]' : ''}`}>{value}</span>
    </div>
  );
}

function DiffTag({ diff, label }: { diff: number; label: string }) {
  const over = diff > 0.001;
  const under = diff < -0.001;
  if (!over && !under) return null;
  return (
    <span className={`ml-2 inline-block rounded-[3px] px-1.5 py-0.5 text-[11px] font-semibold mono
      ${over
        ? 'bg-[rgba(var(--warn-rgb,217,164,65),0.15)] text-[var(--warn)]'
        : 'bg-[rgba(var(--ok-rgb,63,179,127),0.15)] text-[var(--ok)]'
      }`}
    >
      {over ? '+' : ''}{label}
    </span>
  );
}
