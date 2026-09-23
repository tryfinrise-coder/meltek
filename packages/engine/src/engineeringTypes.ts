export interface EngineeringSpec {
  purpose: 'metering' | 'protection' | 'ps';
  standard: string;
  confirmed: boolean;
  frequencyHz: number;
  roomTemperatureC: number;
  operatingTemperatureC: number;
  copperTemperatureConstant: number;
  burdenPowerFactor: number;
  leadResistanceOhm: number;
  parallelStrands: number;
  strandArrangement: 'side-by-side' | 'radial-stack';
  selectedSwg: number | null;
  coreInsulation: { type: string; thicknessMm: number | null };
  outerInsulation: { type: string; thicknessMm: number | null };
  interlayerThicknessMm: number | null;
  interlayerType: string;
  wires: { swg: number; insulatedDiameterMm: number; packingFactor: number }[];
  materials: {
    gradeCode: string;
    workingFluxT: number;
    saturationFluxT: number | null;
    kneeFluxT: number | null;
    lossCurve: { fluxT: number; lossAtCm: number; magnetisingAtCm: number }[];
  }[];
  allowedAtLoss: number | null;
  accuracyLimitFactor: number | null;
  maxCompositeErrorPercent: number | null;
  requiredKneeVoltage: number | null;
  maxExcitationCurrentA: number | null;
  excitationCheckVoltage: number | null;
  maxResistance75Ohm: number | null;
  psVoltageFactor: number | null;
  testPoints: { currentPercent: number; burdenPercent: number; maxRatioErrorPercent: number; maxPhaseMinutes: number }[];
  costing: {
    basis: 'material' | 'manufacturing';
    insulationPerUnit: number | null;
    resinPerUnit: number | null;
    labourPerUnit: number | null;
    overheadPerUnit: number | null;
    steelWastePercent: number;
    copperWastePercent: number;
  };
}

export interface EngineeringReport {
  purpose: EngineeringSpec['purpose'];
  issues: string[];
  layers: number;
  turnsPerLayer: number;
  windingBuildMm: number;
  finishedWidthMm: number;
  wireLengthPerStrandM: number;
  totalWireLengthM: number;
  resistance20Ohm: number;
  resistanceRoomOhm: number;
  resistance75Ohm: number;
  resistanceOperatingOhm: number;
  resistance75Source: 'reference' | 'temperature-corrected';
  effectiveAreaCm2: number;
  operatingFluxT: number;
  voltageAtLimit: number;
  saturationVoltage: number | null;
  kneeVoltage: number | null;
  areaFromKneeCm2: number | null;
  areaFromResistanceCm2: number | null;
  excitationCurrentA: number | null;
  excitationAtCm: number | null;
  checks: { currentPercent: number; burdenPercent: number; ratioErrorPercent: number | null; phaseMinutes: number | null; passed: boolean | null }[];
  compositeErrorEstimatePercent: number | null;
  materialCost: number | null;
  manufacturingCost: number | null;
  costBasis: 'material' | 'manufacturing';
}
