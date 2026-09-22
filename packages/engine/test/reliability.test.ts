import { describe, it, expect } from 'vitest';
import { solve, optimise, seedReferenceData, DEFAULT_SETTINGS, getDesignFamily, type DesignInputs } from '../src/index.js';

const inputs: DesignInputs = { primaryCurrent: 300, secondaryCurrent: 5, burdenVA: 5, accuracyClass: '0.5S', finishedIdMm: 40, finishedOdMm: 75, ctType: 'ring' };
const ref = seedReferenceData();

describe('cost and recommendation reliability', () => {
  it('costs copper using the ordered width rather than the smaller theoretical width', () => {
    const result = solve(inputs, { ...ref, slitWidthsMm: [60] }, DEFAULT_SETTINGS, 'M-4', 17);
    const wire = ref.gauges.find(g => g.swg === 17)!;
    const actualLength = ((11 + 2 * 60) * DEFAULT_SETTINGS.lengthFactor * 60 + DEFAULT_SETTINGS.leadWireMm) / 1000;
    expect(result.copperWeightKg).toBeCloseTo(actualLength * wire.gramPerM / 1000, 10);
    expect(result.copperCost).toBeCloseTo(result.copperWeightKg * ref.copperRatePerKg, 10);
    expect(actualLength).toBeGreaterThan(result.wireLengthM);
  });
  it('never ranks a width absent from a populated stock register', () => {
    const result = optimise(inputs, { ...ref, slitWidthsMm: [1] }, DEFAULT_SETTINGS);
    expect(result.options.every(o => o.rank === null)).toBe(true);
    expect(result.options.some(o => o.infeasibleReasons.includes('No stocked slit width is wide enough for this core'))).toBe(true);
  });
  it.each([NaN, Infinity, -1, 0])('rejects invalid burden %s', burdenVA => {
    expect(() => solve({ ...inputs, burdenVA }, ref, DEFAULT_SETTINGS, 'M-4', 17)).toThrow();
  });
  it.each([0, 1.5, 501, Infinity])('bounds iteration count %s', maxIterations => {
    expect(() => optimise(inputs, ref, { ...DEFAULT_SETTINGS, maxIterations })).toThrow();
  });
  it('rejects fractional turns', () => {
    expect(() => solve({ ...inputs, primaryCurrent: 301 }, ref, DEFAULT_SETTINGS, 'M-4', 17)).toThrow(/whole number/);
  });
  it('never ranks a negative steel price', () => {
    const result = optimise(inputs, { ...ref, grades: ref.grades.map(g => ({ ...g, ratePerKg: -10 })) }, DEFAULT_SETTINGS);
    expect(result.options.every(o => o.rank === null)).toBe(true);
  });
  it('the recommendation is the minimum of all finite feasible costs', () => {
    const result = optimise(inputs, ref, DEFAULT_SETTINGS);
    const feasible = result.options.filter(o => o.isFeasible);
    expect(feasible.length).toBeGreaterThan(0);
    expect(feasible[0].totalCost).toBe(Math.min(...feasible.map(o => o.totalCost!)));
    expect(feasible.map(o => o.rank)).toEqual(feasible.map((_, i) => i + 1));
  });
  it('dispatches only the implemented design family', () => {
    expect(getDesignFamily('lt-ct').optimise(inputs, ref, DEFAULT_SETTINGS).options.length).toBeGreaterThan(0);
    expect(() => getDesignFamily('power-transformer')).toThrow(/not available/);
  });
});
