import type { EngineeringSpec, EngineeringReport } from './engineeringTypes.js';
/**
 * @meltek/engine — types
 *
 * Pure domain types. No I/O, no framework, no implicit reference data.
 * Every function in this package takes its reference data as an argument (§3.2).
 */

export type CtType = 'ring' | 'wound-primary';

export interface DesignInputs {
  engineering?: EngineeringSpec | null;
  primaryCurrent: number; // A   — Ip
  secondaryCurrent: number; // A   — Is, 5 or 1
  burdenVA: number; // VA
  accuracyClass: string; // "0.5S" | "0.2S" | "0.5" | ...
  finishedIdMm: number;
  finishedOdMm: number;
  ctType: CtType; // Phase 1: 'ring' only
  /** Optional customer-imposed ceiling on the moulded width. */
  maxWidthMm?: number | null;
}

export interface ProcessSettings {
  resinCoverMm: number; // 3    — UNCONFIRMED §12.2
  windingAllowanceMm: number; // 9    — UNCONFIRMED §12.1
  lengthFactor: number; // 1.2  — wire crossover allowance
  leadWireMm: number; // 40   — CONFIRMED
  testMarginFactor: number; // 0.95 — CONFIRMED §5.4
  stackingFactor: number; // 0.95
  steelDensity: number; // 7.65 g/cm³
  saturationCapTesla: number; // 0.65 — CONFIRMED the rule exists
  saturationTriggerTesla: number; // 1.0  — UNCONFIRMED §12.3
  frequencyHz: number; // 50
  /** §12.5 — the spreadsheet stops at 3. We converge to tolerance. */
  maxIterations: number; // 20
  convergenceTolerance: number; // 2e-5
  /** §12.7 — fallback rounding step when the stocked slit list is empty. */
  slitStepMm: number; // 5
  /** §12.4 — "+5 above 400 A". Ambiguous instruction; default OFF. */
  plusFiveAbove400A: boolean; // false
}

export interface BhPoint {
  /** Flux density, tesla. The shared index. */
  teslaT: number;
  /** Magnetising force, AT/cm. null = grade not characterised at this flux density. */
  hAtCm: number | null;
}

export interface SteelGrade {
  code: string;
  label: string;
  note?: string | null;
  ratePerKg: number | null; // null = UNCONFIRMED (§12.9)
  densityGCm3?: number | null;
  stackingFactor?: number | null;
  isAvailable: boolean;
  curve: BhPoint[]; // ascending by teslaT
}

export interface WireGauge {
  swg: number;
  diaMm: number;
  areaSqmm: number;
  ohmPerM20c: number;
  ohmPerM75c: number | null; // §12.10 — data does not exist yet
  gramPerM: number;
  isAvailable: boolean;
}

export interface AccuracyClass {
  code: string;
  percent: number;
  perIS: boolean;
  note: string;
  maxFluxDensityT?: number | null;
}

export interface Die {
  id: string;
  dieNo: string;
  minOdMm: number;
  maxOdMm: number;
  maxWidthMm: number;
  quantity: number;
  location?: string | null;
  isAvailable: boolean;
}

export interface ReferenceData {
  grades: SteelGrade[];
  gauges: WireGauge[];
  classes: AccuracyClass[];
  dies: Die[];
  /** Stocked slit widths in mm. Empty ⇒ fall back to settings.slitStepMm (§12.7). */
  slitWidthsMm: number[];
  copperRatePerKg: number;
}

/* ─────────────────────────── results ─────────────────────────── */

export type WarningCode =
  | 'FLUX_CEILING_APPLIED'
  | 'H_BELOW_CURVE'
  | 'H_ABOVE_CURVE'
  | 'CLASS_NOT_PER_IS'
  | 'NO_CONVERGENCE'
  | 'UNCONFIRMED_SETTINGS'
  | 'RATE_MISSING'
  | 'PROVISIONAL_OUTPUTS'
  | 'PLUS_FIVE_APPLIED';

export interface EngineWarning {
  code: WarningCode;
  message: string;
  /** Section of the brief this traces back to, for the UI's "show the working". */
  ref?: string;
}

export type EngineErrorCode =
  | 'GEOMETRY_IMPOSSIBLE'
  | 'UNKNOWN_CLASS'
  | 'UNKNOWN_GRADE'
  | 'UNKNOWN_GAUGE'
  | 'CURVE_EMPTY'
  | 'INVALID_INPUT'
  | 'MISSING_REFERENCE_DATA'
  | 'UNSUPPORTED_CT_TYPE';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly detail?: Record<string, unknown>;
  constructor(code: EngineErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** §12.1 — thrown until the winding reference tables exist. */
export class MissingReferenceData extends EngineError {
  constructor(message: string, detail?: Record<string, unknown>) {
    super('MISSING_REFERENCE_DATA', message, detail);
    this.name = 'MissingReferenceData';
  }
}

export interface Iteration {
  pass: number;
  areaCm2: number;
  widthCm: number;
  perTurnMm: number;
  lengthM: number;
  resistanceOhm: number;
  vDrop: number;
  vIn: number;
  vNext: number;
  delta: number;
}

/** Every substituted value of the 14-step chain, for the detail panel (§11.2). */
export interface CalcStep {
  step: number;
  key: string;
  label: string;
  formula: string;
  substituted: string;
  value: number | string;
  unit: string;
  /** §5.9 — outputs past spreadsheet cell C93 are reconstructions. */
  provisional?: boolean;
  note?: string;
}

export interface Geometry {
  turns: number;
  allowanceMm: number;
  coreIdMm: number;
  coreOdMm: number;
  radialBuildMm: number;
  radialBuildCm: number;
  mmlCm: number;
}

export interface SolveResult {
  engineering?: EngineeringReport;
  inputs: DesignInputs;
  gradeCode: string;
  swg: number;
  geometry: Geometry;
  burdenVoltage: number;
  classPercent: number;
  atLoss: number;
  h: number;
  bRawT: number;
  bUsedT: number;
  wasCapped: boolean;
  /** Converged values. */
  coreAreaCm2: number;
  coreWidthMm: number;
  wireLengthM: number;
  resistanceOhm: number;
  vDrop: number;
  vTotal: number;
  converged: boolean;
  passes: number;
  iterations: Iteration[];
  /** §5.9 — provisional reconstruction. */
  orderedWidthMm: number;
  finalAreaCm2: number;
  coreVolumeCm3: number;
  coreWeightKg: number;
  copperWeightKg: number;
  coreCost: number | null;
  copperCost: number;
  totalCost: number | null;
  provisional: true;
  steps: CalcStep[];
  warnings: EngineWarning[];
}

export interface RankedOption extends SolveResult {
  gradeLabel: string;
  dieId: string | null;
  dieNo: string | null;
  isFeasible: boolean;
  infeasibleReasons: string[];
  rank: number | null;
}

export interface OptimiseResult {
  options: RankedOption[];
  warnings: EngineWarning[];
  computedAtMs: number;
}
