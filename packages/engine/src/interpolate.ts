import { EngineError, type BhPoint, type EngineWarning } from './types.js';

export interface InterpolationPoint {
  hAtCm: number;
  teslaT: number;
}

export interface InterpolationResult {
  bRawT: number;
  /** The two bracketing rows actually used, for the B–H chart marker (§11.2). */
  lower: InterpolationPoint | null;
  upper: InterpolationPoint | null;
  fraction: number;
  warnings: EngineWarning[];
  /** Curve rows that carry a value, ascending by H — what the chart plots. */
  usable: InterpolationPoint[];
}

/**
 * Linear interpolation of magnetising force H from flux density B (reverse of interpolateB).
 * Exact measured points are usable on their own. Interpolation requires two
 * bracketing points; values outside the characterised range are never clamped.
 */
export function interpolateH(curve: readonly BhPoint[], bTarget: number): number | null {
  const pts = curve
    .filter((p): p is BhPoint & { hAtCm: number } => p.hAtCm !== null && Number.isFinite(p.hAtCm))
    .sort((a, b) => a.teslaT - b.teslaT);
  if (!Number.isFinite(bTarget) || pts.length === 0) return null;
  const exact = pts.find(p => p.teslaT === bTarget);
  if (exact) return exact.hAtCm;
  if (pts.length < 2) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (bTarget < first.teslaT || bTarget > last.teslaT) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const lo = pts[i]!;
    const hi = pts[i + 1]!;
    if (bTarget >= lo.teslaT && bTarget <= hi.teslaT) {
      const f = (hi.teslaT - lo.teslaT) === 0 ? 0 : (bTarget - lo.teslaT) / (hi.teslaT - lo.teslaT);
      return lo.hAtCm + f * (hi.hAtCm - lo.hAtCm);
    }
  }
  return null;
}

/**
 * Curve rows with a characterised H, ascending by H.
 * A `null` entry means the grade is not characterised at that flux density — it is
 * skipped, never treated as zero (§6.1).
 */
export function usablePoints(curve: readonly BhPoint[]): InterpolationPoint[] {
  return curve
    .filter((p): p is BhPoint & { hAtCm: number } => p.hAtCm !== null && Number.isFinite(p.hAtCm))
    .map((p) => ({ hAtCm: p.hAtCm, teslaT: p.teslaT }))
    .sort((a, b) => a.hAtCm - b.hAtCm);
}

/**
 * Linear interpolation of flux density B from magnetising force H (§5.6).
 *
 * H is the lookup key; the curve's `h` column is the x axis and tesla the y axis.
 * H is NOT truncated before lookup — the spreadsheet does TRUNC(H,3) and for low-loss
 * designs H can be around 0.004, where truncation loses a fifth of the value (§5.5).
 *
 * Out of range: the value is clamped AND a warning is returned. Never clamp silently.
 */
export function interpolateB(curve: readonly BhPoint[], h: number): InterpolationResult {
  const pts = usablePoints(curve);
  if (pts.length === 0) {
    throw new EngineError('CURVE_EMPTY', 'This grade has no B-H curve on record. Add its curve under Reference data before using it.');
  }

  const warnings: EngineWarning[] = [];
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;

  if (pts.length === 1) {
    return { bRawT: first.teslaT, lower: first, upper: first, fraction: 0, warnings, usable: pts };
  }

  if (h < first.hAtCm) {
    warnings.push({
      code: 'H_BELOW_CURVE',
      message: `This design works at H = ${h.toPrecision(6)} AT/cm, below the range this grade is characterised over (from ${first.hAtCm} AT/cm). Flux density has been held at ${first.teslaT} T, so treat the result as indicative.`,
      ref: 'Core sizing',
    });
    return { bRawT: first.teslaT, lower: first, upper: null, fraction: 0, warnings, usable: pts };
  }

  if (h > last.hAtCm) {
    warnings.push({
      code: 'H_ABOVE_CURVE',
      message: `This design works at H = ${h.toPrecision(6)} AT/cm, above the range this grade is characterised over (to ${last.hAtCm} AT/cm). Flux density has been held at ${last.teslaT} T, so treat the result as indicative.`,
      ref: 'Core sizing',
    });
    return { bRawT: last.teslaT, lower: null, upper: last, fraction: 1, warnings, usable: pts };
  }

  let i = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    if (h >= pts[k]!.hAtCm && h <= pts[k + 1]!.hAtCm) { i = k; break; }
    i = k;
  }
  const lower = pts[i]!;
  const upper = pts[i + 1]!;
  const span = upper.hAtCm - lower.hAtCm;
  const fraction = span === 0 ? 0 : (h - lower.hAtCm) / span;
  const bRawT = lower.teslaT + fraction * (upper.teslaT - lower.teslaT);

  return { bRawT, lower, upper, fraction, warnings, usable: pts };
}
