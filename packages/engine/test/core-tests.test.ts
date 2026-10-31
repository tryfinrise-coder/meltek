import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCoreTests, interpolateH, mergeCoreTestPoints, seedReferenceData } from '../src/index.js';
import { JsonStore } from '../../../apps/api/src/store/json-store';
import { gradeUpsertSchema } from '@meltek/schema';

const curve=[{teslaT:.01,hAtCm:.01},{teslaT:.7734,hAtCm:.2},{teslaT:.92808,hAtCm:.3},{teslaT:1,hAtCm:.35}];
const input={flux100T:.7734,areaCm2:2,coreIdMm:49,coreOdMm:65,accuracyClass:'0.5S',frequencyHz:50,curve};

describe('core test voltages and evaluated AT/cm data',()=>{
  it('uses the confirmed percentage factors and final core dimensions',()=>{
    const r=calculateCoreTests(input);
    expect(r.coefficient).toBeCloseTo(.0222,12);
    expect(r.mmlCm).toBeCloseTo(17.90707812546182,12);
    expect(r.points.map(p=>p.percent)).toEqual([120,100,20,5,1]);
    for(const [index,expected] of [.92808,.7734,.15468,.03867,.007734].entries())expect(r.points[index]!.fluxT).toBeCloseTo(expected,12);
    const baseline=r.points.find(p=>p.percent===100)!;
    expect(baseline.tests.map(t=>t.turns)).toEqual([5,10,15]);
    expect(baseline.tests[0]!.voltageV).toBeCloseTo(.1716948,12);
    expect(baseline.tests[1]!.voltageV).toBeCloseTo(.3433896,12);
    expect(baseline.tests[2]!.voltageV).toBeCloseTo(.5150844,12);
    for(const point of r.points)for(let i=0;i<3;i++)expect(point.tests[i]!.voltageV).toBeCloseTo(baseline.tests[i]!.voltageV*point.percent/100,12);
  });
  it.each(['0.5','0.2','0.2S','1','3'])('excludes the 1%% test for class %s',accuracyClass=>{
    expect(calculateCoreTests({...input,accuracyClass}).points.map(p=>p.percent)).toEqual([120,100,20,5]);
  });
  it('calculates current from the selected material and the independent test turns',()=>{
    const baseline=calculateCoreTests(input).points.find(p=>p.percent===100)!;
    expect(baseline.hAtCm).toBe(.2);
    for(const test of baseline.tests)expect(test.currentLimitA).toBeCloseTo(.2*Math.PI*57/10/test.turns,12);
    const different=calculateCoreTests({...input,curve:curve.map(p=>({...p,hAtCm:p.hAtCm*2}))}).points.find(p=>p.percent===100)!;
    expect(different.tests[0]!.currentLimitA).toBeCloseTo(baseline.tests[0]!.currentLimitA!*2,12);
    expect(different.tests[0]!.voltageV).toBe(baseline.tests[0]!.voltageV);
  });
  it('does not invent a current limit below the available curve',()=>{
    const p=calculateCoreTests(input).points.find(p=>p.percent===1)!;
    expect(p.hAtCm).toBeNull();
    expect(p.tests.every(t=>t.currentLimitA===null)).toBe(true);
    expect(p.tests.every(t=>t.voltageV>0)).toBe(true);
    expect(interpolateH(curve,2)).toBeNull();
    expect(interpolateH(curve,NaN)).toBeNull();
  });
  it('uses entered low-flux data immediately and leaves the original material unchanged',()=>{
    const flux=input.flux100T*.01;
    const merged=mergeCoreTestPoints(curve,[{teslaT:flux,hAtCm:.002}]);
    const p=calculateCoreTests({...input,curve:merged}).points.find(p=>p.percent===1)!;
    expect(p.hAtCm).toBe(.002);
    for(const test of p.tests)expect(test.currentLimitA).toBeCloseTo(.002*Math.PI*57/10/test.turns,12);
    expect(curve).toHaveLength(4);
    expect(merged[0]).toEqual({teslaT:flux,hAtCm:.002});
    expect(calculateCoreTests(input).points.find(p=>p.percent===1)!.hAtCm).toBeNull();
  });
  it('interpolates only between known points, including a newly evaluated point',()=>{
    expect(interpolateH([{teslaT:.005,hAtCm:.001},{teslaT:.01,hAtCm:.003}],.0075)).toBeCloseTo(.002,12);
    expect(interpolateH([{teslaT:.005,hAtCm:.001}],.005)).toBe(.001);
    expect(interpolateH([{teslaT:.005,hAtCm:.001}],.006)).toBeNull();
    expect(interpolateH([{teslaT:.005,hAtCm:null}],.005)).toBeNull();
    expect(interpolateH([],.005)).toBeNull();
  });
  it('updates an existing point without duplicating it or changing other points',()=>{
    const merged=mergeCoreTestPoints(curve,[{teslaT:.7734,hAtCm:.25}]);
    expect(merged).toHaveLength(curve.length);
    expect(merged.find(p=>p.teslaT===.7734)!.hAtCm).toBe(.25);
    expect(merged[0]).toEqual(curve[0]);
    expect(curve[1]!.hAtCm).toBe(.2);
  });
  it.each([0,-.01,NaN,Infinity,null])('rejects invalid manufacturer AT/cm value %s',hAtCm=>{
    expect(()=>mergeCoreTestPoints(curve,[{teslaT:.005,hAtCm}])).toThrow();
  });
  it.each([0,-1,NaN,Infinity])('rejects invalid measured flux %s',teslaT=>{
    expect(()=>mergeCoreTestPoints(curve,[{teslaT,hAtCm:.001}])).toThrow();
  });
  it('uses the configured frequency while retaining the confirmed scaling',()=>{
    const a=calculateCoreTests(input),b=calculateCoreTests({...input,frequencyHz:60});
    expect(b.points[0]!.tests[0]!.voltageV).toBeCloseTo(a.points[0]!.tests[0]!.voltageV*1.2,12);
    expect(b.points[0]!.tests[0]!.currentLimitA).toBe(a.points[0]!.tests[0]!.currentLimitA);
  });
  it.each([.58839215,.7734368592152763,.123456789])('retains low-flux database precision for B100=%s',flux100T=>{
    const fluxT=flux100T*.01;
    // MySQL stores these curve fields as DECIMAL(30,20); JSON/Postgres retain
    // the same supplied numeric value. Six decimal places can lose coverage.
    const restored={teslaT:Number(fluxT.toFixed(20)),hAtCm:Number(.000123456789.toFixed(20))};
    const report=calculateCoreTests({...input,flux100T,curve:mergeCoreTestPoints(curve,[restored])});
    expect(report.points.find(p=>p.percent===1)!.hAtCm).toBe(.000123456789);
  });
  it.each(['flux100T','areaCm2','coreIdMm','coreOdMm','frequencyHz'] as const)('rejects invalid %s',key=>{
    expect(()=>calculateCoreTests({...input,[key]:0})).toThrow();
  });
  it('rejects impossible core dimensions',()=>{
    expect(()=>calculateCoreTests({...input,coreOdMm:49})).toThrow();
  });
  it('retains evaluated low-flux points, grade metadata and frozen snapshots after restart',async()=>{
    const file=join(tmpdir(),`meltek-core-tests-${randomUUID()}.json`);
    let store=new JsonStore(file);
    try{
      await store.init();
      const snapshot=await store.getReference();
      const grade=snapshot.grades.find(g=>g.code==='23-MOH')!;
      const flux=input.flux100T*.01;
      const updated={...grade,curve:mergeCoreTestPoints(grade.curve,[{teslaT:flux,hAtCm:.002}])};
      expect(gradeUpsertSchema.safeParse(updated).success).toBe(true);
      await store.saveGrade(updated);await store.close();
      store=new JsonStore(file);await store.init();
      const restored=(await store.getReference()).grades.find(g=>g.code===grade.code)!;
      expect(restored.label).toBe(grade.label);
      expect(restored.ratePerKg).toBe(grade.ratePerKg);
      expect(interpolateH(restored.curve,flux)).toBe(.002);
      expect(snapshot.grades.find(g=>g.code===grade.code)!.curve.some(p=>p.teslaT===flux)).toBe(false);
      expect(calculateCoreTests({...input,curve:restored.curve}).points.find(p=>p.percent===1)!.tests[0]!.currentLimitA).toBeGreaterThan(0);
    }finally{await store.close();await unlink(file).catch(()=>undefined);}
  });
});
