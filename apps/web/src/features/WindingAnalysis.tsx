import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { motion } from 'motion/react';
import { Card } from '../components/primitives';
import { TextField, SelectField, FieldShell } from '../components/fields';
import { fadeUp } from '../lib/motion';
import type { WireGauge } from '@meltek/engine';

const PI = Math.PI;
const CU_DENSITY = 8.89;

interface State {
  coreID: number;
  coreOD: number;
  coreWidth: number;
  density: number;
  stackingFactor: number;
  turns: number;
  leadLength: number;
  insThickness: number;
  layerTape: number;
  spacingFactor: number;
  flatAllowance: number;
  coreRate: number;
  cuRate: number;
  wireMap: Record<number, number>;
}

const initial: State = {
  coreID: 0, coreOD: 0, coreWidth: 0,
  density: 7.89, stackingFactor: 0.97,
  turns: 0, leadLength: 0,
  insThickness: 0.15, layerTape: 0.10,
  spacingFactor: 1.10, flatAllowance: 15,
  coreRate: 315, cuRate: 950,
  wireMap: {},
};

type Action =
  | { type: 'field'; key: keyof Omit<State, 'wireMap'>; value: number }
  | { type: 'wire'; swg: number; count: number }
  | { type: 'sync'; patch: Partial<State> };

function reducer(s: State, a: Action): State {
  if (a.type === 'field') return { ...s, [a.key]: a.value };
  if (a.type === 'wire') return { ...s, wireMap: { ...s.wireMap, [a.swg]: a.count } };
  return { ...s, ...a.patch };
}

interface LayerRow { layer: number; turns: number; mlt: number; wire: number }

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
  totalCuArea: number;
  cuSurfacePerTurn: number;
  windingBuildMm: number;
  possibleID: number;
  reqWireLength: number;
  shortLength: number;
  windingFits: boolean;
}

function calculate(s: State, gauges: WireGauge[]): CalcResult | null {
  const { coreID: ID, coreOD: OD, coreWidth: W, density, stackingFactor: sf } = s;
  if (ID <= 0 || OD <= ID || W <= 0 || s.turns <= 0) return null;

  const turns = s.turns;
  const meanCirc = (ID + OD) / 2 * PI;
  const crossSection = (OD - ID) / 2 * W;
  const coreWeight = meanCirc * crossSection * density * sf / 1e6;

  const mltBase = (OD - ID) + W * 2;
  const flatFactor = 1 + s.flatAllowance / 100;
  const mltFlat = mltBase * flatFactor;

  const wires = gauges
    .filter(g => (s.wireMap[g.swg] ?? 0) > 0)
    .map(g => ({ swg: g.swg, count: s.wireMap[g.swg], dia: g.diaMm, area: g.areaSqmm }));

  const totalCuArea = wires.reduce((sum, w) => sum + w.count * w.area, 0);
  const cuSurfacePerTurn = wires.reduce((sum, w) => sum + w.count * w.dia, 0);

  const totalWireWidth = wires.reduce((sum, w) => sum + w.count * (w.dia + s.insThickness), 0);
  const effectiveDia = wires.length > 0
    ? Math.max(...wires.map(w => w.dia)) + s.insThickness : 0;

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

  const windingBuildMm = numLayers * layerThickness;
  const possibleID = ID - (windingBuildMm * 2);
  const reqWireLength = turns * cuSurfacePerTurn * 1.05;
  const boreCirc = (ID - 2) * PI;
  const shortLength = reqWireLength - boreCirc;
  const windingFits = possibleID > 0;

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
    totalCuArea, cuSurfacePerTurn, windingBuildMm, possibleID,
    reqWireLength, shortLength, windingFits,
  };
}

function fmt(n: number, d = 2) { return n.toFixed(d); }

interface WindingAnalysisProps {
  reduce: boolean;
  gauges: WireGauge[];
  coreIdMm: number;
  coreOdMm: number;
  coreWidthMm: number;
  turns: number;
  selectedSwg: number;
  coreWeightKg: number;
}

export function WindingAnalysis({
  reduce, gauges, coreIdMm, coreOdMm, coreWidthMm, turns, selectedSwg, coreWeightKg,
}: WindingAnalysisProps) {
  const [s, dispatch] = useReducer(reducer, initial);

  const setField = useCallback((key: keyof Omit<State, 'wireMap'>, v: string) => {
    dispatch({ type: 'field', key, value: parseFloat(v) || 0 });
  }, []);

  useEffect(() => {
    const wireMap: Record<number, number> = { ...s.wireMap };
    if (!Object.values(wireMap).some(v => v > 0)) {
      wireMap[selectedSwg] = 1;
    }
    dispatch({
      type: 'sync',
      patch: {
        coreID: coreIdMm,
        coreOD: coreOdMm,
        coreWidth: coreWidthMm,
        turns,
        wireMap,
      },
    });
  }, [coreIdMm, coreOdMm, coreWidthMm, turns, selectedSwg]);

  const result = useMemo(() => calculate(s, gauges), [s, gauges]);

  const maxLen = result ? Math.max(result.flatWireLength, result.practicalWireLength, 1) : 1;
  const diff = result ? result.practicalWireLength - result.flatWireLength : 0;

  if (!result) return null;

  return (
    <>
      {/* ━━━ Pre-filled core info ━━━ */}
      <motion.div variants={fadeUp(reduce)}>
        <Card eyebrow="From selected design" title="Core & Turns"
          subtitle="Pre-filled from your selected grade × gauge combination">
          <div className="flex flex-wrap gap-x-8 gap-y-1 px-5 py-3 text-[13px]">
            <ResultPill label="Core ID" value={fmt(s.coreID, 1) + ' mm'} />
            <ResultPill label="Core OD" value={fmt(s.coreOD, 1) + ' mm'} />
            <ResultPill label="Core Width" value={fmt(s.coreWidth, 1) + ' mm'} />
            <ResultPill label="Turns" value={String(s.turns) + ' T'} accent />
            <ResultPill label="Core Weight" value={fmt(coreWeightKg, 4) + ' kg'} />
          </div>
        </Card>
      </motion.div>

      {/* ━━━ Wire selection ━━━ */}
      <motion.div variants={fadeUp(reduce)}>
        <Card eyebrow="Wire combination" title="Wire Selection"
          subtitle="Choose wire gauges and how many wires are wound in parallel for each">
          <div className="px-5 py-3">
            <div className="mb-2 grid grid-cols-[80px_1fr_72px] gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
              <span>Gauge</span>
              <span>Diameter</span>
              <span className="text-center">Wires</span>
            </div>
            {gauges.filter(g => g.isAvailable).map(g => (
              <div key={g.swg}
                className="grid grid-cols-[80px_1fr_72px] items-center gap-2 border-t border-[var(--line)] py-2"
              >
                <span className="text-[13px] font-medium">{g.swg} SWG</span>
                <span className="text-[12px] text-[var(--text-3)] mono">⌀ {g.diaMm.toFixed(3)} mm</span>
                <input
                  type="number" min={0} step={1}
                  value={s.wireMap[g.swg] ?? 0}
                  onChange={e => dispatch({ type: 'wire', swg: g.swg, count: parseInt(e.target.value) || 0 })}
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-center text-[13px] font-medium num focus:border-[var(--brand)] focus:outline-none"
                />
              </div>
            ))}
          </div>
          {result.copperByGauge.length > 0 && (
            <div className="border-t border-[var(--line)] bg-[var(--surface-2)] px-5 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
                Wire Combination Result
              </p>
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
                <ResultPill label="Total Cu Area" value={fmt(result.totalCuArea, 3) + ' mm²'} />
                <ResultPill label="Cu Surface / Turn" value={fmt(result.cuSurfacePerTurn, 3) + ' mm'} />
                <ResultPill label="Winding Build" value={fmt(result.windingBuildMm, 2) + ' mm'} />
                <ResultPill label="Possible ID" value={fmt(result.possibleID, 1) + ' mm'}
                  accent={result.windingFits} warn={!result.windingFits} />
              </div>
              {!result.windingFits && (
                <p className="mt-2 text-[12px] font-medium" style={{ color: 'var(--warn)' }}>
                  Winding does not fit — possible ID is negative. Reduce wire count or use thinner gauge.
                </p>
              )}
              {result.windingFits && (
                <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
                  <ResultPill label="Req. Wire Length" value={fmt(result.reqWireLength, 1) + ' mm'} />
                  <ResultPill label={result.shortLength > 0 ? 'Short by' : 'Spare'}
                    value={fmt(Math.abs(result.shortLength), 1) + ' mm'}
                    warn={result.shortLength > 0} accent={result.shortLength <= 0} />
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--line)] pt-2 text-[13px]">
                {result.copperByGauge.map(c => (
                  <ResultPill key={c.swg} label={`${c.swg} SWG × ${c.count}`}
                    value={fmt(c.area * c.count, 3) + ' mm² · ' + fmt(c.weightPractical, 4) + ' kg'} />
                ))}
              </div>
            </div>
          )}
        </Card>
      </motion.div>

      {/* ━━━ Winding parameters ━━━ */}
      <motion.div variants={fadeUp(reduce)}>
        <Card eyebrow="Winding parameters" title="Insulation & Spacing"
          subtitle="Insulation thickness, inter-layer tape and winding tightness">
          <div className="grid grid-cols-3 gap-4 px-5 py-4">
            <TextField label="Insulation" unit="mm" type="number" step="0.01" value={s.insThickness}
              hint="Tape/coating on each wire"
              onChange={e => setField('insThickness', e.target.value)} />
            <TextField label="Inter-layer Tape" unit="mm" type="number" step="0.01" value={s.layerTape}
              hint="Tape between winding layers"
              onChange={e => setField('layerTape', e.target.value)} />
            <SelectField label="Spacing"
              hint="How tightly the wire is wound"
              value={String(s.spacingFactor)}
              onChange={e => setField('spacingFactor', e.target.value)}>
              <option value="1.05">Tight (×1.05)</option>
              <option value="1.10">Normal (×1.10)</option>
              <option value="1.20">Loose / Hand (×1.20)</option>
            </SelectField>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t border-[var(--line)] px-5 py-4">
            <TextField label="Lead Length" unit="mm" type="number" value={s.leadLength}
              hint="Extra wire at both ends"
              onChange={e => setField('leadLength', e.target.value)} />
          </div>
          <div className="border-t border-[var(--line)] bg-[var(--surface-2)] px-5 py-3">
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
              <ResultPill label="Layers" value={String(result.layers.length)} />
              <ResultPill label="Turns/Layer" value={String(result.layers[0]?.turns ?? '—')} />
              <ResultPill label="Theoretical MLT" value={fmt(result.mltBase, 1) + ' mm'} />
              <ResultPill label="Practical MLT (avg)" value={fmt(result.mltPractical, 1) + ' mm'} accent />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ━━━ Layer breakdown ━━━ */}
      {result.layers.length > 0 && (
        <motion.div variants={fadeUp(reduce)}>
          <Card eyebrow="Layer breakdown" title="Layer-by-Layer MLT"
            subtitle="Each layer sits further from the core — its MLT is longer">
            <div className="overflow-x-auto px-5 py-3">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">
                    <th className="py-1.5 text-left font-semibold">Layer</th>
                    <th className="py-1.5 text-right font-semibold">Turns</th>
                    <th className="py-1.5 text-right font-semibold">MLT (mm)</th>
                    <th className="py-1.5 text-right font-semibold">Wire Length (mm)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {result.layers.map(l => (
                    <tr key={l.layer}>
                      <td className="py-1.5 mono">{l.layer}</td>
                      <td className="py-1.5 text-right mono">{l.turns}</td>
                      <td className="py-1.5 text-right mono">{fmt(l.mlt, 1)}</td>
                      <td className="py-1.5 text-right mono">{l.wire.toFixed(0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[var(--brand)] font-semibold" style={{ color: 'var(--brand)' }}>
                    <td className="py-1.5">Total</td>
                    <td className="py-1.5 text-right mono">{result.turns}</td>
                    <td className="py-1.5 text-right mono">{fmt(result.mltPractical, 1)} avg</td>
                    <td className="py-1.5 text-right mono">{result.practicalWireLength.toFixed(0)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      )}

      {/* ━━━ Flat vs practical comparison ━━━ */}
      <motion.div variants={fadeUp(reduce)}>
        <Card eyebrow="Comparison" title="Flat vs Practical Allowance"
          subtitle="Drag the slider to compare any flat allowance against the practical calculation">
          <div className="px-5 pt-4 pb-2">
            <FieldShell label={`Flat Allowance — ${s.flatAllowance}%`}
              help="The Excel method uses a single flat percentage. Drag to see the effect.">
              <input type="range" min={0} max={40} step={0.5}
                value={s.flatAllowance}
                onChange={e => setField('flatAllowance', e.target.value)}
                className="w-full accent-[var(--brand)] cursor-pointer"
              />
              <div className="mt-0.5 flex justify-between text-[11px] text-[var(--text-3)]">
                <span>0%</span><span>10%</span><span>20%</span><span>30%</span><span>40%</span>
              </div>
            </FieldShell>
          </div>

          <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
            <Row label="Theoretical MLT (no allowance)" value={fmt(result.mltBase, 1) + ' mm'} />
            <Row label={`Flat ${s.flatAllowance}% MLT`} value={fmt(result.mltFlat, 1) + ' mm'} />
            <Row label="Practical MLT (layer average)" value={fmt(result.mltPractical, 1) + ' mm'} accent />
            <Row label="Actual winding allowance"
              value={<>
                {fmt(result.actualAllowancePct, 1)}%
                <DiffTag diff={result.actualAllowancePct - s.flatAllowance}
                  suffix={`vs flat ${s.flatAllowance}%`} />
              </>} />
          </div>

          <div className="mx-5 my-4 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3">
            <div className="mb-2 flex justify-between text-[11.5px] text-[var(--text-3)]">
              <span>Total Wire Length</span>
              <span className="mono">
                {diff >= 0 ? '+' : ''}{diff.toFixed(0)} mm
                ({diff >= 0 ? '+' : ''}{(result.flatWireLength > 0 ? (diff / result.flatWireLength * 100) : 0).toFixed(1)}%)
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <BarRow label={`Flat ${s.flatAllowance}%`}
                pct={(result.flatWireLength / maxLen) * 100} dim />
              <BarRow label="Practical"
                pct={(result.practicalWireLength / maxLen) * 100} />
            </div>
          </div>

          <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
            <Row label="Total Copper (Practical)" value={fmt(result.totalCuPractical, 4) + ' kg'} accent />
            <Row label={`Total Copper (Flat ${s.flatAllowance}%)`} value={fmt(result.totalCuFlat, 4) + ' kg'} />
            <Row label="Difference" value={<>
              {((result.totalCuPractical - result.totalCuFlat) * 1000).toFixed(1)} g
              <DiffTag diff={result.totalCuPractical - result.totalCuFlat}
                suffix={result.totalCuFlat > 0
                  ? ((result.totalCuPractical - result.totalCuFlat) / result.totalCuFlat * 100).toFixed(1) + '%'
                  : '0%'} />
            </>} />
          </div>
        </Card>
      </motion.div>

      {/* ━━━ Cost ━━━ */}
      <motion.div variants={fadeUp(reduce)}>
        <Card eyebrow="Material cost" title="Practical Cost Estimate"
          subtitle="Enter current rates to estimate total material cost">
          <div className="grid grid-cols-2 gap-4 px-5 py-4">
            <TextField label="Core Rate" unit="₹/kg" type="number" value={s.coreRate}
              onChange={e => setField('coreRate', e.target.value)} />
            <TextField label="Copper Rate" unit="₹/kg" type="number" value={s.cuRate}
              onChange={e => setField('cuRate', e.target.value)} />
          </div>
          <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
            <Row label="Core Cost" value={'₹ ' + fmt(coreWeightKg * s.coreRate)} />
            <Row label="Copper Cost (Practical)" value={'₹ ' + fmt(result.totalCuPractical * s.cuRate)} />
          </div>
          <div className="border-t-2 border-[var(--line-strong)]">
            <Row label="Total Material Cost"
              value={'₹ ' + fmt(coreWeightKg * s.coreRate + result.totalCuPractical * s.cuRate)} accent />
          </div>
        </Card>
      </motion.div>

      {/* ━━━ Note ━━━ */}
      <motion.div variants={fadeUp(reduce)}>
        <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] p-4 text-[13px] leading-relaxed text-[var(--text-2)]">
          <strong className="text-[var(--text)]">How it works:</strong> A flat allowance (like 15%)
          assumes every turn of wire has the same path length. In reality, the first layer sits on
          the core surface, the second layer sits on top of the first, and so on — each layer has
          a longer path. This analysis computes the actual turns per layer, the MLT of each layer,
          and sums them to get the true copper requirement. The slider lets you compare this
          practical result against any flat percentage.
        </div>
      </motion.div>
    </>
  );
}

/* ─── Small reusable pieces ─── */

function ResultPill({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 py-0.5">
      <span className="text-[var(--text-3)]">{label}:</span>
      <span className={`mono font-medium ${warn ? 'text-[var(--warn)]' : accent ? 'text-[var(--brand)]' : ''}`}>{value}</span>
    </span>
  );
}

function Row({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13px]">
      <span className="text-[var(--text-2)]">{label}</span>
      <span className={`mono shrink-0 font-medium ${accent ? 'text-[var(--brand)]' : ''}`}>{value}</span>
    </div>
  );
}

function BarRow({ label, pct, dim }: { label: string; pct: number; dim?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-[var(--text-3)]">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className={`h-full rounded-full transition-all duration-300 ${dim ? 'bg-[var(--text-3)]' : 'bg-[var(--brand)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DiffTag({ diff, suffix }: { diff: number; suffix: string }) {
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
      {over ? '+' : ''}{suffix}
    </span>
  );
}
