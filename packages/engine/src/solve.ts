import { interpolateB, type InterpolationResult } from './interpolate.js';
import { solveEngineering } from './engineering.js';
import { computeWindingAllowance, type WindingResult } from './winding.js';
import { positive, validateDesign } from './validate.js';
import {
  EngineError,
  type CalcStep,
  type DesignInputs,
  type EngineWarning,
  type Geometry,
  type Iteration,
  type ProcessSettings,
  type ReferenceData,
  type SolveResult,
  type SteelGrade,
  type WireGauge,
  type WireCombinationEntry,
} from './types.js';

const f = (n: number, dp = 4): string => (Number.isFinite(n) ? n.toFixed(dp) : String(n));

export function findGrade(ref: ReferenceData, code: string): SteelGrade {
  const g = ref.grades.find((x) => x.code === code);
  if (!g) throw new EngineError('UNKNOWN_GRADE', `No steel grade "${code}" in the reference data.`, { code });
  return g;
}

export function findGauge(ref: ReferenceData, swg: number): WireGauge {
  const w = ref.gauges.find((x) => x.swg === swg);
  if (!w) throw new EngineError('UNKNOWN_GAUGE', `No SWG ${swg} in the wire gauge table.`, { swg });
  return w;
}

export function findClass(ref: ReferenceData, code: string) {
  const c = ref.classes.find((x) => x.code === code);
  if (!c) throw new EngineError('UNKNOWN_CLASS', `No accuracy class "${code}" in the reference data.`, { code });
  return c;
}

/**
 * Build a virtual WireGauge from a wire combination (multiple SWG wires in parallel).
 * Resistance is parallel (1/Σ(count/R)), weight and area are summed.
 */
export function virtualGaugeFromCombination(
  entries: WireCombinationEntry[],
  ref: ReferenceData,
): { gauge: WireGauge; label: string } {
  const active = entries.filter(e => e.count > 0);
  if (active.length === 0) throw new EngineError('INVALID_INPUT', 'Wire combination has no wires selected.');
  const primarySwg = active[0]!.swg;

  let conductance = 0;
  let gramPerM = 0;
  let areaSqmm = 0;
  let maxDiaMm = 0;
  const parts: string[] = [];

  for (const e of active) {
    const g = findGauge(ref, e.swg);
    positive(g.ohmPerM20c, `SWG ${e.swg} resistance`);
    positive(g.gramPerM, `SWG ${e.swg} mass`);
    conductance += e.count / g.ohmPerM20c;
    gramPerM += e.count * g.gramPerM;
    areaSqmm += e.count * g.areaSqmm;
    maxDiaMm = Math.max(maxDiaMm, g.diaMm);
    parts.push(`${e.count}×${e.swg}`);
  }

  return {
    gauge: {
      swg: primarySwg,
      diaMm: maxDiaMm,
      areaSqmm,
      ohmPerM20c: 1 / conductance,
      ohmPerM75c: null,
      gramPerM,
      isAvailable: true,
    },
    label: parts.join(' + '),
  };
}

/** Format a wire combination label for display. */
export function wireCombinationLabel(entries: WireCombinationEntry[]): string {
  return entries.filter(e => e.count > 0).map(e => `${e.count}×${e.swg}`).join(' + ');
}

/** Resin cover depends on the number of secondary turns (from the PDF spec, page 14). */
export function resinCoverForTurns(turns: number, defaultMm: number): number {
  if (turns <= 100) return 4;
  if (turns <= 200) return 6;
  return Math.max(defaultMm, 6);
}

/**
 * Compute the winding build for a given SWG using the wire geometry.
 * Returns null when the new settings have not been confirmed yet (all zeros/defaults)
 * and the caller should fall back to the fixed windingAllowanceMm.
 */
export function computeWindingBuild(
  turns: number,
  gauge: WireGauge,
  finishedIdMm: number,
  settings: ProcessSettings,
): WindingResult | null {
  if (settings.wireInsulationMm <= 0 || settings.windingPackingFactor <= 0 || settings.windingPackingFactor > 1) return null;
  const insulatedDiaMm = gauge.diaMm + 2 * settings.wireInsulationMm;
  try {
    return computeWindingAllowance(
      { turns: Math.round(turns), swg: gauge.swg, wireDiaMm: insulatedDiaMm, parallelStrands: 1, boreIdMm: finishedIdMm },
      { layerStackingFactorBySwg: { [gauge.swg]: settings.windingPackingFactor }, interlayerThicknessMm: settings.interLayerTapeMm, minEpoxyThicknessMm: 0 },
    );
  } catch {
    return null;
  }
}

/**
 * Steps 1-2 - turns and core geometry (§5.2).
 *
 * The allowance is the total for BOTH sides and is therefore added ONCE to the
 * diameter, not once per side. A 12 mm allowance leaves 6 mm of radial space each
 * side. Confirmed by the client - do not change this.
 */
export function computeGeometry(inputs: DesignInputs, settings: ProcessSettings, overrideAllowanceMm?: number): Geometry {
  validateDesign(inputs, settings);
  if (!(inputs.primaryCurrent > 0)) {
    throw new EngineError('INVALID_INPUT', 'Primary current must be greater than zero.');
  }
  if (!(inputs.secondaryCurrent > 0)) {
    throw new EngineError('INVALID_INPUT', 'Secondary current must be greater than zero.');
  }

  let turns = inputs.primaryCurrent / inputs.secondaryCurrent;

  // §12.4 - "+5 above 400 A". The client's instruction "please do not consider this"
  // is ambiguous between "leave it alone" and "drop it", and the position at which the
  // +5 is applied was never stated. Interpreted here as five extra secondary turns.
  // Default OFF: the 0.65 T ceiling already serves this purpose and stacking both would
  // quietly oversize every core above 400 A.
  // TODO(client §12.4): confirm whether this margin exists and where it applies.
  if (settings.plusFiveAbove400A && inputs.primaryCurrent > 400) turns += 5;

  const resinCover = resinCoverForTurns(turns, settings.resinCoverMm);
  const allowanceMm = overrideAllowanceMm ?? (resinCover + settings.windingAllowanceMm);
  const coreIdMm = inputs.finishedIdMm + allowanceMm;
  const coreOdMm = inputs.finishedOdMm - allowanceMm;

  if (coreOdMm <= coreIdMm) {
    throw new EngineError(
      'GEOMETRY_IMPOSSIBLE',
      `Core OD ${f(coreOdMm, 1)} mm is smaller than core ID ${f(coreIdMm, 1)} mm. Reduce the allowance or increase the finished OD.`,
      { coreIdMm, coreOdMm, allowanceMm },
    );
  }

  const radialBuildMm = (coreOdMm - coreIdMm) / 2;

  return {
    turns,
    allowanceMm,
    coreIdMm,
    coreOdMm,
    radialBuildMm,
    radialBuildCm: radialBuildMm / 10,
    // §5.5 - Math.PI, not the spreadsheet's transposed 3.1426.
    mmlCm: (Math.PI * ((coreIdMm + coreOdMm) / 2)) / 10,
  };
}

/** The transformer constant, 4.44 x f x 1e-4. At 50 Hz this is 0.0222 (§5.7). */
export function transformerConstant(frequencyHz: number): number {
  return 4.44 * frequencyHz * 1e-4;
}

/** §5.9 - smallest stocked slit width at or above the converged width. */
export function roundToSlitWidth(widthMm: number, ref: ReferenceData, settings: ProcessSettings): number {
  const stocked = [...ref.slitWidthsMm].filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
  const fit = stocked.find((w) => w >= widthMm);
  if (fit !== undefined) return fit;
  // Fallback (§12.7): ceiling to the nearest step, IN MILLIMETRES. The spreadsheet's
  // CEILING(width,5) operates on centimetres and rounds 2.87 cm up to 5 cm.
  const step = settings.slitStepMm > 0 ? settings.slitStepMm : 5;
  return Math.ceil(widthMm / step) * step;
}

export interface SolveOptions {
  /** Attach the full substituted chain. On by default. */
  withSteps?: boolean;
}

/**
 * The calculation engine (§5). Pure: no I/O, no implicit reference data.
 */
export function solve(
  inputs: DesignInputs,
  ref: ReferenceData,
  settings: ProcessSettings,
  gradeCode: string,
  swg: number,
  options: SolveOptions = {},
): SolveResult {
  if (inputs.engineering) return solveEngineering(inputs, ref, settings, gradeCode, swg);
  if (inputs.ctType !== 'ring') {
    throw new EngineError('UNSUPPORTED_CT_TYPE', 'Only ring type CTs can be calculated at present. Wound primary is not yet supported.');
  }

  if (['5P','10P','PS','PX'].includes(inputs.accuracyClass)) throw new EngineError('INVALID_INPUT', 'Protection and PS classes require engineering mode.');
  const grade = findGrade(ref, gradeCode);

  const combo = inputs.wireCombination?.filter(e => e.count > 0);
  const isCombo = combo && combo.length > 0;
  const { gauge: resolvedGauge, label: comboLabel } = isCombo
    ? virtualGaugeFromCombination(combo, ref)
    : { gauge: findGauge(ref, swg), label: '' };
  const gauge = resolvedGauge;

  const klass = findClass(ref, inputs.accuracyClass);
  if (!isCombo) {
    positive(gauge.ohmPerM20c, 'Wire resistance');
    positive(gauge.gramPerM, 'Wire mass');
  }
  positive(klass.percent, 'Class error budget');
  positive(ref.copperRatePerKg, 'Copper rate', true);
  if (grade.ratePerKg !== null) positive(grade.ratePerKg, 'Steel rate', true);
  positive(grade.densityGCm3 ?? settings.steelDensity, 'Steel density');
  positive(grade.stackingFactor ?? settings.stackingFactor, 'Stacking factor');
  if ((grade.stackingFactor ?? settings.stackingFactor) > 1) throw new EngineError('INVALID_INPUT', 'Stacking factor cannot exceed 1.');
  const warnings: EngineWarning[] = [];

  /* Steps 1-2: compute turns first, then SWG-specific winding build */
  const prelimTurns = inputs.primaryCurrent / inputs.secondaryCurrent
    + (settings.plusFiveAbove400A && inputs.primaryCurrent > 400 ? 5 : 0);
  const resinCover = resinCoverForTurns(prelimTurns, settings.resinCoverMm);
  const windingBuild = computeWindingBuild(prelimTurns, gauge, inputs.finishedIdMm, settings);
  const allowanceMm = windingBuild
    ? resinCover + 2 * windingBuild.windingBuildMm
    : resinCover + settings.windingAllowanceMm;

  const geometry = computeGeometry(inputs, settings, allowanceMm);
  const N = geometry.turns;

  /* Step 3 - burden voltage */
  const burdenVoltage = inputs.burdenVA / inputs.secondaryCurrent;

  /* Step 4 - AT loss, the error budget */
  const atLoss = (inputs.primaryCurrent * klass.percent * 2 * settings.testMarginFactor) / 100;
  if (!klass.perIS) {
    warnings.push({
      code: 'CLASS_NOT_PER_IS',
      message: `Class ${klass.code} is designed to an in-house error budget of +/-${klass.percent}%. IS does not publish an ampere-turn figure for this class.`,
      ref: 'Accuracy',
    });
  }

  /* Steps 5-6 - magnetic path and magnetising force. H is NOT truncated. */
  const h = atLoss / geometry.mmlCm;

  /* Step 7 - flux density with the saturation ceiling, applied to EVERY grade */
  const interp: InterpolationResult = interpolateB(grade.curve, h);
  warnings.push(...interp.warnings);
  const bRawT = interp.bRawT;
  const wasCapped = bRawT > settings.saturationTriggerTesla;
  const bUsedT = wasCapped ? settings.saturationCapTesla : bRawT;
  if (wasCapped) {
    warnings.push({
      code: 'FLUX_CEILING_APPLIED',
      message: `Flux ceiling applied. The ${grade.label} curve reaches ${f(bRawT, 4)} T here, above the ${settings.saturationTriggerTesla} T limit, so the core is sized at ${settings.saturationCapTesla} T. This makes the core wider than the curve alone suggests.`,
      ref: 'Core sizing',
    });
  }

  /* Steps 8-12 - the convergence loop */
  const k = transformerConstant(settings.frequencyHz);
  const denominator = k * N * bUsedT;
  if (!(denominator > 0)) {
    throw new EngineError('INVALID_INPUT', 'Flux density resolved to zero - the core area cannot be computed.');
  }

  const iterations: Iteration[] = [];
  let V = burdenVoltage;
  let areaCm2 = 0;
  let widthCm = 0;
  let lengthM = 0;
  let resistanceOhm = 0;
  let vDrop = 0;
  let converged = false;

  for (let pass = 1; pass <= settings.maxIterations; pass++) {
    areaCm2 = V / denominator;
    widthCm = areaCm2 / geometry.radialBuildCm;
    const perTurnMm =
      ((geometry.coreOdMm - geometry.coreIdMm) + 2 * widthCm * 10) * settings.lengthFactor;
    lengthM = (perTurnMm * N + settings.leadWireMm) / 1000;
    resistanceOhm = lengthM * gauge.ohmPerM20c;
    vDrop = inputs.secondaryCurrent * resistanceOhm;
    const vNext = burdenVoltage + vDrop;
    const delta = Math.abs(vNext - V);

    iterations.push({ pass, areaCm2, widthCm, perTurnMm, lengthM, resistanceOhm, vDrop, vIn: V, vNext, delta });

    if (delta < settings.convergenceTolerance) { converged = true; V = vNext; break; }
    V = vNext;
  }

  if (!converged) {
    warnings.push({
      code: 'NO_CONVERGENCE',
      message: `The core size did not settle within ${settings.maxIterations} passes and is still moving. Raise the iteration limit in Settings, or check the inputs.`,
      ref: 'Core sizing',
    });
  }

  const coreWidthMm = widthCm * 10;

  /* Steps 13-14 - rounding, weight and cost. PROVISIONAL (§5.9). */
  const orderedWidthMm = roundToSlitWidth(coreWidthMm, ref, settings);
  // Cost the winding actually ordered, while retaining converged intermediates.
  const orderedWireLengthM = (((geometry.coreOdMm - geometry.coreIdMm + 2 * orderedWidthMm) * settings.lengthFactor * N) + settings.leadWireMm) / 1000;
  if (![coreWidthMm, orderedWidthMm, orderedWireLengthM].every(Number.isFinite)) throw new EngineError('INVALID_INPUT', 'The winding calculation overflowed. Check the specification and wire resistance.');
  const finalAreaCm2 = geometry.radialBuildCm * (orderedWidthMm / 10);
  // Volume is area x magnetic path length and nothing else. The spreadsheet multiplies
  // by width a second time; area already contains the width.
  const coreVolumeCm3 = finalAreaCm2 * geometry.mmlCm;
  const density = grade.densityGCm3 ?? settings.steelDensity;
  const stacking = grade.stackingFactor ?? settings.stackingFactor;
  const coreWeightKg = (coreVolumeCm3 * density * stacking) / 1000;
  const copperWeightKg = (orderedWireLengthM * gauge.gramPerM) / 1000;

  const coreCost = grade.ratePerKg === null ? null : coreWeightKg * grade.ratePerKg;
  const copperCost = copperWeightKg * ref.copperRatePerKg;
  const totalCost = coreCost === null ? null : coreCost + copperCost;

  if (grade.ratePerKg === null) {
    warnings.push({
      code: 'RATE_MISSING',
      message: `No rate per kg on record for ${grade.label}, so this option cannot be costed or ranked. Add one under Reference data.`,
      ref: 'Rates',
    });
  }

  warnings.push({
    code: 'PROVISIONAL_OUTPUTS',
    message:
      'Ordered width, core weight, copper weight and costs are estimates from the current rate table. Check them against the works order before quoting.',
    ref: 'Costing',
  });

  if (settings.plusFiveAbove400A && inputs.primaryCurrent > 400) {
    warnings.push({
      code: 'PLUS_FIVE_APPLIED',
      message: 'The extra 5-turn margin above 400 A is switched on. It stacks with the flux ceiling and will make every core above 400 A wider than the calculation alone requires.',
      ref: 'Core sizing',
    });
  }

  const result: SolveResult = {
    inputs,
    gradeCode: grade.code,
    swg: gauge.swg,
    ...(isCombo ? { wireCombination: combo, wireCombinationLabel: comboLabel } : {}),
    geometry,
    burdenVoltage,
    classPercent: klass.percent,
    atLoss,
    h,
    bRawT,
    bUsedT,
    wasCapped,
    coreAreaCm2: areaCm2,
    coreWidthMm,
    wireLengthM: lengthM,
    resistanceOhm,
    vDrop,
    vTotal: V,
    converged,
    passes: iterations.length,
    iterations,
    orderedWidthMm,
    finalAreaCm2,
    coreVolumeCm3,
    coreWeightKg,
    copperWeightKg,
    coreCost,
    copperCost,
    totalCost,
    provisional: true,
    steps: [],
    warnings,
  };

  if (options.withSteps !== false) {
    result.steps = buildSteps(result, ref, settings, grade, gauge, klass.percent, interp, denominator, k, windingBuild, comboLabel);
  }
  return result;
}

/** The substituted chain the detail panel renders (§11.2, §16 "show the working"). */
function buildSteps(
  r: SolveResult,
  ref: ReferenceData,
  s: ProcessSettings,
  grade: SteelGrade,
  gauge: WireGauge,
  classPercent: number,
  interp: InterpolationResult,
  denominator: number,
  k: number,
  windingBuild: WindingResult | null,
  comboLabel: string,
): CalcStep[] {
  const g = r.geometry;
  const i = r.inputs;
  const resinCover = resinCoverForTurns(g.turns, s.resinCoverMm);
  const windingDesc = windingBuild
    ? `${f(resinCover, 1)} + 2 × ${f(windingBuild.windingBuildMm, 2)} (${windingBuild.layers} layer${windingBuild.layers > 1 ? 's' : ''}, ${windingBuild.turnsPerLayer} turns/layer)`
    : `${f(resinCover, 1)} + ${s.windingAllowanceMm} (fixed)`;
  return [
    { step: 1, key: 'turns', label: 'Secondary turns', formula: 'N = Ip / Is',
      substituted: `${i.primaryCurrent} / ${i.secondaryCurrent}`, value: g.turns, unit: 'turns' },
    { step: 2, key: 'allowance', label: 'Allowance', formula: 'resin cover + winding build',
      substituted: windingDesc, value: g.allowanceMm, unit: 'mm',
      note: `Resin cover ${f(resinCover, 1)} mm for ${Math.round(g.turns)} turns. ${windingBuild ? `Winding build computed from SWG ${gauge.swg} insulated dia ${f(gauge.diaMm + 2 * s.wireInsulationMm, 2)} mm.` : 'Winding allowance is fixed — set wire insulation and packing data to compute it.'}` },
    { step: 3, key: 'coreId', label: 'Core ID', formula: 'finished ID + allowance',
      substituted: `${i.finishedIdMm} + ${g.allowanceMm}`, value: g.coreIdMm, unit: 'mm' },
    { step: 4, key: 'coreOd', label: 'Core OD', formula: 'finished OD - allowance',
      substituted: `${i.finishedOdMm} - ${g.allowanceMm}`, value: g.coreOdMm, unit: 'mm' },
    { step: 5, key: 'radialBuild', label: 'Radial build', formula: '(core OD - core ID) / 2',
      substituted: `(${f(g.coreOdMm, 2)} - ${f(g.coreIdMm, 2)}) / 2`, value: g.radialBuildMm, unit: 'mm' },
    { step: 6, key: 'burdenVoltage', label: 'Burden voltage', formula: 'VA / Is',
      substituted: `${i.burdenVA} / ${i.secondaryCurrent}`, value: r.burdenVoltage, unit: 'V' },
    { step: 7, key: 'atLoss', label: 'AT loss', formula: '(Ip x class% x 2 x test margin) / 100',
      substituted: `(${i.primaryCurrent} x ${classPercent} x 2 x ${s.testMarginFactor}) / 100`,
      value: r.atLoss, unit: 'AT',
      note: 'The x2 covers the full error band, minus through plus. The x0.95 is a deliberate margin, because external test rigs read slightly differently from the works rig.' },
    { step: 8, key: 'mml', label: 'Mean magnetic length', formula: 'pi x ((core ID + core OD) / 2) / 10',
      substituted: `pi x ((${f(g.coreIdMm, 2)} + ${f(g.coreOdMm, 2)}) / 2) / 10`, value: g.mmlCm, unit: 'cm' },
    { step: 9, key: 'h', label: 'Magnetising force', formula: 'H = AT loss / MML',
      substituted: `${f(r.atLoss, 4)} / ${f(g.mmlCm, 4)}`, value: r.h, unit: 'AT/cm',
      note: 'Not truncated before the lookup.' },
    { step: 10, key: 'bRaw', label: 'Flux density from the curve', formula: 'linear interpolation of the B-H curve',
      substituted: interp.lower && interp.upper
        ? `${interp.lower.teslaT} T @ ${interp.lower.hAtCm} + ${f(interp.fraction, 4)} x (${interp.upper.teslaT} - ${interp.lower.teslaT})`
        : `clamped to the end of the ${grade.label} curve`,
      value: r.bRawT, unit: 'T' },
    { step: 11, key: 'bUsed', label: 'Flux density used', formula: `B > ${s.saturationTriggerTesla} T ? ${s.saturationCapTesla} T : B`,
      substituted: r.wasCapped
        ? `${f(r.bRawT, 4)} > ${s.saturationTriggerTesla} -> ${s.saturationCapTesla}`
        : `${f(r.bRawT, 4)} <= ${s.saturationTriggerTesla} -> uncapped`,
      value: r.bUsedT, unit: 'T',
      note: 'The ceiling applies to every grade, so the core will not saturate below roughly 2 to 2.5 times the working voltage.' },
    { step: 12, key: 'area', label: 'Core area (converged)', formula: 'A = V / (4.44 x f x 1e-4 x N x B)',
      substituted: `${f(r.vTotal, 5)} / (${f(k, 5)} x ${g.turns} x ${f(r.bUsedT, 4)}) = ${f(r.vTotal, 5)} / ${f(denominator, 6)}`,
      value: r.coreAreaCm2, unit: 'cm2',
      note: `${r.passes} passes; wire drop ${f(r.vDrop, 5)} V on ${f(r.wireLengthM, 3)} m of ${comboLabel || `SWG ${gauge.swg}`}.` },
    { step: 13, key: 'width', label: 'Core width', formula: 'A / radial build',
      substituted: `${f(r.coreAreaCm2, 4)} / ${f(g.radialBuildCm, 4)} cm`, value: r.coreWidthMm, unit: 'mm' },
    { step: 14, key: 'orderedWidth', label: 'Ordered width', formula: 'smallest stocked slit width >= core width',
      substituted: ref.slitWidthsMm.length
        ? `stocked widths: ${ref.slitWidthsMm.join(', ')} mm`
        : `no slit widths on record - rounded up to the nearest ${s.slitStepMm} mm`,
      value: r.orderedWidthMm, unit: 'mm', provisional: true },
    { step: 15, key: 'coreWeight', label: 'Core weight', formula: 'area x MML x density x stacking / 1000',
      substituted: `${f(r.finalAreaCm2, 4)} x ${f(g.mmlCm, 4)} x ${grade.densityGCm3 ?? s.steelDensity} x ${grade.stackingFactor ?? s.stackingFactor} / 1000`,
      value: r.coreWeightKg, unit: 'kg', provisional: true },
    { step: 16, key: 'copperWeight', label: 'Copper weight', formula: 'wire length x g/m / 1000',
      substituted: `${f(r.copperWeightKg * 1000 / gauge.gramPerM, 4)} x ${gauge.gramPerM} / 1000`, value: r.copperWeightKg, unit: 'kg', provisional: true,
      note: comboLabel
        ? `Wire combination ${comboLabel}. Combined ${f(gauge.gramPerM, 2)} g/m. Wire length recomputed at the ordered slit width.`
        : 'Wire length is recomputed at the ordered slit width, including lead and crossover allowances.' },
    { step: 17, key: 'cost', label: 'Material cost', formula: 'core kg x grade rate + copper kg x copper rate',
      substituted: grade.ratePerKg === null
        ? `no rate on record for ${grade.label}`
        : `${f(r.coreWeightKg, 4)} x ${grade.ratePerKg} + ${f(r.copperWeightKg, 4)} x ${ref.copperRatePerKg}`,
      value: r.totalCost ?? '-', unit: 'INR', provisional: true },
  ];
}
