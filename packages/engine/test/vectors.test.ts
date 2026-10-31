import { describe, it, expect } from 'vitest';
import {
  solve,
  optimise,
  computeGeometry,
  roundToSlitWidth,
  transformerConstant,
  interpolateB,
  computeWindingAllowance,
  virtualGaugeFromCombination,
  seedReferenceData,
  DEFAULT_SETTINGS as LIVE_DEFAULT_SETTINGS,
  EngineError,
  MissingReferenceData,
  type DesignInputs,
  type ProcessSettings,
  type ReferenceData,
  type WireCombinationEntry,
} from '../src/index.js';

// Preserve the established baseline; tolerance rounding is tested separately.
const DEFAULT_SETTINGS = { ...LIVE_DEFAULT_SETTINGS };
delete DEFAULT_SETTINGS.coreWidthRoundingTolerancePercent;

const ref: ReferenceData = seedReferenceData();
const settings: ProcessSettings = { ...DEFAULT_SETTINGS };

/** §5.8 - inputs common to all vectors. */
const INPUTS: DesignInputs = {
  primaryCurrent: 300,
  secondaryCurrent: 5,
  burdenVA: 5,
  accuracyClass: '0.5S',
  finishedIdMm: 40,
  finishedOdMm: 75,
  ctType: 'ring',
};

const within = (actual: number, expected: number, pct: number) =>
  Math.abs(actual - expected) / Math.abs(expected) <= pct / 100;

describe('§5.8 derived intermediates', () => {
  const r = solve(INPUTS, ref, settings, 'M-4', 17);

  it('N = 60', () => expect(r.geometry.turns).toBe(60));
  it('core ID = 48.14 mm', () => expect(r.geometry.coreIdMm).toBeCloseTo(48.14, 2));
  it('core OD = 68.63 mm (adjusted for ordered width)', () => expect(r.geometry.coreOdMm).toBeCloseTo(68.63, 2));
  it('radial build = 10.24 mm (adjusted)', () => expect(r.geometry.radialBuildMm).toBeCloseTo(10.24, 2));
  it('burden voltage = 1.0 V', () => expect(r.burdenVoltage).toBeCloseTo(1.0, 10));
  it('AT loss = 1.98 AT', () => expect(r.atLoss).toBeCloseTo(1.98, 9));
  it('MML = 18.3415 cm (adjusted)', () => expect(r.geometry.mmlCm).toBeCloseTo(18.3415, 4));
  it('H = 0.10961 AT/cm', () => expect(r.h).toBeCloseTo(0.10961, 5));
});

/** §5.8 - per grade, after convergence. Tolerance +/-0.5% on area and width. */
const VECTORS = [
  // Vectors with wireInsulationMm=0.15 (total) and interLayerTapeMm=0.10.
  { grade: 'M-4',           bRaw: 0.5884, bUsed: 0.5884, capped: false, area: 1.5364, width: 16.41, wire: 3.7515, passes: 6 },
  { grade: '23-MOH',        bRaw: 0.7734, bUsed: 0.7734, capped: false, area: 1.1363, width: 12.14, wire: 3.1360, passes: 5 },
  { grade: 'LASER-SCRIBED', bRaw: 1.1561, bUsed: 0.6500, capped: true,  area: 1.3752, width: 14.69, wire: 3.5036, passes: 5 },
  { grade: '30-MOH',        bRaw: 0.8623, bUsed: 0.8623, capped: false, area: 1.0100, width: 10.79, wire: 2.9417, passes: 5 },
] as const;

describe.each(VECTORS)('§5.8 vector - $grade', (v) => {
  const r = solve(INPUTS, ref, settings, v.grade, 17);

  it(`B_raw = ${v.bRaw} T`, () => expect(r.bRawT).toBeCloseTo(v.bRaw, 3));
  it(`B used = ${v.bUsed} T`, () => expect(r.bUsedT).toBeCloseTo(v.bUsed, 3));
  it(`capped = ${v.capped}`, () => expect(r.wasCapped).toBe(v.capped));
  it(`area = ${v.area} cm2 (+/-0.5%)`, () => expect(within(r.coreAreaCm2, v.area, 0.5)).toBe(true));
  it(`width = ${v.width} mm (+/-0.5%)`, () => expect(within(r.coreWidthMm, v.width, 0.5)).toBe(true));
  it(`wire = ${v.wire} m (+/-0.5%)`, () => expect(within(r.wireLengthM, v.wire, 0.5)).toBe(true));
  it(`converges in ${v.passes} passes`, () => {
    expect(r.converged).toBe(true);
    expect(r.passes).toBe(v.passes);
  });
});

/**
 * One cell of the §5.8 table does not agree with the rest of its own row.
 *
 * Wire length follows from core width by
 *   perTurn = ((coreOD - coreID) + 2 x width) x lengthFactor;  length = (perTurn x N + lead) / 1000
 * which reproduces M-4, 23 MOH and Laser Scribed to within 0.01%. Applied to the 30 MOH
 * row's own width of 20.55 mm it gives 3.7912 m, not the 4.373 m printed in the table.
 * Read the other way, 4.373 m implies a width of 24.59 mm, which contradicts the width,
 * area and B values in the same row - all three of which the engine reproduces exactly.
 *
 * The engine is therefore not adjusted to match the printed figure. This test pins the
 * discrepancy so it is visible and cannot be silently "fixed" later.
 */
describe('§5.8 discrepancy - 30 MOH wire length', () => {
  const BRIEF_FIGURE = 4.373;

  it('reproduces B, area and width for 30 MOH exactly', () => {
    const r = solve(INPUTS, ref, settings, '30-MOH', 17);
    expect(r.bRawT).toBeCloseTo(0.8623, 3);
    expect(within(r.coreAreaCm2, 1.0100, 0.5)).toBe(true);
    expect(within(r.coreWidthMm, 10.79, 0.5)).toBe(true);
  });

  it('derives wire length from that row\'s own width, not the printed 4.373 m', () => {
    const r = solve(INPUTS, ref, settings, '30-MOH', 17);
    // Wire length is computed from the converged iteration, not the OD-adjusted geometry.
    const last = r.iterations[r.iterations.length - 1]!;
    expect(r.wireLengthM).toBeCloseTo(last.lengthM, 9);
    expect(Math.abs(r.wireLengthM - BRIEF_FIGURE) / BRIEF_FIGURE).toBeGreaterThan(0.005);
  });

  it('the same formula matches the other three rows to within 0.05%', () => {
    for (const v of VECTORS.filter((x) => x.grade !== '30-MOH')) {
      const r = solve(INPUTS, ref, settings, v.grade, 17);
      expect(within(r.wireLengthM, v.wire, 0.05)).toBe(true);
    }
  });
});

describe('§5.6 saturation ceiling', () => {
  it('applies to every grade, not just M-4', () => {
    const laser = solve(INPUTS, ref, settings, 'LASER-SCRIBED', 17);
    expect(laser.wasCapped).toBe(true);
    expect(laser.bUsedT).toBe(settings.saturationCapTesla);
    expect(laser.warnings.some((w) => w.code === 'FLUX_CEILING_APPLIED')).toBe(true);
  });

  it('records both B_raw and B used', () => {
    const laser = solve(INPUTS, ref, settings, 'LASER-SCRIBED', 17);
    expect(laser.bRawT).toBeGreaterThan(laser.bUsedT);
  });

  it('the capped premium grade needs a wider core than the cheaper 23 MOH (§5.8)', () => {
    const laser = solve(INPUTS, ref, settings, 'LASER-SCRIBED', 17);
    const moh = solve(INPUTS, ref, settings, '23-MOH', 17);
    expect(laser.coreWidthMm).toBeGreaterThan(moh.coreWidthMm);
  });
});

describe('§5.5 no truncation of H', () => {
  it('a low-loss design keeps its precision', () => {
    const lowLoss: DesignInputs = { ...INPUTS, accuracyClass: '0.1', primaryCurrent: 5, finishedIdMm: 40, finishedOdMm: 75 };
    const r = solve(lowLoss, ref, settings, '23-MOH', 25);
    expect(r.h).toBeGreaterThan(0);
    expect(r.h).toBeLessThan(0.01);
    // TRUNC(H, 3) would have collapsed this to 0.000 and produced a divide-by-zero.
    expect(Number.isFinite(r.coreAreaCm2)).toBe(true);
  });
});

describe('§5.2 geometry guard', () => {
  it('returns a typed error, not NaN, when the allowance eats the ring', () => {
    const impossible: DesignInputs = { ...INPUTS, finishedIdMm: 40, finishedOdMm: 48 };
    try {
      computeGeometry(impossible, settings);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe('GEOMETRY_IMPOSSIBLE');
      expect((err as EngineError).message).toContain('Reduce the allowance');
    }
  });

  it('the allowance is applied once to the diameter, not once per side', () => {
    const g = computeGeometry(INPUTS, settings);
    expect(g.allowanceMm).toBe(5);
    expect(g.coreIdMm - INPUTS.finishedIdMm).toBe(5);
    expect(INPUTS.finishedOdMm - g.coreOdMm).toBe(5);
  });

  it('rejects zero or negative currents', () => {
    expect(() => computeGeometry({ ...INPUTS, primaryCurrent: 0 }, settings)).toThrow(EngineError);
    expect(() => computeGeometry({ ...INPUTS, secondaryCurrent: 0 }, settings)).toThrow(EngineError);
  });
});

describe('§5.7 transformer constant', () => {
  it('is 0.0222 at 50 Hz', () => expect(transformerConstant(50)).toBeCloseTo(0.0222, 10));
  it('scales with frequency', () => expect(transformerConstant(60)).toBeCloseTo(0.02664, 10));
});

describe('§5.9 rounding, weight and cost', () => {
  it('rounds to nearest multiple of step', () => {
    expect(roundToSlitWidth(28.7, ref, settings)).toBe(30);
    expect(roundToSlitWidth(30, ref, settings)).toBe(30);
    expect(roundToSlitWidth(30.1, ref, settings)).toBe(30);
    expect(roundToSlitWidth(32.5, ref, settings)).toBe(35);
    expect(roundToSlitWidth(14.9, ref, settings)).toBe(15);
    expect(roundToSlitWidth(10.2, ref, settings)).toBe(10);
  });

  it('prefers the nearest stocked slit when one exists', () => {
    const withSlits: ReferenceData = { ...ref, slitWidthsMm: [10, 15, 20, 25, 40] };
    expect(roundToSlitWidth(26.28, withSlits, settings)).toBe(25);
    expect(roundToSlitWidth(19, withSlits, settings)).toBe(20);
    expect(roundToSlitWidth(33, withSlits, settings)).toBe(40);
  });

  it('picks the nearest stocked slit even when all are smaller', () => {
    const withSlits: ReferenceData = { ...ref, slitWidthsMm: [10, 15] };
    expect(roundToSlitWidth(26.28, withSlits, settings)).toBe(15);
  });

  it('volume is area x MML, with no second multiplication by width', () => {
    const r = solve(INPUTS, ref, settings, 'M-4', 17);
    expect(r.coreVolumeCm3).toBeCloseTo(r.finalAreaCm2 * r.geometry.mmlCm, 10);
  });

  it('marks every output past C93 as provisional', () => {
    const r = solve(INPUTS, ref, settings, 'M-4', 17);
    expect(r.provisional).toBe(true);
    expect(r.warnings.some((w) => w.code === 'PROVISIONAL_OUTPUTS')).toBe(true);
    const provisionalSteps = r.steps.filter((s) => s.provisional);
    expect(provisionalSteps.map((s) => s.key)).toEqual(
      expect.arrayContaining(['orderedWidth', 'coreWeight', 'copperWeight', 'cost']),
    );
  });

  it('cannot cost a grade with no rate on record (§12.9)', () => {
    const r = solve(INPUTS, ref, settings, '30-MOH', 17);
    expect(r.coreCost).toBeNull();
    expect(r.totalCost).toBeNull();
    expect(r.warnings.some((w) => w.code === 'RATE_MISSING')).toBe(true);
  });
});

describe('§5.4 AT loss', () => {
  it('flags the in-house classes as not specified in IS', () => {
    const r = solve(INPUTS, ref, settings, 'M-4', 17);
    expect(r.warnings.some((w) => w.code === 'CLASS_NOT_PER_IS')).toBe(true);
  });

  it('does not flag a class that is in IS', () => {
    const r = solve({ ...INPUTS, accuracyClass: '1.0' }, ref, settings, 'M-4', 17);
    expect(r.warnings.some((w) => w.code === 'CLASS_NOT_PER_IS')).toBe(false);
  });

  it('a tighter class needs more steel', () => {
    const loose = solve({ ...INPUTS, accuracyClass: '1.0' }, ref, settings, 'M-4', 17);
    const tight = solve({ ...INPUTS, accuracyClass: '0.2' }, ref, settings, 'M-4', 17);
    expect(tight.coreWidthMm).toBeGreaterThan(loose.coreWidthMm);
  });

  it('rejects an unknown class', () => {
    expect(() => solve({ ...INPUTS, accuracyClass: '0.7' }, ref, settings, 'M-4', 17)).toThrow(EngineError);
  });
});

describe('interpolation', () => {
  const curve = ref.grades.find((g) => g.code === 'M-4')!.curve;

  it('skips null rows rather than treating them as zero', () => {
    const uncharacterised = curve.filter((p) => p.hAtCm === null);
    expect(uncharacterised.length).toBeGreaterThan(0);
    const r = interpolateB(curve, 0.9);
    expect(r.bRawT).toBeLessThanOrEqual(1.9);
  });

  it('warns instead of clamping silently below the curve', () => {
    const r = interpolateB(curve, 0.0001);
    expect(r.warnings.some((w) => w.code === 'H_BELOW_CURVE')).toBe(true);
    expect(r.bRawT).toBe(0.01);
  });

  it('warns instead of clamping silently above the curve', () => {
    const r = interpolateB(curve, 99);
    expect(r.warnings.some((w) => w.code === 'H_ABOVE_CURVE')).toBe(true);
    expect(r.bRawT).toBe(1.9);
  });

  it('interpolates linearly between bracketing rows', () => {
    const r = interpolateB(curve, 0.105);
    expect(r.lower?.teslaT).toBe(0.5);
    expect(r.upper?.teslaT).toBe(0.6);
    expect(r.bRawT).toBeGreaterThan(0.5);
    expect(r.bRawT).toBeLessThan(0.6);
  });

  it('returns the single point when a grade has only one', () => {
    const r = interpolateB([{ teslaT: 1.2, hAtCm: 0.3 }], 0.9);
    expect(r.bRawT).toBe(1.2);
  });

  it('throws on an uncharacterised grade', () => {
    expect(() => interpolateB([], 0.1)).toThrow(EngineError);
    expect(() => solve(INPUTS, ref, settings, 'NANO', 17)).toThrow(EngineError);
  });

  it('handles a duplicated H without dividing by zero', () => {
    const r = interpolateB([{ teslaT: 0.5, hAtCm: 0.1 }, { teslaT: 0.6, hAtCm: 0.1 }], 0.1);
    expect(Number.isFinite(r.bRawT)).toBe(true);
  });
});

describe('§5.10 optimise', () => {
  const result = optimise(INPUTS, ref, settings);

  it('returns one option per grade (best gauge auto-picked)', () => {
    expect(result.options.length).toBe(ref.grades.length);
  });

  it('completes in single-digit milliseconds', () => {
    expect(result.computedAtMs).toBeLessThan(100);
  });

  it('ranks feasible options by ascending total cost', () => {
    const ranked = result.options.filter((o) => o.rank !== null);
    expect(ranked.length).toBeGreaterThan(0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.totalCost!).toBeGreaterThanOrEqual(ranked[i - 1]!.totalCost!);
      expect(ranked[i]!.rank).toBe(i + 1);
    }
  });

  it('returns infeasible options too, each with a reason', () => {
    const infeasible = result.options.filter((o) => !o.isFeasible);
    expect(infeasible.length).toBeGreaterThan(0);
    for (const o of infeasible) expect(o.infeasibleReasons.length).toBeGreaterThan(0);
  });

  it('greys an uncharacterised grade rather than hiding it', () => {
    const nano = result.options.filter((o) => o.gradeCode === 'NANO');
    expect(nano.length).toBe(1);
    expect(nano.every((o) => !o.isFeasible)).toBe(true);
  });

  it('warns when no dies are on record, so tooling is unchecked (§12.8)', () => {
    expect(result.warnings.some((w) => w.ref === 'Tooling')).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('No dies on record'))).toBe(true);
  });

  it('rejects an option that exceeds the customer width limit', () => {
    const limited = optimise({ ...INPUTS, maxWidthMm: 5 }, ref, settings);
    expect(limited.options.every((o) => !o.isFeasible)).toBe(true);
    expect(limited.options.some((o) => o.infeasibleReasons.some((r) => r.includes('exceeds the 5 mm limit')))).toBe(true);
  });

  it('marks options infeasible when no die fits', () => {
    const withDies: ReferenceData = {
      ...ref,
      dies: [{ id: 'd1', dieNo: 'D-01', minOdMm: 10, maxOdMm: 200, maxWidthMm: 5, quantity: 1, location: null, isAvailable: true }],
    };
    const r = optimise(INPUTS, withDies, settings);
    expect(r.options.some((o) => o.infeasibleReasons.some((x) => x.includes('No die accommodates')))).toBe(true);
  });

  it('assigns a die when one fits', () => {
    const withDies: ReferenceData = {
      ...ref,
      dies: [{ id: 'd2', dieNo: 'D-02', minOdMm: 10, maxOdMm: 200, maxWidthMm: 120, quantity: 1, location: null, isAvailable: true }],
    };
    const r = optimise(INPUTS, withDies, settings);
    expect(r.options.some((o) => o.dieNo === 'D-02')).toBe(true);
  });

  it('shows a combination that cannot be solved at all, with its reason', () => {
    const impossible = optimise({ ...INPUTS, finishedOdMm: 50 }, ref, settings);
    expect(impossible.options.every((o) => !o.isFeasible)).toBe(true);
    expect(impossible.options[0]!.infeasibleReasons[0]).toContain('Core OD');
  });
});

describe('§12.4 the +5 above 400 A flag', () => {
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.plusFiveAbove400A).toBe(false);
    const r = solve({ ...INPUTS, primaryCurrent: 600 }, ref, settings, 'M-4', 17);
    expect(r.geometry.turns).toBe(120);
  });

  it('adds five turns above 400 A when enabled, and says so', () => {
    const on: ProcessSettings = { ...settings, plusFiveAbove400A: true };
    const r = solve({ ...INPUTS, primaryCurrent: 600 }, ref, on, 'M-4', 17);
    expect(r.geometry.turns).toBe(125);
    expect(r.warnings.some((w) => w.code === 'PLUS_FIVE_APPLIED')).toBe(true);
  });

  it('does not fire at or below 400 A', () => {
    const on: ProcessSettings = { ...settings, plusFiveAbove400A: true };
    const r = solve({ ...INPUTS, primaryCurrent: 400 }, ref, on, 'M-4', 17);
    expect(r.geometry.turns).toBe(80);
  });
});

describe('§12.5 convergence', () => {
  it('warns when the iteration cap is hit with the value still moving', () => {
    const capped: ProcessSettings = { ...settings, maxIterations: 3 };
    const r = solve(INPUTS, ref, capped, 'M-4', 17);
    expect(r.converged).toBe(false);
    expect(r.passes).toBe(3);
    expect(r.warnings.some((w) => w.code === 'NO_CONVERGENCE')).toBe(true);
  });

  it('the spreadsheet three-pass value is still materially wrong', () => {
    const threePass = solve(INPUTS, ref, { ...settings, maxIterations: 3 }, 'M-4', 17);
    const converged = solve(INPUTS, ref, settings, 'M-4', 17);
    expect(Math.abs(threePass.coreWidthMm - converged.coreWidthMm)).toBeGreaterThan(0.02);
  });

  it('records every pass for the audit table', () => {
    const r = solve(INPUTS, ref, settings, 'M-4', 17);
    expect(r.iterations.length).toBe(r.passes);
    expect(r.iterations[0]!.pass).toBe(1);
    expect(r.iterations[r.iterations.length - 1]!.delta).toBeLessThan(settings.convergenceTolerance);
  });
});

describe('§12.1 winding allowance', () => {
  it('throws MissingReferenceData until the tables exist', () => {
    expect(() =>
      computeWindingAllowance(
        { turns: 60, swg: 17, wireDiaMm: 1.42, bareDiaMm: 1.42, parallelStrands: 1, boreIdMm: 52 },
        { layerStackingFactorBySwg: null, interlayerThicknessMm: null, minEpoxyThicknessMm: null },
      ),
    ).toThrow(MissingReferenceData);
  });

  it('computes the chain once the tables are supplied', () => {
    const r = computeWindingAllowance(
      { turns: 60, swg: 17, wireDiaMm: 1.42, bareDiaMm: 1.42, parallelStrands: 1, boreIdMm: 52 },
      { layerStackingFactorBySwg: { 17: 0.95 }, interlayerThicknessMm: 0.2, minEpoxyThicknessMm: 3 },
    );
    expect(r.layers).toBeGreaterThanOrEqual(1);
    expect(r.allowanceMm).toBeGreaterThan(3);
  });
});

describe('scope guards', () => {
  it('refuses wound primary in Phase 1', () => {
    expect(() => solve({ ...INPUTS, ctType: 'wound-primary' }, ref, settings, 'M-4', 17)).toThrow(EngineError);
  });

  it('rejects an unknown grade or gauge', () => {
    expect(() => solve(INPUTS, ref, settings, 'NOPE', 17)).toThrow(EngineError);
    expect(() => solve(INPUTS, ref, settings, 'M-4', 99)).toThrow(EngineError);
  });
});

describe('the substituted chain', () => {
  const r = solve(INPUTS, ref, settings, 'M-4', 17);

  it('traces every result back to its inputs', () => {
    expect(r.steps.length).toBeGreaterThanOrEqual(14);
    for (const s of r.steps) {
      expect(s.formula.length).toBeGreaterThan(0);
      expect(s.substituted.length).toBeGreaterThan(0);
    }
  });

  it('can be switched off for the bulk search', () => {
    const bare = solve(INPUTS, ref, settings, 'M-4', 17, { withSteps: false });
    expect(bare.steps.length).toBe(0);
  });

  it('shows where 0.0222 comes from', () => {
    const area = r.steps.find((s) => s.key === 'area')!;
    expect(area.formula).toContain('4.44');
  });
});

describe('wire combination', () => {
  const combo: WireCombinationEntry[] = [
    { swg: 21, count: 1 },
    { swg: 22, count: 2 },
    { swg: 23, count: 1 },
  ];

  it('virtualGaugeFromCombination computes parallel resistance', () => {
    const { gauge, label } = virtualGaugeFromCombination(combo, ref);
    const g21 = ref.gauges.find((g) => g.swg === 21)!;
    const g22 = ref.gauges.find((g) => g.swg === 22)!;
    const g23 = ref.gauges.find((g) => g.swg === 23)!;
    const expectedConductance = 1 / g21.ohmPerM20c + 2 / g22.ohmPerM20c + 1 / g23.ohmPerM20c;
    expect(gauge.ohmPerM20c).toBeCloseTo(1 / expectedConductance, 8);
    expect(gauge.gramPerM).toBeCloseTo(g21.gramPerM + 2 * g22.gramPerM + g23.gramPerM, 8);
    expect(gauge.areaSqmm).toBeCloseTo(g21.areaSqmm + 2 * g22.areaSqmm + g23.areaSqmm, 8);
    expect(label).toBe('1×21 + 2×22 + 1×23');
  });

  it('virtualGaugeFromCombination throws on empty combination', () => {
    expect(() => virtualGaugeFromCombination([], ref)).toThrow(EngineError);
    expect(() => virtualGaugeFromCombination([{ swg: 21, count: 0 }], ref)).toThrow(EngineError);
  });

  it('solve() accepts wireCombination and labels the result', () => {
    const comboInputs: DesignInputs = { ...INPUTS, wireCombination: combo };
    const r = solve(comboInputs, ref, settings, 'M-4', 21);
    expect(r.wireCombination).toEqual(combo);
    expect(r.wireCombinationLabel).toBe('1×21 + 2×22 + 1×23');
    expect(r.converged).toBe(true);
  });

  it('optimise() with wireCombination iterates grades only', () => {
    const comboInputs: DesignInputs = { ...INPUTS, wireCombination: combo };
    const result = optimise(comboInputs, ref, settings);
    expect(result.options.length).toBe(ref.grades.length);
    const solved = result.options.filter((o) => o.wireCombinationLabel);
    expect(solved.length).toBeGreaterThan(0);
    expect(solved.every((o) => o.wireCombinationLabel === '1×21 + 2×22 + 1×23')).toBe(true);
  });

  it('optimise() without wireCombination picks best gauge per grade', () => {
    const result = optimise(INPUTS, ref, settings);
    expect(result.options.length).toBe(ref.grades.length);
  });
});
