import { solve } from './solve.js';
import { validateDesign } from './validate.js';
import {
  EngineError,
  type DesignInputs,
  type Die,
  type EngineWarning,
  type OptimiseResult,
  type ProcessSettings,
  type RankedOption,
  type ReferenceData,
  type SolveResult,
} from './types.js';

/**
 * Exhaustive search across grade x gauge (§5.10).
 *
 * Roughly 7 grades x 12 gauges = 84 combinations, each converging in under 10
 * iterations. This runs in single-digit milliseconds. Exhaustive search is correct
 * here - there is no optimiser and no model, and there should not be.
 */
export function optimise(
  inputs: DesignInputs,
  ref: ReferenceData,
  settings: ProcessSettings,
): OptimiseResult {
  const started = Date.now();
  validateDesign(inputs, settings);
  const options: RankedOption[] = [];
  const warnings: EngineWarning[] = [];

  for (const grade of ref.grades) {
    for (const gauge of ref.gauges) {
      let result: SolveResult;
      try {
        result = solve(inputs, ref, settings, grade.code, gauge.swg, { withSteps: false });
      } catch (err) {
        // A combination that cannot be solved at all is still shown, with its reason.
        // Hiding options makes the tool feel arbitrary (§5.10).
        const reason =
          err instanceof EngineError ? err.message : 'This combination could not be calculated.';
        options.push(infeasibleStub(inputs, grade.code, grade.label, gauge.swg, reason));
        continue;
      }

      const reasons: string[] = [...(result.engineering?.issues ?? [])];

      if (!grade.isAvailable) reasons.push('Not in stock');
      if (!gauge.isAvailable) reasons.push(`SWG ${gauge.swg} not in stock`);
      if (grade.ratePerKg === null) reasons.push(`No rate on record for ${grade.label}`);
      if (!result.converged) reasons.push('Core size did not settle within the iteration limit');
      if (ref.slitWidthsMm.length && !ref.slitWidthsMm.includes(result.orderedWidthMm)) reasons.push('No stocked slit width is wide enough for this core');
      if (result.totalCost !== null && !Number.isFinite(result.totalCost)) reasons.push('Material cost is not finite');

      const die = pickDie(ref.dies, result.geometry.coreOdMm, result.orderedWidthMm);
      if (ref.dies.length > 0 && !die) {
        const widest = Math.max(...ref.dies.map((d) => d.maxWidthMm));
        reasons.push(
          result.orderedWidthMm > widest
            ? `No die accommodates a ${result.orderedWidthMm.toFixed(0)} mm core`
            : `No die fits a ${result.geometry.coreOdMm.toFixed(1)} mm core OD`,
        );
      }

      if (inputs.maxWidthMm != null && (result.engineering?.finishedWidthMm ?? result.orderedWidthMm) > inputs.maxWidthMm) {
        reasons.push(`${result.engineering ? 'Finished' : 'Ordered'} width ${(result.engineering?.finishedWidthMm ?? result.orderedWidthMm).toFixed(1)} mm exceeds the ${inputs.maxWidthMm} mm limit for this part`);
      }

      const hOutOfRange = result.warnings.some(
        (w) => w.code === 'H_BELOW_CURVE' || w.code === 'H_ABOVE_CURVE',
      );
      if (hOutOfRange) reasons.push('Outside the characterised range for this grade');

      options.push({
        ...result,
        gradeLabel: grade.label,
        dieId: die?.id ?? null,
        dieNo: die?.dieNo ?? null,
        isFeasible: reasons.length === 0,
        infeasibleReasons: reasons,
        rank: null,
      });
    }
  }

  // Rank by total material cost ascending. Infeasible options and uncostable ones are
  // returned too, unranked, to be shown greyed with their reason.
  const ranked = options
    .filter((o) => o.isFeasible && o.totalCost !== null)
    .sort((a, b) => (a.totalCost as number) - (b.totalCost as number) || a.orderedWidthMm - b.orderedWidthMm || a.gradeCode.localeCompare(b.gradeCode) || a.swg - b.swg);
  ranked.forEach((o, i) => { o.rank = i + 1; });

  if (ranked.length === 0) {
    warnings.push({
      code: 'UNCONFIRMED_SETTINGS',
      message: 'No combination of grade and gauge can be made and costed for this specification. Each row below gives its reason.',
      ref: 'Options',
    });
  }
  if (ref.dies.length === 0) {
    warnings.push({
      code: 'UNCONFIRMED_SETTINGS',
      message: 'No dies on record, so the options below are not checked against your tooling. Add your dies under Reference data.',
      ref: 'Tooling',
    });
  }
  if (ref.slitWidthsMm.length === 0) {
    warnings.push({
      code: 'UNCONFIRMED_SETTINGS',
      message: `Your stocked slit widths are not on record, so core widths are rounded up to the nearest ${settings.slitStepMm} mm rather than to a width you actually buy.`,
      ref: 'Stock',
    });
  }

  const capped = ranked.filter((o) => o.wasCapped).length;
  if (capped > 0) {
    warnings.push({
      code: 'FLUX_CEILING_APPLIED',
      message: `The flux ceiling applies to ${capped} of ${ranked.length} workable options. A grade at the ceiling needs a wider core than its curve alone suggests, which is often why a more expensive grade loses on cost.`,
      ref: 'Core sizing',
    });
  }

  const sortedForDisplay = [...options].sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    if (a.gradeCode !== b.gradeCode) return a.gradeCode.localeCompare(b.gradeCode);
    return a.swg - b.swg;
  });

  return { options: sortedForDisplay, warnings, computedAtMs: Date.now() - started };
}

/** Smallest die that takes this core OD and width. */
export function pickDie(dies: readonly Die[], coreOdMm: number, widthMm: number): Die | null {
  const fits = dies
    .filter((d) => d.isAvailable && coreOdMm >= d.minOdMm && coreOdMm <= d.maxOdMm && widthMm <= d.maxWidthMm)
    .sort((a, b) => a.maxWidthMm - b.maxWidthMm || a.maxOdMm - b.maxOdMm);
  return fits[0] ?? null;
}

function infeasibleStub(
  inputs: DesignInputs,
  gradeCode: string,
  gradeLabel: string,
  swg: number,
  reason: string,
): RankedOption {
  const zeroGeom = {
    turns: inputs.secondaryCurrent > 0 ? inputs.primaryCurrent / inputs.secondaryCurrent : 0,
    allowanceMm: 0, coreIdMm: 0, coreOdMm: 0, radialBuildMm: 0, radialBuildCm: 0, mmlCm: 0,
  };
  return {
    inputs, gradeCode, swg, geometry: zeroGeom,
    burdenVoltage: 0, classPercent: 0, atLoss: 0, h: 0,
    bRawT: 0, bUsedT: 0, wasCapped: false,
    coreAreaCm2: 0, coreWidthMm: 0, wireLengthM: 0, resistanceOhm: 0, vDrop: 0, vTotal: 0,
    converged: false, passes: 0, iterations: [],
    orderedWidthMm: 0, finalAreaCm2: 0, coreVolumeCm3: 0,
    coreWeightKg: 0, copperWeightKg: 0,
    coreCost: null, copperCost: 0, totalCost: null,
    provisional: true, steps: [], warnings: [],
    gradeLabel, dieId: null, dieNo: null,
    isFeasible: false, infeasibleReasons: [reason], rank: null,
  };
}
