import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateRequestSchema, gaugeUpsertSchema } from '@meltek/schema';
import { DEFAULT_SETTINGS, computeWindingAllowance, resolveLayerPitchMm, seedReferenceData, solve, type DesignInputs } from '../src/index.js';
import { computeWindingBuild } from '../src/solve.js';
import { createCalculatorInputs } from '../../../apps/web/src/design/calculationInputs';
import { JsonStore } from '../../../apps/api/src/store/json-store';
import type { Design, StoredDesignInputs } from '../../../apps/api/src/store/types';
import { parseWindingConfiguration, serializeWindingConfiguration } from '../../../apps/api/src/store/winding-configuration';

const original=seedReferenceData();
const reference={...original,gauges:original.gauges.map(g=>({...g,layerPitchMm:null}))};
const gauge=reference.gauges.find(g=>g.swg===21)!;
const insulated=gauge.diaMm+DEFAULT_SETTINGS.wireInsulationMm;
const inputs: DesignInputs={primaryCurrent:1000,secondaryCurrent:5,burdenVA:5,accuracyClass:'0.5S',finishedIdMm:40,finishedOdMm:120,ctType:'ring',maxWidthMm:null};

describe('per-wire total winding layer pitch',()=>{
  it('rounds SWG 21 to 1 mm including the wire and air',()=>{
    expect(gauge.diaMm).toBe(.813);
    expect(resolveLayerPitchMm(gauge,insulated)).toBe(1);
  });
  it.each(reference.gauges.map(g=>[g.swg,g]))('rounds up safely for SWG %s',(_swg,g)=>{
    const diameter=g.diaMm+DEFAULT_SETTINGS.wireInsulationMm;
    const pitch=resolveLayerPitchMm(g,diameter)!;
    expect(pitch).toBe(Math.ceil(diameter-1e-9));
    expect(pitch+1e-9).toBeGreaterThanOrEqual(diameter);
  });
  it('uses a design override before the saved gauge default, without mutating either',()=>{
    const saved={...gauge,layerPitchMm:1.2};
    expect(resolveLayerPitchMm(saved,insulated)).toBe(1.2);
    expect(resolveLayerPitchMm(saved,insulated,{'21':1.4})).toBe(1.4);
    expect(resolveLayerPitchMm(saved,insulated,{})).toBe(1.2);
    expect(saved.layerPitchMm).toBe(1.2);
  });
  it.each([0,-1,.8,NaN,Infinity])('rejects invalid or undersized pitch %s',pitch=>{
    expect(()=>resolveLayerPitchMm(gauge,insulated,{'21':pitch})).toThrow();
  });
  it('preserves the historical behavior when a frozen reference has no pitch policy',()=>{
    const old=original.gauges.find(g=>g.swg===21)!;
    expect(resolveLayerPitchMm(old,insulated)).toBeUndefined();
    const oldResult=solve(inputs,original,DEFAULT_SETTINGS,'M-4',21);
    expect(oldResult.geometry.windingLayerPitchMm).toBeUndefined();
    expect(oldResult.geometry.windingBuildMm).toBeCloseTo(oldResult.geometry.windingLayers!*insulated+(oldResult.geometry.windingLayers!-1)*DEFAULT_SETTINGS.interLayerTapeMm,10);
  });
  it.each(['side-by-side','radial-stack'] as const)('keeps tape separate from wire and air for %s strands',arrangement=>{
    const r=computeWindingAllowance({turns:400,swg:21,wireDiaMm:insulated,layerPitchMm:1,bareDiaMm:.813,parallelStrands:2,boreIdMm:44,arrangement},{layerStackingFactorBySwg:{21:.95},interlayerThicknessMm:.1,minEpoxyThicknessMm:1});
    const strands=arrangement==='radial-stack'?2:1;
    expect(r.windingBuildMm).toBeCloseTo(r.layers*strands+(r.layers-1)*.1,10);
    expect(r.allowanceMm).toBeCloseTo(r.windingBuildMm+1,10);
  });
  it('uses the largest allocated pitch in mixed wire combinations',()=>{
    const entries=[{swg:21,count:2},{swg:22,count:1}];
    const result=computeWindingBuild(200,gauge,40,6,DEFAULT_SETTINGS,{entries,ref:reference},{'22':1.25})!;
    expect(result.layerPitchMm).toBe(1.25);
    expect(result.windingBuildMm).toBeCloseTo(result.layers*1.25+(result.layers-1)*DEFAULT_SETTINGS.interLayerTapeMm,10);
  });
  it('rejects a configured bundle that cannot fit instead of ignoring its winding build',()=>{
    expect(()=>computeWindingBuild(200,gauge,40,6,DEFAULT_SETTINGS,{entries:[{swg:21,count:1000}],ref:reference})).toThrow(/does not fit/);
  });
  it('updates core geometry and costs when only the design pitch changes',()=>{
    const a=solve(inputs,reference,DEFAULT_SETTINGS,'M-4',21);
    const b=solve({...inputs,layerPitchOverridesMm:{'21':1.4}},reference,DEFAULT_SETTINGS,'M-4',21);
    expect(a.geometry.windingLayers).toBeGreaterThan(1);
    expect(b.geometry.windingLayerPitchMm).toBe(1.4);
    expect(b.geometry.windingLayers).toBe(a.geometry.windingLayers);
    expect(b.geometry.windingBuildMm!-a.geometry.windingBuildMm!).toBeCloseTo(.4*a.geometry.windingLayers!,10);
    expect(b.geometry.coreIdMm).toBeGreaterThan(a.geometry.coreIdMm);
    expect(b.geometry.coreOdMm).toBeLessThan(a.geometry.coreOdMm);
    expect(b.totalCost).not.toBe(a.totalCost);
    for(const r of [a,b])expect(r.totalCost).toBeCloseTo(r.coreCost!+r.copperCost,10);
  });
  it('uses the same pitch in engineering construction and model geometry',()=>{
    const fixture=JSON.parse(readFileSync(new URL('../../../scripts/fixtures/engineering.json',import.meta.url),'utf8').replace(/^\uFEFF/,'')) as DesignInputs;
    fixture.engineering!.confirmed=true;
    fixture.layerPitchOverridesMm={'17':2.4};
    const r=solve(fixture,reference,DEFAULT_SETTINGS,'M-4',17);
    expect(r.geometry.windingLayerPitchMm).toBe(2.4);
    expect(r.engineering!.windingBuildMm).toBeCloseTo(r.engineering!.layers*2.4+(r.engineering!.layers-1)*fixture.engineering!.interlayerThicknessMm!,10);
    expect(r.geometry.windingBuildMm).toBe(r.engineering!.windingBuildMm);
  });
  it('carries overrides through the form adapter, request validation and SQL JSON formats',()=>{
    const combo=[{swg:21,count:2},{swg:22,count:1}];
    const adapted=createCalculatorInputs({...inputs,maxWidthMm:''},null,combo,{'21':1.4})!;
    expect(adapted.layerPitchOverridesMm).toEqual({'21':1.4});
    const request=calculateRequestSchema.parse(JSON.parse(JSON.stringify({inputs:adapted})));
    expect(request.inputs.layerPitchOverridesMm).toEqual({'21':1.4});
    const serialized=serializeWindingConfiguration(adapted as StoredDesignInputs);
    for(const value of [serialized,JSON.parse(serialized)])expect(parseWindingConfiguration(value)).toEqual({wireCombination:combo,layerPitchOverridesMm:{'21':1.4}});
    expect(parseWindingConfiguration(null)).toEqual({wireCombination:null,layerPitchOverridesMm:null});
    expect(gaugeUpsertSchema.parse(gauge).layerPitchMm).toBeNull();
  });
  it('persists per-gauge defaults, calculation overrides and frozen reference snapshots across restarts',async()=>{
    const file=join(tmpdir(),`meltek-layer-pitch-${randomUUID()}.json`);
    let store=new JsonStore(file);
    try{
      await store.init();
      expect((await store.getReference()).gauges.find(g=>g.swg===21)?.layerPitchMm).toBeNull();
      await store.saveGauge({...gauge,layerPitchMm:1.2});
      const snapshot=await store.getReference();
      const design: Design={id:randomUUID(),designNo:'PITCH-TEST',revision:1,customerId:null,customerName:'Pitch test',enquiryNo:null,poNo:null,prdNo:null,quantity:null,requiredBy:null,insulationType:null,inputs:{...inputs,maxWidthMm:null,wireCombination:[{swg:21,count:1}],layerPitchOverridesMm:{'21':1.4}},settingsSnapshot:DEFAULT_SETTINGS,referenceSnapshot:snapshot,status:'draft',selectedOptionId:null,createdBy:'test',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),approvedBy:null,approvedAt:null,supersededById:null,supersedesId:null};
      await store.createDesign(design);
      await store.saveGauge({...gauge,layerPitchMm:1.8});
      await store.close();store=new JsonStore(file);await store.init();
      const saved=(await store.getDesign(design.id))!;
      expect((await store.getReference()).gauges.find(g=>g.swg===21)?.layerPitchMm).toBe(1.8);
      expect(saved.referenceSnapshot!.gauges.find(g=>g.swg===21)?.layerPitchMm).toBe(1.2);
      expect(saved.inputs.layerPitchOverridesMm).toEqual({'21':1.4});
      expect(saved.inputs.wireCombination).toEqual([{swg:21,count:1}]);
      expect(solve(saved.inputs,saved.referenceSnapshot!,saved.settingsSnapshot!,'M-4',21)).toEqual(solve(design.inputs,snapshot,DEFAULT_SETTINGS,'M-4',21));
    }finally{await store.close();await unlink(file).catch(()=>undefined);}
  });
});
