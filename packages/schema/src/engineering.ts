import { z } from 'zod';
const positive = z.number().finite().positive();
const nonnegative = z.number().finite().nonnegative();
const thickness = z.object({ type: z.string().min(1), thicknessMm: nonnegative.nullable() });
export const engineeringSpecSchema = z.object({
  purpose: z.enum(['metering', 'protection', 'ps']),
  standard: z.string().max(300), confirmed: z.boolean(),
  frequencyHz: positive.max(1000),
  roomTemperatureC: z.number().finite().min(-50).max(200),
  operatingTemperatureC: z.number().finite().min(-50).max(200),
  copperTemperatureConstant: positive.min(200).max(300),
  burdenPowerFactor: positive.max(1), leadResistanceOhm: nonnegative,
  parallelStrands: positive.int().max(20), strandArrangement: z.enum(['side-by-side', 'radial-stack']),
  selectedSwg: positive.int().nullable(),
  coreInsulation: thickness, outerInsulation: thickness,
  interlayerThicknessMm: nonnegative.nullable(), interlayerType: z.string(),
  wires: z.array(z.object({ swg: positive.int(), insulatedDiameterMm: positive, packingFactor: positive.max(1) })).max(100),
  materials: z.array(z.object({
    gradeCode: z.string().min(1), workingFluxT: positive,
    saturationFluxT: positive.nullable(), kneeFluxT: positive.nullable(),
    lossCurve: z.array(z.object({ fluxT: positive, lossAtCm: nonnegative, magnetisingAtCm: nonnegative })).max(500),
  })).max(100),
  allowedAtLoss: positive.nullable(), accuracyLimitFactor: positive.min(1).nullable(),
  maxCompositeErrorPercent: positive.max(100).nullable(), requiredKneeVoltage: positive.nullable(),
  maxExcitationCurrentA: positive.nullable(), excitationCheckVoltage: positive.nullable(),
  maxResistance75Ohm: positive.nullable(), psVoltageFactor: positive.nullable(),
  testPoints: z.array(z.object({ currentPercent: positive, burdenPercent: nonnegative, maxRatioErrorPercent: positive, maxPhaseMinutes: positive })).max(30),
  costing: z.object({ basis: z.enum(['material', 'manufacturing']), insulationPerUnit: nonnegative.nullable(), resinPerUnit: nonnegative.nullable(), labourPerUnit: nonnegative.nullable(), overheadPerUnit: nonnegative.nullable(), steelWastePercent: nonnegative.max(100), copperWastePercent: nonnegative.max(100) }),
}).superRefine((v, ctx) => {
  if (new Set(v.wires.map(w => w.swg)).size !== v.wires.length) ctx.addIssue({ code: 'custom', path: ['wires'], message: 'Each SWG must have exactly one construction row.' });
  if (new Set(v.materials.map(m => m.gradeCode)).size !== v.materials.length) ctx.addIssue({ code: 'custom', path: ['materials'], message: 'Each grade must have exactly one magnetic row.' });
  v.materials.forEach((m, i) => { if (m.lossCurve.some((p, j) => j > 0 && p.fluxT <= m.lossCurve[j - 1]!.fluxT)) ctx.addIssue({ code: 'custom', path: ['materials', i, 'lossCurve'], message: 'Flux points must be strictly increasing.' }); });
});
