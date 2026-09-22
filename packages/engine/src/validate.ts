import { EngineError, type DesignInputs, type ProcessSettings } from './types.js';

export function positive(value: number, label: string, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new EngineError('INVALID_INPUT', `${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number.`);
  }
}

/** Validate at the domain boundary, including direct callers outside the API. */
export function validateDesign(inputs: DesignInputs, settings: ProcessSettings): void {
  for (const key of ['primaryCurrent', 'secondaryCurrent', 'burdenVA', 'finishedIdMm', 'finishedOdMm'] as const) positive(inputs[key], key);
  if (inputs.maxWidthMm != null) positive(inputs.maxWidthMm, 'Maximum width');
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'number') positive(value, key, ['resinCoverMm', 'windingAllowanceMm', 'leadWireMm'].includes(key));
  }
  if (!Number.isInteger(settings.maxIterations) || settings.maxIterations > 500) throw new EngineError('INVALID_INPUT', 'Iteration limit must be an integer from 1 to 500.');
  if (settings.stackingFactor > 1 || settings.saturationCapTesla > settings.saturationTriggerTesla) throw new EngineError('INVALID_INPUT', 'Check stacking factor and saturation ceiling settings.');
  if (![1, 5].includes(inputs.secondaryCurrent) || !Number.isInteger(inputs.primaryCurrent / inputs.secondaryCurrent)) throw new EngineError('INVALID_INPUT', 'LT CT designs require a 1 A or 5 A secondary and a whole number of secondary turns.');
}
