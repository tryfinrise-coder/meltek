import { EngineeringResults } from './EngineeringResults';
import { motion, useReducedMotion } from 'motion/react';
import { lazy, Suspense, useCallback, useId, useState, type ReactNode } from 'react';
import type { SolveResult, SteelGrade } from '@meltek/engine';
import { Badge, Callout, Hint, ProvisionalMark, Skeleton, StatTile } from '../shared/primitives';
import { duration, ease, stagger } from '../shared/motion';
import { exportCalcChain } from './exportCalcChain';

const BhChart = lazy(() => import('./BhChart'));

const n = (v: number | string, dp = 3) => (typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(dp) : '—') : v);

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
export function DetailPanel({ result, grade, gradeLabel, presentation = 'tabs' }: { result: SolveResult; grade: SteelGrade | undefined; gradeLabel?: string; presentation?: 'tabs' | 'report' }) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Tab>('chain');
  const tabId = useId();
  const handleExport = useCallback(() => {
    exportCalcChain(result, gradeLabel ?? result.gradeCode);
  }, [result, gradeLabel]);

  if (result.engineering) return <EngineeringResults result={result} gradeLabel={gradeLabel ?? result.gradeCode} />;

  if (presentation === 'report') return (
    <div className="calculation-report">
      <div className="calculation-report-tools">
        <button type="button" onClick={handleExport}>Download calculation as Excel</button>
      </div>
      <Chain result={result} reduce={Boolean(reduce)} />
      <section className="calculation-report-convergence">
        <h3>Convergence</h3>
        <Convergence result={result} />
      </section>
      <details className="calculation-report-curve">
        <summary>B–H curve and operating point</summary>
        <Suspense fallback={<Skeleton className="h-[320px] w-full" />}>
          {grade ? <BhChart grade={grade} h={result.h} bRaw={result.bRawT} bUsed={result.bUsedT} capped={result.wasCapped} /> : <p>No curve on record for this grade.</p>}
        </Suspense>
      </details>
    </div>
  );

  return (
    <div>
      <div className="calculation-tab-toolbar">
        <div className="calculation-tabs" role="tablist" aria-label="Calculation views">
        {TABS.map((t, index) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="calculation-tab"
            role="tab"
            id={`${tabId}-${t}`}
            aria-selected={tab === t}
            aria-controls={`${tabId}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
              setTab(TABS[next]!);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}
          >
            <span className="calculation-tab-index" aria-hidden="true">0{index + 1}</span>{TAB_LABEL[t]}
          </button>
        ))}
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="ml-auto rounded-md border border-[var(--line)] px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-2)]"
          title="Download calculation as Excel"
        >
          Download Excel
        </button>
      </div>

      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} tabIndex={0}>
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
    </div>
  );
}

const SECTIONS: { title: string; keys: string[]; color: string; bg: string }[] = [
  { title: 'Geometry & Inputs',
    keys: ['turns', 'allowance', 'coreId', 'coreOd', 'radialBuild'],
    color: 'var(--chain-geometry)',
    bg: 'var(--chain-geometry-bg)' },
  { title: 'Electrical Calculation',
    keys: ['burdenVoltage', 'atLoss', 'mml', 'h', 'bRaw', 'bUsed', 'area', 'width'],
    color: 'var(--chain-electrical)',
    bg: 'var(--chain-electrical-bg)' },
  { title: 'Costing Estimates',
    keys: ['orderedWidth', 'coreWeight', 'copperWeight', 'cost'],
    color: 'var(--chain-costing)',
    bg: 'var(--chain-costing-bg)' },
];

function Chain({ result, reduce }: { result: SolveResult; reduce: boolean }) {
  const grouped = SECTIONS.map((sec) => ({
    ...sec,
    steps: result.steps.filter((s) => sec.keys.includes(s.key)),
  })).filter((sec) => sec.steps.length > 0);

  return (
    <motion.div variants={stagger(reduce)} initial="hidden" animate="show" className="flex flex-col gap-5 py-4">
      {grouped.map((sec) => (
        <div key={sec.title}>
          <div
            className="mx-4 mb-2 flex items-center gap-2 border-l-[3px] pl-3 text-[11px] font-semibold uppercase tracking-wider"
            style={{ borderColor: sec.color, color: sec.color }}
          >
            {sec.title}
          </div>
          <div className="divide-y divide-[var(--line)]">
            {sec.steps.map((s) => (
              <motion.div
                key={s.key}
                variants={{
                  hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
                  show: reduce
                    ? { opacity: 1, transition: { duration: duration.instant } }
                    : { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
                }}
                className="calculation-step grid grid-cols-[32px_1fr] gap-x-3 px-4 py-3 md:grid-cols-[32px_200px_1fr_auto]"
                style={{
                  background: s.provisional ? 'color-mix(in srgb, var(--provisional) 5%, transparent)' : undefined,
                  borderLeft: `3px solid ${sec.color}`,
                }}
              >
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: sec.bg, color: sec.color }}
                >
                  {s.step}
                </div>
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
                <div className="col-start-2 mono text-[14px] font-semibold num md:col-start-4 md:text-right" style={{ color: sec.color }}>
                  {n(s.value)} <span className="text-[var(--text-3)] font-normal text-[12px]">{s.unit}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

function Convergence({ result }: { result: SolveResult }) {
  const first = result.iterations[0];
  const last = result.iterations.at(-1);
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="flex items-center">
          <h3 className="text-[14px] font-semibold">How the core size settles</h3>
          <Hint label="How the core size settles">
            The calculation feeds back on itself: a wider core needs longer wire, longer wire has more resistance, and more resistance needs a wider core again. So the engine repeats the same steps until the answer stops moving.
            <br/><br/><strong>Each pass (one row of the table):</strong>
            <ol className="mt-1 list-decimal pl-5">
              <li><em>V in</em> → core area: A = V ÷ (4.44 × f × N × B)</li>
              <li>Area → core width: width = area ÷ radial build</li>
              <li>Width → wire length: mean turn length × turns</li>
              <li>Wire length → resistance <em>R</em></li>
              <li><em>V drop</em> = secondary current × R</li>
              <li><em>V out</em> = burden voltage + V drop</li>
            </ol>
            <br/><em>V out</em> becomes the next row's <em>V in</em>. <strong>Δ</strong> is how much the voltage moved since the previous pass.
            {first && <><br/><br/><strong>This design:</strong> pass 1 starts at {first.vIn.toFixed(5)} V (burden only), finds a wire drop of {first.vDrop.toFixed(5)} V, and hands {first.vNext.toFixed(5)} V to pass 2.{last && <> By pass {last.pass} the change is only {last.delta.toExponential(2)} V.</>}</>}
            <br/><br/><strong>When it stops:</strong> when Δ falls below the settling tolerance (about 0.00002 V). That is why the number of passes differs between designs: typically 5–9. High turns, thin wire or a large ratio give a stronger feedback loop and need more passes.
            <br/><br/>"Not converged" means the pass limit was reached while the answer was still moving, so the inputs need review.
          </Hint>
        </div>
        <p className="text-[12px] text-[var(--text-3)]">Repeats until two passes agree. Tap any <strong>?</strong> for the formula behind a value.</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Passes" hint={<>Number of iterations the solver needed to settle on a stable core size.<br/><br/><strong>Typical:</strong> 5–9 passes. Higher counts indicate strong feedback between wire resistance and core area — common with high turns or thin wire.</>}>{result.passes}</StatTile>
        <StatTile label="Converged" hint={<>Whether the calculation reached a stable answer.<br/><br/><strong>Yes</strong> = the difference (Δ) between two successive passes dropped below the settling tolerance.<br/><strong>No</strong> = the pass limit was reached while the answer was still shifting. Try raising the iteration limit under Reference data → Settings.</>}>
          {result.converged ? <span style={{ color: 'var(--ok)' }}>yes</span> : <span style={{ color: 'var(--warn)' }}>no</span>}
        </StatTile>
        <StatTile label="Final V" hint={<>The settled total secondary voltage after convergence.<br/><br/><strong>Formula:</strong> burden voltage + wire voltage drop.<br/><br/>This is the voltage the core cross-sectional area is sized for. A larger wire drop means the core must be bigger to compensate for the resistance loss.</>}>{result.vTotal.toFixed(5)}</StatTile>
        <StatTile label="Wire drop" hint={<>Voltage lost across the secondary winding resistance at rated current.<br/><br/><strong>Formula:</strong> secondary current × winding resistance.<br/><br/>A larger drop means the core must carry more flux to compensate, requiring a bigger cross-sectional area. Thinner wire or more turns increases this value.</>}>{result.vDrop.toFixed(5)} V</StatTile>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] mono">
          <thead>
            <tr className="border-b border-[var(--line-strong)]">
              {([
                ['Pass', <>Iteration number — each pass refines the core size by recalculating area, width, wire and resistance.</>],
                ['V in', <>Voltage fed into this pass.<br/><br/><strong>Pass 1</strong> starts with the burden voltage alone. Later passes include the wire voltage drop from the previous pass.</>],
                ['Area cm²', <>Core cross-sectional area calculated from V in.<br/><br/><strong>Formula:</strong> A = V / (4.44 × f × N × B).</>],
                ['Width mm', <>Core strip width derived from the area.<br/><br/><strong>Formula:</strong> width = area ÷ radial build.</>],
                ['Wire m', <>Total secondary wire length for this core size.<br/><br/><strong>Formula:</strong> mean turn length × number of turns.</>],
                ['R Ω', <>Winding DC resistance at 20 °C.<br/><br/><strong>Formula:</strong> resistivity × wire length ÷ wire cross-section.</>],
                ['V drop', <>Voltage drop across the winding.<br/><br/><strong>Formula:</strong> secondary current × resistance.</>],
                ['V out', <>New total voltage that feeds into the next pass.<br/><br/><strong>Formula:</strong> burden voltage + V drop.<br/><br/>This becomes "V in" for the next row.</>],
                ['Δ', <>Delta — how much V changed from the previous pass.<br/><br/>When Δ falls below the settling tolerance (typically 0.00002 V), the calculation has <strong>converged</strong> and stops.</>],
              ] as [string, ReactNode][]).map(([h, tip]) => (
                <th key={h as string} className="label px-2 py-2 text-right font-semibold">{h}<Hint label={h as string}>{tip}</Hint></th>
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
export function WarningStrip({ warnings, collapsible = false }: { warnings: { code: string; message: string; ref?: string }[]; collapsible?: boolean }) {
  const seen = new Set<string>();
  const unique = warnings.filter((w) => {
    const k = `${w.code}:${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) return null;

  const messages = (
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
  if (!collapsible) return messages;
  return (
    <details className="calculation-guidance">
      <summary>
        <span className="guidance-summary-copy"><strong>Calculation guidance <span className="guidance-count">{unique.length}</span></strong><span>Assumptions, setup requirements and estimate notes</span></span>
        <span className="guidance-summary-action"><span className="guidance-expand">Show details</span><span className="guidance-collapse">Hide details</span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></span>
      </summary>
      <div className="guidance-messages">{messages}</div>
    </details>
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
