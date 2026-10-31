import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCalculatorInputs, wireCombinationFromMap, wireModeFromDraft, type CalculatorFormInputs } from '../../../apps/web/src/design/calculationInputs';
import { designInputsSchema } from '@meltek/schema';
import { DEFAULT_SETTINGS as LIVE_DEFAULT_SETTINGS, optimise, seedReferenceData, solve, type DesignInputs, type ProcessSettings, type RankedOption, type SolveResult } from '../src/index.js';

// Preserve the established baseline; tolerance rounding is tested separately.
const DEFAULT_SETTINGS = { ...LIVE_DEFAULT_SETTINGS };
delete DEFAULT_SETTINGS.coreWidthRoundingTolerancePercent;

interface Fixture {
  name: string;
  inputs: DesignInputs;
  grade: string;
  swg: number;
  settingsPatch: Partial<ProcessSettings>;
  slits: number[];
  expected: Partial<SolveResult>;
  ranked: Pick<RankedOption, 'gradeCode' | 'swg' | 'rank' | 'isFeasible' | 'totalCost'>[];
}
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/pre-redesign-calculations.json', import.meta.url), 'utf8')) as { baselineCommit: string; cases: Fixture[] };
const base = snapshot.cases[0]!.inputs;
const form = (inputs: DesignInputs, strings = false): CalculatorFormInputs => ({
  ...inputs, maxWidthMm: inputs.maxWidthMm ?? '',
  ...(strings ? Object.fromEntries(['primaryCurrent', 'secondaryCurrent', 'burdenVA', 'finishedIdMm', 'finishedOdMm'].map(key => [key, String(inputs[key as keyof DesignInputs])])) : {}),
});
const fromForm = (inputs: DesignInputs, strings = false) => createCalculatorInputs(form(inputs, strings), inputs.engineering ?? null, inputs.wireCombination ?? null)!;
const summary = (result: SolveResult, expected: Partial<SolveResult>) => Object.fromEntries(Object.keys(expected).map(key => [key, result[key as keyof SolveResult]]));

describe(`redesigned calculator parity with pre-redesign ${snapshot.baselineCommit}`, () => {
  describe.each(snapshot.cases)('$name', fixture => {
    const reference = { ...seedReferenceData(), slitWidthsMm: fixture.slits };
    const settings = { ...DEFAULT_SETTINGS, ...fixture.settingsPatch };
    it('preserves every saved numerical result from numeric form values', () => {
      const result = solve(fromForm(fixture.inputs), reference, settings, fixture.grade, fixture.swg);
      expect(summary(result, fixture.expected)).toEqual(fixture.expected);
    });
    it('produces the same results when browser controls supply strings', () => {
      const result = solve(fromForm(fixture.inputs, true), reference, settings, fixture.grade, fixture.swg);
      expect(summary(result, fixture.expected)).toEqual(fixture.expected);
    });
    it('preserves selected gauges, feasibility, rankings and total costs', () => {
      const options = optimise(fromForm(fixture.inputs, true), reference, settings).options;
      expect(options.map(({gradeCode, swg, rank, isFeasible, totalCost}) => ({gradeCode, swg, rank, isFeasible, totalCost}))).toEqual(fixture.ranked);
    });
    it('preserves the same values through the save/API JSON boundary', () => {
      const transported = designInputsSchema.parse(JSON.parse(JSON.stringify(fromForm(fixture.inputs, true)))) as DesignInputs;
      const result = solve(transported, reference, settings, fixture.grade, fixture.swg);
      expect(summary(result, fixture.expected)).toEqual(fixture.expected);
    });
  });
});

describe('wire configuration UI state', () => {
  it('keeps automatic search when visible wire counts are prepared but not enabled', () => {
    const map = {21: 2, 22: 1};
    expect(wireCombinationFromMap(false, map)).toBeNull();
    expect(map).toEqual({21: 2, 22: 1});
  });
  it('sends exactly the enabled nonzero strand counts', () => {
    expect(wireCombinationFromMap(true, {21: 2, 22: 0, 23: 1})).toEqual([{swg:21,count:2},{swg:23,count:1}]);
  });
  it('does not change calculations when an empty fixed selector is displayed', () => {
    expect(wireCombinationFromMap(true, {})).toBeNull();
    expect(wireCombinationFromMap(true, {21:0})).toBeNull();
  });
  it('retains automatic mode after a JSON draft round trip with prepared counts', () => {
    const saved = JSON.parse(JSON.stringify({wireComboEnabled:false,wireMap:{21:2}}));
    expect(wireModeFromDraft(saved)).toBe(false);
    expect(wireCombinationFromMap(wireModeFromDraft(saved), saved.wireMap)).toBeNull();
  });
  it('retains enabled fixed mode after a JSON draft round trip', () => {
    const saved = JSON.parse(JSON.stringify({wireComboEnabled:true,wireMap:{21:2}}));
    expect(wireCombinationFromMap(wireModeFromDraft(saved), saved.wireMap)).toEqual([{swg:21,count:2}]);
  });
  it('keeps legacy drafts compatible', () => {
    expect(wireModeFromDraft({wireMap:{21:1}})).toBe(true);
    expect(wireModeFromDraft({wireMap:{21:0}})).toBe(false);
    expect(wireModeFromDraft(null)).toBe(false);
  });
});

describe('form boundaries', () => {
  it.each([{primaryCurrent:0},{secondaryCurrent:0},{burdenVA:-1},{finishedIdMm:0},{finishedOdMm:30},{accuracyClass:''},{primaryCurrent:'invalid'}])('rejects invalid form values %j', patch => {
    expect(createCalculatorInputs({...form(base),...patch},null,null)).toBeNull();
  });
  it('keeps blank max width unlimited and preserves an entered limit', () => {
    expect(fromForm(base).maxWidthMm).toBeNull();
    expect(createCalculatorInputs({...form(base),maxWidthMm:'25'},null,null)?.maxWidthMm).toBe(25);
  });
  it('forwards engineering settings without changing any numerical parameters', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../../scripts/fixtures/engineering.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '')) as DesignInputs;
    const result = createCalculatorInputs(form(fixture, true), fixture.engineering!, null);
    expect(result?.engineering).toEqual(fixture.engineering);
  });
});
