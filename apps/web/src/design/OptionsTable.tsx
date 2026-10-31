import { Progress, Tooltip } from 'flowbite-react';
import { motion, useReducedMotion } from 'motion/react';
import type { RankedOption } from '@meltek/engine';
import { Badge, ProvisionalMark } from '../shared/primitives';
import { costTone } from '../shared/flowbite-theme';
import { duration, ease } from '../shared/motion';

const n = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
const money = (v: number | null) => (v === null ? '—' : `₹${v.toFixed(2)}`);

export interface OptionRow extends RankedOption {
  id?: string;
  isSelected?: boolean;
}

/**
 * The ranked options table (§11.2) — one row per grade × gauge, cheapest first.
 * Infeasible rows stay visible, greyed, with their reason: hiding them makes the tool
 * feel arbitrary (§5.10). Rows glide on reorder via layout animation (§10.2).
 */
export function OptionsTable({
  options, selectedKey, onSelect, showAll, onToggleShowAll, hideWire, referenceFormat = false,
}: {
  options: OptionRow[];
  selectedKey: string | null;
  onSelect: (o: OptionRow) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
  hideWire?: boolean;
  referenceFormat?: boolean;
}) {
  const reduce = useReducedMotion();
  const feasible = options.filter((o) => o.isFeasible);
  const infeasible = options.filter((o) => !o.isFeasible);
  const shown = showAll ? [...feasible, ...infeasible] : feasible.slice(0, 12);

  // The cheapest costable option is the yardstick every other row is measured against.
  const costs = feasible.map((o) => o.totalCost).filter((c): c is number => c !== null);
  const bestCost = costs.length ? Math.min(...costs) : null;
  const worstShown = costs.length ? Math.max(...costs) : null;

  const keyOf = (o: OptionRow) => `${o.gradeCode}:${o.swg}`;

  return (
    <div>
      <div className="options-mobile-cards">
        {shown.map(o => <button type="button" key={keyOf(o)} className="option-mobile-card" aria-pressed={selectedKey === keyOf(o)} onClick={() => onSelect(o)}>
          <span className="option-mobile-heading"><span><span className="option-mobile-rank num">{o.rank ?? '—'}</span>{o.gradeLabel}</span><span className="num">{money(o.totalCost)}</span></span>
          {!hideWire && <span className="option-mobile-wire">{o.wireCombinationLabel || `SWG ${o.swg}`}<span>{selectedKey === keyOf(o) ? 'Selected' : 'View design'}</span></span>}
          <span className="option-mobile-metrics"><span>Core width<strong className="num">{n(o.coreWidthMm)} mm</strong></span><span>Ordered<strong className="num">{n(o.orderedWidthMm, 0)} mm</strong></span><span>Flux<strong className="num">{n(o.bUsedT, 4)} T</strong></span></span>
          {!o.isFeasible && <span className="option-mobile-reason">{o.infeasibleReasons[0]}</span>}
        </button>)}
      </div>
      <div className="options-desktop-table overflow-x-auto">
        <table className="data-table w-full text-[13px]">
          <thead>
            <tr className="text-left">
              {(referenceFormat ? [{h:'',w:28}, {h:'Rank'}, {h:'Grade'}, ...(hideWire ? [] : [{h:'Wire'}]), {h:'B (T)'}, {h:'Calculated width'}, {h:'Rounded width'}, {h:'Steel kg'}, {h:'Cu kg'}, {h:'Cost'}, {h:'Status'}] : [{h:'#'}, {h:'Grade'}, ...(hideWire ? [] : [{h:'Wire'}]), {h:'B used'}, {h:'Core width'}, {h:'Ordered'}, {h:'Die'}, {h:'Core kg'}, {h:'Copper kg'}, {h:'Total cost'}, {h:'vs best'}]).map(({h,w}, i) => (
                <th
                  key={h || `dot-${i}`}
                  className={`label whitespace-nowrap ${!['', '#', 'Rank', 'Grade', 'vs best', 'Status'].includes(h) ? 'text-right' : ''}`}
                  style={w ? {width: w, paddingLeft: 16, paddingRight: 0} : undefined}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => {
              const key = keyOf(o);
              const active = selectedKey === key;
              return (
                <motion.tr
                  key={key}
                  layout={!reduce}
                  transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.out }}
                  onClick={() => onSelect(o)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(o); } }}
                  role="button"
                  aria-pressed={active}
                  className="cursor-pointer border-b border-[var(--line)]"
                  style={{ opacity: o.isFeasible ? 1 : 0.45 }}
                >
                  {referenceFormat && <td style={{width: 28, paddingLeft: 16, paddingRight: 0}}><span className={`option-selection-dot ${active ? 'is-selected' : ''}`} aria-hidden="true" /></td>}
                  <td className="whitespace-nowrap num text-[var(--text-3)]">
                    {o.rank ?? '—'}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="font-medium">{o.gradeLabel}</span>
                    {o.isSelected && <span className="ml-2"><Badge tone="ok">selected</Badge></span>}
                    {!o.isFeasible && <span className="mt-1 block max-w-64 whitespace-normal text-[12px] text-[var(--text-3)]">{o.infeasibleReasons[0]}</span>}
                  </td>
                  {!hideWire && <td className="text-right num">{o.wireCombinationLabel || o.swg}</td>}
                  <td className="whitespace-nowrap text-right num">
                    {n(o.bUsedT, 4)}
                    {o.wasCapped && (
                      <span className="ml-2 inline-block">
                        <Tooltip
                          content={`The ${o.gradeLabel} curve reaches ${n(o.bRawT, 4)} T here. The flux ceiling sizes the core at ${n(o.bUsedT, 2)} T instead, which is why this core is wider than the curve alone suggests.`}
                        >
                          <Badge tone="warn">capped</Badge>
                        </Tooltip>
                      </span>
                    )}
                  </td>
                  <td className="text-right num">{n(o.coreWidthMm)} mm</td>
                  <td className="text-right num" style={referenceFormat ? undefined : { color: 'var(--provisional)' }}>{n(o.orderedWidthMm, 0)} mm</td>
                  {!referenceFormat && <td className="text-right num text-[var(--text-3)]">{o.dieNo ?? '—'}</td>}
                  <td className="text-right num">{n(o.coreWeightKg, 3)}</td>
                  <td className="text-right num">{n(o.copperWeightKg, 3)}</td>
                  <td className="text-right num font-semibold">
                    {money(o.totalCost)}
                  </td>
                  {referenceFormat ? <td><span className={o.isFeasible ? 'option-feasible' : 'option-rejected'}>{o.isFeasible ? 'Feasible' : 'Rejected'}</span></td> : <>
                  <td>
                    {o.isFeasible && o.totalCost !== null && bestCost !== null && bestCost > 0 ? (
                      <Tooltip
                        content={o.totalCost === bestCost
                          ? 'The cheapest feasible combination.'
                          : `${(((o.totalCost - bestCost) / bestCost) * 100).toFixed(1)}% more material cost than the leader.`}
                      >
                        <div className="flex w-[110px] items-center gap-2">
                          <Progress
                            className="flex-1"
                            size="sm"
                            color={costTone(o.totalCost / bestCost)}
                            progress={worstShown && worstShown > bestCost
                              ? Math.max(6, ((worstShown - o.totalCost) / (worstShown - bestCost)) * 100)
                              : 100}
                          />
                          <span className="num w-9 text-right text-[11px] text-[var(--text-3)]">
                            {o.totalCost === bestCost ? 'best' : `+${(((o.totalCost - bestCost) / bestCost) * 100).toFixed(0)}%`}
                          </span>
                        </div>
                      </Tooltip>
                    ) : (
                      <span className="text-[11px] text-[var(--text-3)]">—</span>
                    )}
                  </td>
                  </>}
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-3 py-3 text-[12px] text-[var(--text-3)]">
        <span>
          {feasible.length} workable of {options.length} grades · costs are an{' '}
          <ProvisionalMark />
        </span>
        <button type="button" onClick={onToggleShowAll} className="text-[var(--text-2)] underline underline-offset-4">
          {showAll ? 'Show the leading options only' : `Show all ${options.length}, including ${infeasible.length} that cannot be made`}
        </button>
      </div>
    </div>
  );
}
