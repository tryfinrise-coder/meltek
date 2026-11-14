import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { solve, optimise, computeWindingAllowance, fitLayers, resistanceAtTemperature, DEFAULT_SETTINGS as LIVE_DEFAULT_SETTINGS, seedReferenceData, type DesignInputs, type EngineeringSpec } from '../src/index.js';

// Preserve the established baseline; tolerance rounding is tested separately.
const DEFAULT_SETTINGS = { ...LIVE_DEFAULT_SETTINGS };
delete DEFAULT_SETTINGS.coreWidthRoundingTolerancePercent;
const fixture = JSON.parse(readFileSync(new URL('../../../scripts/fixtures/engineering.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '')) as DesignInputs;
const make = () => { const i=structuredClone(fixture); i.engineering!.confirmed=true; return i; };
const reference = () => ({ ...seedReferenceData(), slitWidthsMm: Array.from({length:80},(_,i)=>(i+1)*5), dies:[{id:'test',dieNo:'TEST ONLY',minOdMm:1,maxOdMm:500,maxWidthMm:500,quantity:1,isAvailable:true}] });
const run=(i=make())=>solve(i,reference(),DEFAULT_SETTINGS,'M-4',17);
const change=(p:Partial<EngineeringSpec>)=>{const i=make();Object.assign(i.engineering!,p);return i;};

describe('construction and electrical engineering',()=>{
 it('indexes packing factors by SWG and rounds turn capacity down',()=>{
  const r=computeWindingAllowance({turns:100,swg:17,wireDiaMm:1.5,bareDiaMm:1.42,parallelStrands:1,boreIdMm:42},{layerStackingFactorBySwg:{17:0.9},interlayerThicknessMm:0.1,minEpoxyThicknessMm:1});
  expect(r.turnsPerLayer).toBe(Math.floor(Math.PI*(42+2*3.1)/(1.42/.9)));
  expect(r.layers).toBe(2);expect(r.windingBuildMm).toBeCloseTo(3.1);
 });
 it('measures the layer circumference on the core side, trying one layer first',()=>{
  // 250/5 A, finished ID 40 + resin 4, bundle 1x21 + 2x22 + 1x23 = 2.845 mm copper, 1 mm layers.
  const build=(n:number)=>n;
  expect(fitLayers(50,44,2.845,build)).toEqual({layers:1,spaceLayers:1,turnsPerLayer:50,boreMm:46});
  expect(fitLayers(50,44,2.845/.95,build)).toEqual({layers:1,spaceLayers:2,turnsPerLayer:50,boreMm:48});
  expect(fitLayers(50,0.1,2.845,()=>0)).toBeNull();
 });
 it('lets a design override the packing factor',()=>{
  const i:DesignInputs={primaryCurrent:250,secondaryCurrent:5,burdenVA:5,accuracyClass:'0.5S',finishedIdMm:40,finishedOdMm:75,ctType:'ring',wireCombination:[{swg:21,count:1},{swg:22,count:2},{swg:23,count:1}]};
  const saved=solve(i,reference(),DEFAULT_SETTINGS,'M-4',21).geometry, tight=solve({...i,windingPackingFactor:1},reference(),DEFAULT_SETTINGS,'M-4',21).geometry;
  expect([saved.windingLayers,tight.windingLayers]).toEqual([1,1]);
  expect(tight.windingBuildMm).toBeLessThan(saved.windingBuildMm!);
  expect(()=>solve({...i,windingPackingFactor:1.2},reference(),DEFAULT_SETTINGS,'M-4',21)).toThrow(/Packing factor/);
 });
 it('does not silently substitute a packing factor for an unknown gauge',()=>{
  expect(()=>computeWindingAllowance({turns:60,swg:18,wireDiaMm:1.5,bareDiaMm:1.42,parallelStrands:1,boreIdMm:42},{layerStackingFactorBySwg:{17:0.9},interlayerThicknessMm:0.1,minEpoxyThicknessMm:1})).toThrow(/packing/);
 });
 it('distinguishes side-by-side from radially stacked strands',()=>{
  const side=run(change({parallelStrands:2}));const radial=run(change({parallelStrands:2,strandArrangement:'radial-stack'}));
  expect(side.engineering!.turnsPerLayer).toBeLessThan(radial.engineering!.turnsPerLayer);
  expect(radial.engineering!.windingBuildMm).toBeGreaterThan(0);
 });
 it('converts per-side build to a diameter allowance exactly once',()=>{
  const r=run();const build=.3+r.engineering!.windingBuildMm+1;
  expect(r.geometry.coreIdMm).toBeCloseTo(40+2*build);
  expect(r.geometry.coreOdMm).toBeCloseTo(120-2*build);
  expect(r.engineering!.finishedWidthMm).toBeCloseTo(r.orderedWidthMm+2*build);
 });
 it('passes calculated winding construction to the model geometry',()=>{
  const r=run(change({parallelStrands:2}));
  expect(r.geometry.windingLayers).toBe(r.engineering!.layers);
  expect(r.geometry.turnsPerLayer).toBe(r.engineering!.turnsPerLayer);
  expect(r.geometry.windingBuildMm).toBe(r.engineering!.windingBuildMm);
  expect(r.geometry.windingLayers).toBeGreaterThan(1);
 });
 it('uses effective steel area including stacking in the EMF equation',()=>{
  const r=run();const area=r.finalAreaCm2*DEFAULT_SETTINGS.stackingFactor;
  expect(r.engineering!.effectiveAreaCm2).toBeCloseTo(area);
  expect(r.bUsedT).toBeCloseTo(r.vTotal/(4.44*50*60*area*1e-4));
 });
 it('uses complex burden impedance rather than adding reactive volts arithmetically',()=>{
  const r=run();const z=5/25;const real=r.engineering!.resistanceOperatingOhm+0.02+z*.8;
  expect(r.vTotal).toBeCloseTo(5*Math.hypot(real,z*.6));
 });
 it('corrects resistance between specified temperatures',()=>{
  expect(resistanceAtTemperature(1,20,75,234.5)).toBeCloseTo(309.5/254.5,12);
  expect(resistanceAtTemperature(2,75,20,234.5)).toBeCloseTo(2*254.5/309.5,12);
 });
 it('honours measured/reference R75 when supplied',()=>{
  const ref=reference();ref.gauges.find(w=>w.swg===17)!.ohmPerM75c=.123;
  const r=solve(make(),ref,DEFAULT_SETTINGS,'M-4',17);
  expect(r.engineering!.resistance75Source).toBe('reference');
  expect(r.engineering!.resistance75Ohm).toBeCloseTo(r.engineering!.wireLengthPerStrandM*.123);
 });
 it('includes all parallel-strand copper but divides electrical resistance',()=>{
  const r=run(change({parallelStrands:2}));const g=reference().gauges.find(w=>w.swg===17)!;
  expect(r.engineering!.totalWireLengthM).toBeCloseTo(r.engineering!.wireLengthPerStrandM*2);
  expect(r.copperWeightKg).toBeCloseTo(r.engineering!.totalWireLengthM*g.gramPerM/1000);
  expect(r.engineering!.resistance20Ohm).toBeCloseTo(r.engineering!.wireLengthPerStrandM*g.ohmPerM20c/2);
 });
 it('calculates manufacturing total from explicitly entered extras and wastage',()=>{
  const r=run();expect(r.totalCost).toBeCloseTo(r.coreCost!+r.copperCost+25);
  const g=reference().grades.find(g=>g.code==='M-4')!;
  expect(r.coreCost).toBeCloseTo(r.coreWeightKg*g.ratePerKg!*1.05);
 });
 it('refuses to rank incomplete manufacturing cost',()=>{
  const i=make();i.engineering!.costing.labourPerUnit=null;
  expect(run(i).totalCost).toBeNull();
  expect(optimise(i,reference(),DEFAULT_SETTINGS).options.every(o=>o.rank===null)).toBe(true);
 });
 it('requires engineering confirmation before ranking',()=>{
  const i=change({confirmed:false});const result=optimise(i,reference(),DEFAULT_SETTINGS);
  expect(result.options.every(o=>o.rank===null)).toBe(true);
  expect(run(i).engineering!.issues.join(' ')).toMatch(/confirmation/);
 });
 it('ranks a complete synthetic configuration and preserves reporting',()=>{
  const r=run();expect(r.engineering!.issues).toEqual([]);
  expect(optimise(make(),reference(),DEFAULT_SETTINGS).options[0]!.rank).toBe(1);
  expect(r.engineering!.checks.every(c=>c.passed)).toBe(true);
 });
 it('checks ratio and phase against separate limits',()=>{
  const i=make();i.engineering!.testPoints[0]!.maxPhaseMinutes=1e-9;
  expect(run(i).engineering!.checks[0]!.passed).toBe(false);
 });
 it('does not extrapolate excitation curves',()=>{
  const i=make();i.engineering!.materials[0]!.lossCurve[0]!.fluxT=1.5;
  const r=run(i);expect(r.engineering!.excitationCurrentA).toBeNull();expect(r.engineering!.issues.length).toBeGreaterThan(0);
 });
 it('uses the fault operating point for protection screening even with a separate excitation check voltage',()=>{
  const i=change({purpose:'protection',excitationCheckVoltage:1});i.accuracyClass='5P';const r=run(i);
  expect(r.engineering!.voltageAtLimit).toBeCloseTo(r.vTotal*10);
  expect(r.engineering!.compositeErrorEstimatePercent).not.toBeNull();
  expect(r.engineering!.issues).toEqual([]);
 });
 it('requires protection requirements rather than reusing metering class constants',()=>{
  const i=change({purpose:'protection',accuracyLimitFactor:null});i.accuracyClass='5P';expect(()=>run(i)).toThrow(/limit factor/);
 });
 it('sizes PS from both required Vk and the resistance-related formula',()=>{
  const i=change({purpose:'ps',burdenPowerFactor:1,excitationCheckVoltage:10});i.accuracyClass='PS';const r=run(i);const report=r.engineering!;
  expect(report.issues).toEqual([]);
  expect(report.effectiveAreaCm2).toBeGreaterThanOrEqual(report.areaFromKneeCm2!);
  expect(report.effectiveAreaCm2).toBeGreaterThanOrEqual(report.areaFromResistanceCm2!);
  expect(report.kneeVoltage).toBeGreaterThanOrEqual(10);
 });
 it('does not accept a reactive burden in the resistive PS formula',()=>{
  const i=change({purpose:'ps',excitationCheckVoltage:10});i.accuracyClass='PS';expect(run(i).engineering!.issues.join(' ')).toMatch(/resistive/);
 });
 it('compares the finished width with the user limit',()=>{
  const i=make();i.maxWidthMm=run(i).orderedWidthMm;
  const o=optimise(i,reference(),DEFAULT_SETTINGS).options.find(o=>o.gradeCode==='M-4'&&o.swg===17)!;
  expect(o.isFeasible).toBe(false);expect(o.infeasibleReasons.join(' ')).toMatch(/Finished width/);
 });
 it('rejects insulated diameters smaller than bare copper',()=>{
  const i=make();i.engineering!.wires[0]!.insulatedDiameterMm=.1;expect(()=>run(i)).toThrow(/bare wire/);
 });
 it('requires stocked slits and tooling for engineering ranking',()=>{
  const r=solve(make(),seedReferenceData(),DEFAULT_SETTINGS,'M-4',17);expect(r.engineering!.issues.join(' ')).toMatch(/die\/tooling/);expect(r.engineering!.issues.join(' ')).toMatch(/Stocked slit/);
 });
 it('protection codes cannot enter the legacy metering solver',()=>{
  const i=make();delete i.engineering;i.accuracyClass='5P';expect(()=>run(i)).toThrow(/require engineering/);
 });
});
