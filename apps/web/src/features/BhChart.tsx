import {
  CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useReducedMotion } from 'motion/react';
import type { SteelGrade } from '@meltek/engine';
import { Badge } from '../components/primitives';

/**
 * The B–H curve with the interpolation point marked (§11.2).
 * When the saturation ceiling fires, both the curve value and the substituted value are
 * shown — that gap is usually the reason an expensive grade loses (§5.6).
 */
export default function BhChart({
  grade, h, bRaw, bUsed, capped,
}: { grade: SteelGrade; h: number; bRaw: number; bUsed: number; capped: boolean }) {
  const reduce = useReducedMotion();
  const data = grade.curve
    .filter((p) => p.hAtCm !== null)
    .map((p) => ({ h: p.hAtCm as number, b: p.teslaT }))
    .sort((a, b) => a.h - b.h);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-2)]">
        <span className="font-medium text-[var(--text)]">{grade.label}</span>
        <span className="mono">H = {h.toPrecision(6)} AT/cm</span>
        <span aria-hidden>→</span>
        <span className="mono">B = {bRaw.toFixed(4)} T</span>
        {capped && (
          <>
            <Badge tone="warn">capped to {bUsed.toFixed(2)} T</Badge>
            <span className="text-[12px]">
              the ceiling costs this grade {(((bRaw - bUsed) / bRaw) * 100).toFixed(0)}% of its flux
            </span>
          </>
        )}
      </div>

      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" />
            <XAxis
              dataKey="h" type="number" scale="log" domain={['dataMin', 'dataMax']}
              stroke="var(--text-3)" tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => String(Number(v.toPrecision(2)))}
              label={{ value: 'H — magnetising force (AT/cm)', position: 'insideBottom', offset: -14, fill: 'var(--text-3)', fontSize: 11 }}
            />
            <YAxis
              stroke="var(--text-3)" tick={{ fontSize: 11 }}
              label={{ value: 'B — flux density (T)', angle: -90, position: 'insideLeft', fill: 'var(--text-3)', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-2)', border: '1px solid var(--line-strong)',
                borderRadius: 8, fontSize: 12, fontVariantNumeric: 'tabular-nums',
              }}
              labelFormatter={(v) => `H ${Number(v).toPrecision(4)} AT/cm`}
              formatter={(v) => [`${v} T`, 'B']}
            />
            <Line
              type="monotone" dataKey="b" stroke="var(--info)" strokeWidth={2} dot={false}
              isAnimationActive={!reduce} animationDuration={500}
            />
            {capped && (
              <ReferenceLine
                y={bUsed} stroke="var(--warn)" strokeDasharray="4 4"
                label={{ value: `ceiling ${bUsed} T`, fill: 'var(--warn)', fontSize: 11, position: 'insideTopRight' }}
              />
            )}
            <ReferenceDot
              x={h} y={bRaw} r={5}
              fill="var(--brand)" stroke="var(--bg)" strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="measure mt-3 text-[12px] text-[var(--text-3)]">
        The marked point is this design's operating point, interpolated linearly between the two
        bracketing rows of the grade's curve. H is not truncated before the lookup.
      </p>
    </div>
  );
}
