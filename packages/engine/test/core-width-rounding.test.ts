import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateRequestSchema } from '@meltek/schema';
import { DEFAULT_SETTINGS, optimise, roundToSlitWidth, seedReferenceData, solve, type DesignInputs } from '../src/index.js';
const reference = seedReferenceData();
const inputs: DesignInputs = { primaryCurrent:300,secondaryCurrent:5,burdenVA:5,accuracyClass:'0.5S',finishedIdMm:40,finishedOdMm:75,ctType:'ring' };
const settings = (percent = 1) => ({...DEFAULT_SETTINGS,slitStepMm:5,coreWidthRoundingTolerancePercent:percent});

describe('configurable core-width rounding', () => {
  it.each([[10.1,10],[11,15],[14.8,15],[10,10],[15,15],[10.10001,15],[20.2,20],[20.20001,25],[.2,5],[4.9,5]])('rounds %s mm to %s mm with the default 1% tolerance', (width, expected) => {
    expect(roundToSlitWidth(width,reference,settings())).toBe(expected);
  });
  it.each([[10.5,10],[10.50001,15],[21,20],[21.00001,25],[14.8,15]])('honours a user-set 5%% tolerance for %s mm', (width, expected) => {
    expect(roundToSlitWidth(width,reference,settings(5))).toBe(expected);
  });
  it('lets the user dynamically change the percentage without changing stacking factor', () => {
    expect(roundToSlitWidth(11,reference,settings(1))).toBe(15);
    expect(roundToSlitWidth(11,reference,settings(10))).toBe(10);
    expect(settings(10).stackingFactor).toBe(DEFAULT_SETTINGS.stackingFactor);
  });
  it.each([[10,10],[10.0001,15],[14.8,15],[15,15]])('zero tolerance always rounds up: %s → %s', (width, expected) => {
    expect(roundToSlitWidth(width,reference,settings(0))).toBe(expected);
  });
  it('respects eligible stocked multiples of the configured step', () => {
    const stock={...reference,slitWidthsMm:[13,20,25,40]};
    expect(roundToSlitWidth(11,stock,settings())).toBe(20);
    expect(roundToSlitWidth(26.28,stock,settings())).toBe(40);
    expect(roundToSlitWidth(26.28,stock,settings(10))).toBe(25);
  });
  it.each([-1,101,NaN,Infinity])('rejects invalid rounding percentage %s', percent => {
    expect(() => roundToSlitWidth(11,reference,settings(percent))).toThrow();
    expect(() => optimise(inputs,reference,settings(percent))).toThrow();
  });
  it.each([0,-1,NaN,Infinity])('does not produce invalid ordered widths from %s', width => {
    expect(() => roundToSlitWidth(width,reference,settings())).toThrow();
  });
  it('recalculates geometry, copper, steel and price from the rounded width', () => {
    const a=solve(inputs,reference,settings(1),'M-4',17);
    const b=solve(inputs,reference,settings(20),'M-4',17);
    expect(a.coreWidthMm).toBe(b.coreWidthMm);
    expect(a.coreAreaCm2).toBe(b.coreAreaCm2);
    expect(a.orderedWidthMm).toBe(20);
    expect(b.orderedWidthMm).toBe(15);
    expect(a.copperWeightKg).not.toBe(b.copperWeightKg);
    expect(a.coreWeightKg).not.toBe(b.coreWeightKg);
    for (const r of [a,b]) {
      const grade=reference.grades.find(g=>g.code==='M-4')!;
      const wire=reference.gauges.find(g=>g.swg===17)!;
      const wireLength=((r.geometry.coreOdMm-r.geometry.coreIdMm+2*r.orderedWidthMm)*DEFAULT_SETTINGS.lengthFactor*r.geometry.turns+DEFAULT_SETTINGS.leadWireMm)/1000;
      expect(r.geometry.radialBuildMm*r.orderedWidthMm/100).toBeCloseTo(r.coreAreaCm2,10);
      expect(r.copperWeightKg).toBeCloseTo(wireLength*wire.gramPerM/1000,10);
      expect(r.coreCost).toBeCloseTo(r.coreWeightKg*grade.ratePerKg!,10);
      expect(r.totalCost).toBeCloseTo(r.coreCost!+r.copperCost,10);
    }
  });
  it('applies to every calculated grade in automatic and fixed-wire searches', () => {
    for (const wireCombination of [null,[{swg:21,count:2},{swg:22,count:1}]]) {
      for (const percent of [0,1,5,20]) {
        const result=optimise({...inputs,wireCombination},reference,settings(percent));
        expect(result.options).toHaveLength(reference.grades.length);
        for (const option of result.options.filter(o=>o.converged)) expect(option.orderedWidthMm/5).toBeCloseTo(Math.round(option.orderedWidthMm/5),10);
      }
    }
  });
  it('leaves historical snapshots on their original nearest-width rule', () => {
    const old={...DEFAULT_SETTINGS};delete old.coreWidthRoundingTolerancePercent;
    const frozen=JSON.parse(JSON.stringify(old));
    expect(roundToSlitWidth(11,reference,frozen)).toBe(10);
    expect(roundToSlitWidth(11,reference,settings())).toBe(15);
    expect(frozen.coreWidthRoundingTolerancePercent).toBeUndefined();
  });
  it('revalidates engineering electrical limits after rounding down', () => {
    const input=JSON.parse(readFileSync(new URL('../../../scripts/fixtures/engineering.json',import.meta.url),'utf8').replace(/^\uFEFF/,'')) as DesignInputs;
    input.engineering!.confirmed=true;
    const ref={...reference,slitWidthsMm:Array.from({length:80},(_,i)=>(i+1)*5),dies:[{id:'test',dieNo:'TEST',minOdMm:1,maxOdMm:500,maxWidthMm:500,quantity:1,isAvailable:true}]};
    for(const percent of [0,1,20,100]) {
      const result=solve(input,ref,settings(percent),'M-4',17);
      expect(result.orderedWidthMm/5).toBeCloseTo(Math.round(result.orderedWidthMm/5),10);
      expect(result.bUsedT).toBeLessThanOrEqual(input.engineering!.materials.find(m=>m.gradeCode==='M-4')!.workingFluxT+1e-8);
      expect(result.engineering!.issues).toEqual([]);
    }
  });
  it('carries the percentage through the API schema without discarding it', () => {
    expect(calculateRequestSchema.parse({inputs,settingsOverride:{coreWidthRoundingTolerancePercent:5}}).settingsOverride?.coreWidthRoundingTolerancePercent).toBe(5);
    expect(()=>calculateRequestSchema.parse({inputs,settingsOverride:{coreWidthRoundingTolerancePercent:101}})).toThrow();
  });
});
