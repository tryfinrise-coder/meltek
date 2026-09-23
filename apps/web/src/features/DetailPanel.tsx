import { EngineeringResults } from './EngineeringResults';
import { motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useState } from 'react';
import type { SolveResult, SteelGrade } from '@meltek/engine';
import { Badge, Callout, ProvisionalMark, Skeleton, StatTile } from '../components/primitives';
import { duration, ease, stagger } from '../lib/motion';

const BhChart = lazy(() => import('./BhChart'));

const n = (v: number | string, dp = 4) => (typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(dp) : '—') : v);

const TABS = ['chain', 'convergence', 'curve'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  chain: 'Calculation chain',
  convergence: 'Convergence',
  curve: 'B–H curve',
};

/**
 * The detail panel (§11.2): the full substituted chain, the convergence table and the
 * B–H curve with the interpolation point marked.
 *
 * "Show the working. Every result should be traceable to the inputs that produced it in
 * one click." (§16)
 */
export function DetailPanel({ result, grade }: { result: SolveResult; grade: SteelGrade | undefined }) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Tab>('chain');
  if (result.engineering) return <EngineeringResults result={result}/>;

  return (
    <div>
      <div className="flex gap-1 border-b border-[var(--line)] px-3">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="relative px-3 py-2.5 text-[13px] transition-colors"
            style={{ color: tab === t ? 'var(--text)' : 'var(--text-2)' }}
            aria-current={tab === t}
          >
            {TAB_LABEL[t]}
            {tab === t && (
              <motion.span
                layoutId="tab-underline"
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                style={{ background: 'var(--brand)' }}
                transition={reduce ? { duration: 0 } : ease.spring}
              />
            )}
          </button>
        ))}
      </div>

      {tab === 'chain' && <Chain result={result} reduce={Boolean(reduce)} />}
      {tab === 'convergence' && <Convergence result={result} />}
      {tab === 'curve' && (
        <div className="p-4">
          <Suspense fallback={<Skeleton className="h-[320px] w-full" />}>
            {grade
              ? <BhChart grade={grade} h={result.h} bRaw={result.bRawT} bUsed={result.bUsedT} capped={result.wasCapped} />
              : <p className="text-[13px] text-[var(--text-2)]">No curve on record for this grade.</p>}
          </Suspense>
        </div>
      )}
    </div>
  );
}

function Chain({ result, reduce }: { result: SolveResult; reduce: boolean }) {
  return (
    <motion.div variants={stagger(reduce)} initial="hidden" animate="show" className="divide-y divide-[var(--line)]">
      {result.steps.map((s) => (
        <motion.div
          key={s.key}
          variants={{
            hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
            show: reduce
              ? { opacity: 1, transition: { duration: duration.instant } }
              : { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
          }}
          className="grid grid-cols-[28px_1fr] gap-x-3 px-4 py-3 md:grid-cols-[28px_200px_1fr_auto]"
          style={s.provisional ? { background: 'color-mix(in srgb, var(--provisional) 5%, transparent)' } : undefined}
        >
          <div className="num text-[12px] text-[var(--text-3)]">{s.step}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
              {s.label}
              {s.provisional && <ProvisionalMark />}
            </div>
            <div className="mono text-[11px] text-[var(--text-3)]">{s.formula}</div>
          </div>
          <div className="col-start-2 md:col-start-3">
            <div className="mono text-[12px] text-[var(--text-2)] break-all">{s.substituted}</div>
            {s.note && <div className="mt-1 text-[11.5px] text-[var(--text-3)] measure">{s.note}</div>}
          </div>
          <div className="col-start-2 mono text-[13px] font-medium num md:col-start-4 md:text-right">
            {n(s.value)} <span className="text-[var(--text-3)]">{s.unit}</span>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

function Convergence({ result }: { result: SolveResult }) {
  return (
    <div className="p-4">
      <p className="measure mb-3 text-[13px] text-[var(--text-2)]">
        The calculation feeds back on itself: a wider core needs longer wire, longer wire has
        more resistance, and more resistance needs a wider core again. It repeats until the
        figure stops moving rather than stopping after a set number of passes.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Passes">{result.passes}</StatTile>
        <StatTile label="Converged">
          {result.converged ? <span style={{ color: 'var(--ok)' }}>yes</span> : <span style={{ color: 'var(--warn)' }}>no</span>}
        </StatTile>
        <StatTile label="Final V">{result.vTotal.toFixed(5)}</StatTile>
        <StatTile label="Wire drop">{result.vDrop.toFixed(5)} V</StatTile>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] mono">
          <thead>
            <tr className="border-b border-[var(--line-strong)]">
              {['Pass', 'V in', 'Area cm²', 'Width mm', 'Wire m', 'R Ω', 'V drop', 'V out', 'Δ'].map((h) => (
                <th key={h} className="label px-2 py-2 text-right font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.iterations.map((it) => (
              <tr key={it.pass} className="border-b border-[var(--line)]">
                <td className="px-2 py-1.5 text-right num text-[var(--text-3)]">{it.pass}</td>
                <td className="px-2 py-1.5 text-right num">{it.vIn.toFixed(5)}</td>
                <td className="px-2 py-1.5 text-right num">{it.areaCm2.toFixed(4)}</td>
                <td className="px-2 py-1.5 text-right num">{(it.widthCm * 10).toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right num">{it.lengthM.toFixed(3)}</td>
                <td className="px-2 py-1.5 text-right num">{it.resistanceOhm.toFixed(5)}</td>
                <td className="px-2 py-1.5 text-right num">{it.vDrop.toFixed(5)}</td>
                <td className="px-2 py-1.5 text-right num">{it.vNext.toFixed(5)}</td>
                <td className="px-2 py-1.5 text-right num text-[var(--text-3)]">{it.delta.toExponential(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!result.converged && (
        <div className="mt-4">
          <Callout tone="warn" title="Core size had not settled">
            The calculation reached its pass limit while the figure was still moving. Raise the
            iteration limit under Reference data, or check the inputs.
          </Callout>
        </div>
      )}
    </div>
  );
}

/** The warning strip above the options table (§11.2). */
export function WarningStrip({ warnings }: { warnings: { code: string; message: string; ref?: string }[] }) {
  const seen = new Set<string>();
  const unique = warnings.filter((w) => {
    const k = `${w.code}:${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {unique.map((w) => (
        <Callout
          key={`${w.code}:${w.message}`}
          tone={w.code === 'PROVISIONAL_OUTPUTS' ? 'provisional' : w.code === 'FLUX_CEILING_APPLIED' ? 'info' : 'warn'}
          title={
            <span className="flex items-center gap-2">
              {titleFor(w.code)}
              {w.ref && <Badge tone="neutral">{w.ref}</Badge>}
            </span>
          }
        >
          {w.message}
        </Callout>
      ))}
    </div>
  );
}

function titleFor(code: string): string {
  switch (code) {
    case 'FLUX_CEILING_APPLIED': return 'Flux ceiling applied';
    case 'H_BELOW_CURVE':
    case 'H_ABOVE_CURVE': return 'Outside the characterised range';
    case 'CLASS_NOT_PER_IS': return 'In-house error budget';
    case 'NO_CONVERGENCE': return 'Core size did not settle';
    case 'RATE_MISSING': return 'No rate on record';
    case 'PROVISIONAL_OUTPUTS': return 'Costs are estimates';
    case 'PLUS_FIVE_APPLIED': return 'Extra turn margin is on';
    case 'UNCONFIRMED_SETTINGS': return 'Setup needed';
    default: return 'Check this before ordering';
  }
}
