import { Progress, Tooltip } from 'flowbite-react';
import { motion, useReducedMotion } from 'motion/react';
import type { RankedOption } from '@meltek/engine';
import { Badge, ProvisionalMark } from '../components/primitives';
import { costTone } from '../lib/flowbite-theme';
import { duration, ease } from '../lib/motion';

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
  options, selectedKey, onSelect, showAll, onToggleShowAll,
}: {
  options: OptionRow[];
  selectedKey: string | null;
  onSelect: (o: OptionRow) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
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
      <div className="overflow-x-auto">
        <table className="data-table w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--line-strong)] text-left">
              {['#', 'Grade', 'SWG', 'B used', 'Core width', 'Ordered', 'Die', 'Core kg', 'Copper kg', 'Total cost', 'vs best', 'Stock'].map((h, i) => (
                <th
                  key={h}
                  className={`label whitespace-nowrap px-3 py-2 font-semibold ${i >= 2 && i <= 9 ? 'text-right' : ''}`}
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
                  className="cursor-pointer border-b border-[var(--line)] transition-colors"
                  style={{
                    background: active ? 'var(--surface-3)' : undefined,
                    opacity: o.isFeasible ? 1 : 0.45,
                  }}
                  whileHover={reduce ? {} : { y: -2, backgroundColor: 'var(--surface-2)' }}
                >
                  <td className="whitespace-nowrap px-3 py-2.5 num text-[var(--text-3)]">
                    {o.rank ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className="font-medium">{o.gradeLabel}</span>
                    {o.isSelected && <span className="ml-2"><Badge tone="ok">selected</Badge></span>}
                  </td>
                  <td className="px-3 py-2.5 text-right num">{o.swg}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right num">
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
                  <td className="px-3 py-2.5 text-right num">{n(o.coreWidthMm)} mm</td>
                  <td className="px-3 py-2.5 text-right num" style={{ color: 'var(--provisional)' }}>
                    {n(o.orderedWidthMm, 0)} mm
                  </td>
                  <td className="px-3 py-2.5 text-right num text-[var(--text-3)]">{o.dieNo ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right num" style={{ color: 'var(--provisional)' }}>{n(o.coreWeightKg, 3)}</td>
                  <td className="px-3 py-2.5 text-right num" style={{ color: 'var(--provisional)' }}>{n(o.copperWeightKg, 3)}</td>
                  <td className="px-3 py-2.5 text-right num font-semibold" style={{ color: o.totalCost === null ? 'var(--text-3)' : 'var(--provisional)' }}>
                    {money(o.totalCost)}
                  </td>
                  <td className="px-3 py-2.5">
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
                  <td className="px-3 py-2.5">
                    {o.isFeasible
                      ? <Badge tone="ok">in stock</Badge>
                      : <span className="text-[11px] text-[var(--text-3)]">{o.infeasibleReasons[0]}</span>}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-3 py-3 text-[12px] text-[var(--text-3)]">
        <span>
          {feasible.length} workable of {options.length} combinations · costs are an{' '}
          <ProvisionalMark />
        </span>
        <button type="button" onClick={onToggleShowAll} className="text-[var(--text-2)] underline underline-offset-4">
          {showAll ? 'Show the leading options only' : `Show all ${options.length}, including ${infeasible.length} that cannot be made`}
        </button>
      </div>
    </div>
  );
}
