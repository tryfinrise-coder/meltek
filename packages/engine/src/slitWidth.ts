import { EngineError, type ProcessSettings, type ReferenceData } from './types.js';

/** Tolerance-based step rounding, with original nearest rounding for historical settings. */
export function roundToSlitWidth(widthMm: number, ref: ReferenceData, settings: ProcessSettings): number {
  const stocked = [...ref.slitWidthsMm].filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
  const tolerance = settings.coreWidthRoundingTolerancePercent;
  if (tolerance !== undefined) {
    if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) throw new EngineError('INVALID_INPUT', 'Core width must be positive and rounding tolerance must be between 0% and 100%.');
    const step = settings.slitStepMm;
    if (!Number.isFinite(step) || step <= 0) throw new EngineError('INVALID_INPUT', 'Slit rounding step must be positive.');
    const epsilon = 16 * Number.EPSILON * Math.max(1, widthMm, step);
    const lower = Math.floor((widthMm + epsilon) / step) * step;
    const rounded = lower > 0 && widthMm - lower <= lower * tolerance / 100 + epsilon ? lower : lower + step;
    // Respect available stock without silently choosing a non-step slit width.
    const available = stocked.filter(w => Math.abs(w / step - Math.round(w / step)) <= 1e-8 && w + epsilon >= rounded);
    return available[0] ?? rounded;
  }
  // Historical snapshots keep their original nearest-stock/nearest-step behaviour.
  if (stocked.length > 0) {
    // Find the stocked width closest to the converged width.
    let best = stocked[0]!;
    let bestDist = Math.abs(widthMm - best);
    for (const w of stocked) {
      const d = Math.abs(widthMm - w);
      if (d < bestDist) { best = w; bestDist = d; }
    }
    return best;
  }
  // Fallback: round to nearest step.
  const step = settings.slitStepMm > 0 ? settings.slitStepMm : 5;
  return Math.round(widthMm / step) * step;
}

