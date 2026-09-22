import type { AdminTab } from '../lib/adminTabs';
import { useMemo } from 'react';
import type { ReferenceResponse } from '../lib/api';

export interface Notification {
  id: string;
  tone: 'warn' | 'info' | 'provisional';
  title: string;
  detail: string;
  /** Where in the app the operator fixes it. */
  to: string;
  tab: AdminTab;
  ref: string;
}

/**
 * The notification feed.
 *
 * Every entry is a real gap in the reference data that changes what the calculator can
 * tell you. Nothing here is decorative: each one names what is missing, what it costs
 * the calculation, and where to fix it.
 */
export function useNotifications(ref: ReferenceResponse | undefined): Notification[] {
  return useMemo(() => {
    if (!ref) return [];
    const out: Notification[] = [];

    if (ref.dies.length === 0) {
      out.push({
        id: 'dies',
        tone: 'warn',
        title: 'No dies on record',
        detail: 'Options are not checked against your tooling, so one may be ranked first that no mould can take.',
        to: '/admin',
        tab: 'dies',
        ref: 'Tooling',
      });
    }

    if (ref.slitWidthsMm.length === 0) {
      out.push({
        id: 'slits',
        tone: 'warn',
        title: 'No slit widths on record',
        detail: 'Core widths round up to the nearest 5 mm instead of to a width you actually buy.',
        to: '/admin',
        tab: 'dies',
        ref: 'Stock',
      });
    }

    const noRate = ref.grades.filter(
      (g) => g.ratePerKg === null && g.curve.some((p) => p.hAtCm !== null),
    );
    for (const g of noRate) {
      out.push({
        id: `rate-${g.code}`,
        tone: 'warn',
        title: `No rate for ${g.label}`,
        detail: 'This grade is calculated but cannot be costed, so it never appears in the ranking.',
        to: '/admin',
        tab: 'rates',
        ref: 'Rates',
      });
    }

    const noCurve = ref.grades.filter((g) => !g.curve.some((p) => p.hAtCm !== null));
    if (noCurve.length > 0) {
      out.push({
        id: 'curves',
        tone: 'info',
        title: `${noCurve.length} grades have no B–H curve`,
        detail: `${noCurve.map((g) => g.label).join(', ')} cannot be calculated until their curves are entered.`,
        to: '/admin',
        tab: 'grades',
        ref: 'Grades',
      });
    }

    const unconfirmed = ref.settingRows.filter((s) => !s.isConfirmed);
    if (unconfirmed.length > 0) {
      out.push({
        id: 'settings',
        tone: 'warn',
        title: `${unconfirmed.length} settings still on defaults`,
        detail: `${unconfirmed.map((s) => s.label).join(', ')} have not been set for your works yet.`,
        to: '/admin',
        tab: 'settings',
        ref: 'Settings',
      });
    }

    if (ref.gauges.some((g) => g.ohmPerM75c === null)) {
      out.push({
        id: 'ohm75',
        tone: 'info',
        title: 'No resistance at 75 °C',
        detail: 'Standards reference the hot value. Resistance is calculated at 20 °C until it is entered.',
        to: '/admin',
        tab: 'gauges',
        ref: 'Wire',
      });
    }

    return out;
  }, [ref]);
}
