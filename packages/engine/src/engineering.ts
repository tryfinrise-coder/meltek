import { EngineError, MissingReferenceData, type DesignInputs, type ProcessSettings, type ReferenceData, type SolveResult } from './types.js';
import type { EngineeringReport, EngineeringSpec } from './engineeringTypes.js';
import { computeWindingAllowance } from './winding.js';
import { positive, validateDesign } from './validate.js';

/** Copper DC resistance correction; temperature constant is explicit and persisted. */
export function resistanceAtTemperature(resistance: number, fromC: number, toC: number, constant: number): number {
  positive(resistance, 'Resistance', true);
  if (![fromC, toC, constant].every(Number.isFinite) || constant + fromC <= 0 || constant + toC <= 0) throw new EngineError('INVALID_INPUT', 'Invalid resistance correction temperature.');
  return resistance * (constant + toC) / (constant + fromC);
}

function missing(label: string): never { throw new MissingReferenceData(`${label} must be supplied for engineering mode.`); }
function required(n: number | null, label: string, zero = false): number { if (n == null) return missing(label); positive(n, label, zero); return n; }
function interpolateLoss(curve: EngineeringSpec['materials'][number]['lossCurve'], flux: number) {
  if (!curve.length || flux < curve[0]!.fluxT || flux > curve[curve.length - 1]!.fluxT) return null;
  const upper = curve.findIndex(p => p.fluxT >= flux);
  if (upper === 0) return curve[0]!;
  const a = curve[upper - 1]!; const b = curve[upper]!;
  const fraction = (flux - a.fluxT) / (b.fluxT - a.fluxT);
  return { fluxT: flux, lossAtCm: a.lossAtCm + fraction * (b.lossAtCm - a.lossAtCm), magnetisingAtCm: a.magnetisingAtCm + fraction * (b.magnetisingAtCm - a.magnetisingAtCm) };
}

/** Engineering screening, deliberately separate from legacy spreadsheet reproduction. */
export function solveEngineering(inputs: DesignInputs, ref: ReferenceData, settings: ProcessSettings, gradeCode: string, swg: number): SolveResult {
  validateDesign(inputs, settings);
  const e = inputs.engineering!;
  if (!['metering','protection','ps'].includes(e.purpose)) throw new EngineError('INVALID_INPUT', 'Unknown CT purpose.');
  if (inputs.ctType !== 'ring') throw new EngineError('UNSUPPORTED_CT_TYPE', 'Engineering mode currently supports ring CTs.');
  if (e.selectedSwg !== null && swg !== e.selectedSwg) throw new EngineError('INVALID_INPUT', 'Not the specified SWG.');
  if (e.purpose === 'protection' && !['5P','10P'].includes(inputs.accuracyClass)) throw new EngineError('INVALID_INPUT', 'Select 5P or 10P for protection design.');
  if (e.purpose === 'ps' && !['PS','PX'].includes(inputs.accuracyClass)) throw new EngineError('INVALID_INPUT', 'Select PS or PX for special protection design.');
  if (e.purpose === 'metering' && !ref.classes.some(c => c.code === inputs.accuracyClass)) throw new EngineError('UNKNOWN_CLASS', 'Select a characterised metering class.');
  const grade = ref.grades.find(g => g.code === gradeCode); const gauge = ref.gauges.find(g => g.swg === swg);
  if (!grade || !gauge) throw new EngineError('INVALID_INPUT', 'Unknown grade or gauge.');
  const wire = e.wires.find(w => w.swg === swg);
  const material = e.materials.find(m => m.gradeCode === gradeCode);
  if (!wire) return missing(`Insulated diameter and packing for SWG ${swg}`);
  if (!material) return missing(`Magnetic design data for ${gradeCode}`);
  if (wire.insulatedDiameterMm < gauge.diaMm) throw new EngineError('INVALID_INPUT', 'Insulated wire diameter cannot be less than bare wire diameter.');
  for (const [name, value] of Object.entries({ frequency: e.frequencyHz, powerFactor: e.burdenPowerFactor, strands: e.parallelStrands, workingFlux: material.workingFluxT, resistance: gauge.ohmPerM20c, wireMass: gauge.gramPerM, copperConstant: e.copperTemperatureConstant })) positive(value, name);
  positive(e.leadResistanceOhm, 'Lead resistance', true);
  if (e.burdenPowerFactor > 1 || !Number.isInteger(e.parallelStrands) || e.parallelStrands > 20) throw new EngineError('INVALID_INPUT', 'Invalid power factor or parallel strand count.');
  material.lossCurve.forEach((p, i) => {
    positive(p.fluxT, 'Curve flux'); positive(p.lossAtCm, 'In-phase excitation', true); positive(p.magnetisingAtCm, 'Magnetising excitation', true);
    if (i && p.fluxT <= material.lossCurve[i-1]!.fluxT) throw new EngineError('INVALID_INPUT', 'Loss curve flux points must increase strictly.');
  });
  const coreCover = required(e.coreInsulation.thicknessMm, 'Installed core insulation per side', true);
  const outerCover = required(e.outerInsulation.thicknessMm, 'Installed outer insulation per side', true);
  const N = inputs.primaryCurrent / inputs.secondaryCurrent;
  const winding = computeWindingAllowance({ turns: N, swg, wireDiaMm: wire.insulatedDiameterMm, parallelStrands: e.parallelStrands, boreIdMm: inputs.finishedIdMm + 2 * outerCover, arrangement: e.strandArrangement }, { layerStackingFactorBySwg: { [swg]: wire.packingFactor }, interlayerThicknessMm: e.interlayerThicknessMm, minEpoxyThicknessMm: outerCover });
  const perSide = coreCover + winding.windingBuildMm + outerCover;
  const coreId = inputs.finishedIdMm + 2 * perSide;
  const coreOd = inputs.finishedOdMm - 2 * perSide;
  if (coreOd <= coreId) throw new EngineError('GEOMETRY_IMPOSSIBLE', 'Insulation and winding leave no radial steel section. Increase OD or reduce construction build.');
  const radialCm = (coreOd - coreId) / 20;
  const mmlCm = Math.PI * (coreId + coreOd) / 20;
  const stacking = grade.stackingFactor ?? settings.stackingFactor;
  positive(stacking, 'Steel stacking factor');
  if (stacking > 1) throw new EngineError('INVALID_INPUT', 'Steel stacking factor cannot exceed 1.');
  const k = 4.44 * e.frequencyHz * 1e-4;
  const Is = inputs.secondaryCurrent;
  const impedance = inputs.burdenVA / Is ** 2;
  const rb = impedance * e.burdenPowerFactor;
  const xb = impedance * Math.sqrt(1 - e.burdenPowerFactor ** 2);
  const multiplier = e.purpose === 'protection' ? required(e.accuracyLimitFactor, 'Accuracy limit factor') : 1;
  const kneeB = e.purpose === 'ps' ? required(material.kneeFluxT, 'Characterised knee flux density') : null;
  if (e.purpose === 'ps') { required(e.requiredKneeVoltage, 'Required knee-point voltage'); required(e.psVoltageFactor, 'Client-approved resistance formula multiplier'); }
  const electrical = (width: number) => {
    const perimeterMm = (coreOd - coreId) + 2 * width + 8 * (coreCover + winding.windingBuildMm / 2);
    const length = (perimeterMm * settings.lengthFactor * N + settings.leadWireMm) / 1000;
    const r20 = length * gauge.ohmPerM20c / e.parallelStrands;
    const r75 = gauge.ohmPerM75c == null ? resistanceAtTemperature(r20, 20, 75, e.copperTemperatureConstant) : length * gauge.ohmPerM75c / e.parallelStrands;
    const rOp = gauge.ohmPerM75c == null ? resistanceAtTemperature(r20, 20, e.operatingTemperatureC, e.copperTemperatureConstant) : resistanceAtTemperature(r75, 75, e.operatingTemperatureC, e.copperTemperatureConstant);
    const volts = Is * Math.hypot(rOp + rb + e.leadResistanceOhm, xb);
    const resistanceVk = e.purpose === 'ps' ? e.psVoltageFactor! * Is * (r75 + e.leadResistanceOhm + rb) : null;
    const requested = e.purpose === 'ps' ? Math.max(e.requiredKneeVoltage!, resistanceVk!) : volts * multiplier;
    const area = Math.max(volts / (k * N * material.workingFluxT), requested / (k * N * (kneeB ?? material.workingFluxT)));
    return { length, r20, r75, rOp, volts, resistanceVk, requested, area, requiredWidth: area / (radialCm * stacking) * 10 };
  };
  let width = 0; let converged = false; let passes = 0;
  for (; passes < settings.maxIterations; passes++) {
    const next = electrical(width).requiredWidth;
    if (!Number.isFinite(next) || next > 1e6) throw new EngineError('INVALID_INPUT', 'Winding resistance and required core width do not converge.');
    if (Math.abs(next - width) < settings.convergenceTolerance) { width = next; converged = true; break; }
    width = next;
  }
  const theoreticalWidth = width;
  const stocked = [...ref.slitWidthsMm].filter(w => w > 0 && Number.isFinite(w)).sort((a,b) => a-b);
  let ordered = stocked.find(w => w >= width) ?? Math.ceil(width / settings.slitStepMm) * settings.slitStepMm;
  // Revalidate after rounding: the longer winding changes both Rct and required volts.
  for (let pass = 0; pass < 500; pass++) {
    const needed = electrical(ordered).requiredWidth;
    if (needed <= ordered + 1e-8) break;
    ordered = stocked.find(w => w >= needed) ?? Math.ceil(needed / settings.slitStepMm) * settings.slitStepMm;
    if (!Number.isFinite(ordered) || ordered > 1e6 || pass === 499) throw new EngineError('INVALID_INPUT', 'Ordered core width did not converge.');
  }
  const el = electrical(ordered);
  const grossArea = radialCm * ordered / 10;
  const area = grossArea * stacking;
  const flux = el.volts / (k * N * area);
  const issues: string[] = [];
  if (!e.standard.trim()) issues.push('Applicable standard and edition are missing.');
  if (!e.confirmed) issues.push('Construction assumptions, material data and acceptance limits need engineer confirmation.');
  if (!ref.dies.some(d => d.isAvailable)) issues.push('Available die/tooling data are required.');
  if (!stocked.length) issues.push('Stocked slit widths are required.');
  if (!converged) issues.push('Core width did not converge.');
  if (e.purpose === 'ps' && e.burdenPowerFactor !== 1) issues.push('The configured PS resistance formula requires a resistive burden.');
  const at = (b: number) => interpolateLoss(material.lossCurve, b);
  const operating = at(flux);
  const checkV = e.excitationCheckVoltage ?? (e.purpose === 'ps' ? e.requiredKneeVoltage! : el.volts * multiplier);
  const excitation = at(checkV / (k * N * area));
  const ie = excitation ? Math.hypot(excitation.lossAtCm, excitation.magnetisingAtCm) * mmlCm / N : null;
  const atLoss = operating ? Math.hypot(operating.lossAtCm, operating.magnetisingAtCm) * mmlCm : 0;
  if (!operating || !excitation) issues.push('Excitation component curves do not cover every required operating/check flux.');
  if (e.allowedAtLoss == null) issues.push('Allowed ampere-turn loss must be specified.');
  else if (operating && atLoss > e.allowedAtLoss) issues.push('Working ampere-turn loss exceeds its specified limit.');
  if (e.maxExcitationCurrentA == null) issues.push('Exciting-current limit must be specified.');
  else if (ie != null && ie > e.maxExcitationCurrentA) issues.push('Exciting current exceeds its specified limit.');
  if (e.maxResistance75Ohm != null && el.r75 > e.maxResistance75Ohm) issues.push('Secondary resistance at 75 °C exceeds the specified limit.');
  if (e.purpose === 'ps' && (e.maxResistance75Ohm == null || e.excitationCheckVoltage == null)) issues.push('PS design needs a resistance limit and explicit excitation test voltage.');
  const checks: EngineeringReport['checks'] = e.testPoints.map(p => {
    for (const [key, val] of Object.entries(p)) positive(val, key, key === 'burdenPercent');
    const current = Is * p.currentPercent / 100;
    const resistance = el.rOp + e.leadResistanceOhm + rb * p.burdenPercent / 100;
    const reactance = xb * p.burdenPercent / 100;
    const theta = Math.atan2(reactance, resistance);
    const loss = at(current * Math.hypot(resistance, reactance) / (k * N * area));
    if (!loss || current * Math.hypot(resistance, reactance) / (k * N * area) > material.workingFluxT) return { ...p, ratioErrorPercent: null, phaseMinutes: null, passed: null };
    const iw = loss.lossAtCm * mmlCm / N; const im = loss.magnetisingAtCm * mmlCm / N;
    const ratioErrorPercent = -(iw * Math.cos(theta) + im * Math.sin(theta)) / current * 100;
    const phaseMinutes = (im * Math.cos(theta) - iw * Math.sin(theta)) / current * 180 / Math.PI * 60;
    return { currentPercent: p.currentPercent, burdenPercent: p.burdenPercent, ratioErrorPercent, phaseMinutes, passed: Math.abs(ratioErrorPercent) <= p.maxRatioErrorPercent && Math.abs(phaseMinutes) <= p.maxPhaseMinutes };
  });
  if (e.purpose === 'metering' && (!checks.length || checks.some(c => c.passed !== true))) issues.push('Metering ratio/phase test points are missing, outside curve coverage, or fail their limits.');
  const faultExcitation = at(el.volts * multiplier / (k * N * area));
  const composite = e.purpose === 'protection' && faultExcitation ? Math.hypot(faultExcitation.lossAtCm, faultExcitation.magnetisingAtCm) * mmlCm / N / (Is * multiplier) * 100 : null;
  if (e.purpose === 'protection') {
    if (composite == null) issues.push('Excitation curve does not cover the accuracy-limit operating point.');
    const ceiling = inputs.accuracyClass === '5P' ? 5 : 10;
    if (e.maxCompositeErrorPercent == null) issues.push('Protection composite-error screening limit is missing.');
    else if (composite != null && composite > Math.min(ceiling, e.maxCompositeErrorPercent)) issues.push('Excitation-based composite-error estimate exceeds the limit.');
  }
  const saturationVoltage = material.saturationFluxT == null ? null : k * N * area * material.saturationFluxT;
  const kneeVoltage = material.kneeFluxT == null ? null : k * N * area * material.kneeFluxT;
  if (saturationVoltage == null) issues.push('Characterised saturation flux density is missing.');
  else if (saturationVoltage < el.requested) issues.push('Required voltage exceeds the characterised saturation voltage.');
  const coreVolume = grossArea * mmlCm;
  const coreWeight = coreVolume * (grade.densityGCm3 ?? settings.steelDensity) * stacking / 1000;
  const copperWeight = el.length * e.parallelStrands * gauge.gramPerM / 1000;
  positive(ref.copperRatePerKg, 'Copper rate', true);
  if (grade.ratePerKg != null) positive(grade.ratePerKg, 'Steel rate', true);
  for (const [key, value] of Object.entries(e.costing)) if (typeof value === 'number') positive(value, key, true);
  const coreCost = grade.ratePerKg == null ? null : coreWeight * grade.ratePerKg * (1 + e.costing.steelWastePercent / 100);
  const copperCost = copperWeight * ref.copperRatePerKg * (1 + e.costing.copperWastePercent / 100);
  const materialCost = coreCost == null ? null : coreCost + copperCost;
  const extras = [e.costing.insulationPerUnit,e.costing.resinPerUnit,e.costing.labourPerUnit,e.costing.overheadPerUnit];
  const manufacturingCost = materialCost == null || extras.some(n => n == null) ? null : materialCost + extras.reduce<number>((a,b) => a + b!,0);
  if (e.costing.basis === 'manufacturing' && manufacturingCost == null) issues.push('Complete manufacturing costs are required for manufacturing-cost ranking.');
  const report: EngineeringReport = {
    purpose: e.purpose, issues, layers: winding.layers, turnsPerLayer: winding.turnsPerLayer, windingBuildMm: winding.windingBuildMm, finishedWidthMm: ordered + 2 * perSide,
    wireLengthPerStrandM: el.length, totalWireLengthM: el.length * e.parallelStrands,
    resistance20Ohm: el.r20, resistanceRoomOhm: resistanceAtTemperature(el.r20,20,e.roomTemperatureC,e.copperTemperatureConstant), resistance75Ohm: el.r75, resistanceOperatingOhm: el.rOp,
    resistance75Source: gauge.ohmPerM75c == null ? 'temperature-corrected' : 'reference', effectiveAreaCm2: area, operatingFluxT: flux, voltageAtLimit: el.requested,
    saturationVoltage, kneeVoltage, areaFromKneeCm2: kneeB == null ? null : e.requiredKneeVoltage! / (k*N*kneeB), areaFromResistanceCm2: kneeB == null ? null : el.resistanceVk! / (k*N*kneeB),
    excitationCurrentA: ie, excitationAtCm: operating ? Math.hypot(operating.lossAtCm, operating.magnetisingAtCm) : null,
    checks, compositeErrorEstimatePercent: composite, materialCost, manufacturingCost, costBasis: e.costing.basis,
  };
  for (const value of [el.r20,el.r75,el.rOp,el.volts,el.area,coreWeight,copperWeight,copperCost,materialCost,manufacturingCost]) if (value !== null && !Number.isFinite(value)) throw new EngineError('INVALID_INPUT', 'Engineering calculation overflowed. Check the input magnitudes.');
  const totalCost = e.costing.basis === 'manufacturing' ? manufacturingCost : materialCost;
  const geometry = { turns: N, allowanceMm: 2 * perSide, coreIdMm: coreId, coreOdMm: coreOd, radialBuildMm: radialCm * 10, radialBuildCm: radialCm, mmlCm };
  const rows: [string,string,number,string][] = [
    ['Core ID','finished ID + 2 × per-side insulation and winding build',coreId,'mm'],
    ['Core OD','finished OD − 2 × per-side insulation and winding build',coreOd,'mm'],
    ['Winding layers','ceil(turns / floor(limiting circumference / bundle pitch))',winding.layers,'layers'],
    ['Ordered width','stock width satisfying voltage and winding-resistance feedback',ordered,'mm'],
    ['Effective steel area','radial build × ordered width × stacking factor',area,'cm²'],
    ['Resistance at 20 °C','per-strand length × ohm/m / parallel strands',el.r20,'Ω'],
    ['Resistance at 75 °C','reference hot resistance or R20 × (K + 75) / (K + 20)',el.r75,'Ω'],
    ['Working EMF','Is × |Rct + Rlead + Zburden|',el.volts,'V'],
    ['Working flux','EMF / (4.44 × f × N × effective area in m²)',flux,'T'],
    ['Finished axial width','ordered core width + 2 × total per-side build',report.finishedWidthMm,'mm'],
  ];
  return { inputs, gradeCode, swg, geometry, engineering: report, burdenVoltage: inputs.burdenVA / Is, classPercent: 0, atLoss, h: report.excitationAtCm ?? 0, bRawT: flux, bUsedT: flux, wasCapped: false,
    coreAreaCm2: el.area, coreWidthMm: theoreticalWidth, wireLengthM: el.length * e.parallelStrands, resistanceOhm: el.rOp, vDrop: Is * el.rOp, vTotal: el.volts, converged, passes: passes + 1, iterations: [],
    orderedWidthMm: ordered, finalAreaCm2: grossArea, coreVolumeCm3: coreVolume, coreWeightKg: coreWeight, copperWeightKg: copperWeight, coreCost, copperCost, totalCost, provisional: true,
    warnings: [{ code: 'PROVISIONAL_OUTPUTS', ref: 'Engineering screening', message: 'Uniform insulation and winding build; sinusoidal excitation model. Ratio/phase and protection estimates are screening results, not certification or transient fault simulation. Validate against measured CTs and the specified standard.' }, ...issues.map(message => ({ code: 'UNCONFIRMED_SETTINGS' as const, ref: 'Engineering inputs', message }))],
    steps: rows.map(([label,formula,value,unit],i) => ({ step:i+1,key:`engineering-${i}`,label,formula,substituted:String(value),value,unit,provisional:true })),
  };
}
