import { interpolateH } from './interpolate.js';
import { transformerConstant } from './solve.js';
import { EngineError, type BhPoint } from './types.js';
import { positive } from './validate.js';

export const CORE_TEST_TURNS = [5, 10, 15] as const;

export interface CoreTestInputs {
  flux100T: number;
  areaCm2: number;
  coreIdMm: number;
  coreOdMm: number;
  accuracyClass: string;
  curve: readonly BhPoint[];
  frequencyHz: number;
}

/** Final core dimensions and area; the test turns are independent of CT turns. */
export function calculateCoreTests(input: CoreTestInputs) {
  for (const key of ['flux100T', 'areaCm2', 'coreIdMm', 'coreOdMm', 'frequencyHz'] as const) positive(input[key], key);
  if (input.coreOdMm <= input.coreIdMm) throw new EngineError('GEOMETRY_IMPOSSIBLE', 'Core OD must exceed core ID.');
  const mmlCm = Math.PI * (input.coreIdMm + input.coreOdMm) / 20;
  const percentages = input.accuracyClass === '0.5S' ? [120, 100, 20, 5, 1] : [120, 100, 20, 5];
  const coefficient = transformerConstant(input.frequencyHz);
  return {
    mmlCm, coefficient,
    points: percentages.map(percent => {
      const fluxT = input.flux100T * (percent / 100);
      const hAtCm = interpolateH(input.curve, fluxT);
      return {
        percent, fluxT, hAtCm,
        tests: CORE_TEST_TURNS.map(turns => ({
          turns,
          voltageV: coefficient * fluxT * turns * input.areaCm2,
          currentLimitA: hAtCm === null ? null : hAtCm * mmlCm / turns,
        })),
      };
    }),
  };
}

export const MIN_SATURATION_FACTOR = 2.5;

/**
 * Saturation voltage ÷ working voltage. Turns and area cancel, so it equals saturation flux ÷ working flux.
 * shortcut: saturation flux is the highest flux on the grade's own B–H curve, add a per-grade field if mills quote a different figure.
 */
export function saturationFactor(input: { curve: readonly BhPoint[]; turns: number; areaCm2: number; workingVoltageV: number; frequencyHz: number }) {
  const saturationFluxT = Math.max(0, ...input.curve.filter(point => point.hAtCm !== null).map(point => point.teslaT));
  if (!(saturationFluxT > 0) || !(input.workingVoltageV > 0)) return null;
  const saturationVoltageV = transformerConstant(input.frequencyHz) * input.turns * saturationFluxT * input.areaCm2;
  return { saturationFluxT, saturationVoltageV, factor: saturationVoltageV / input.workingVoltageV };
}

/** Add evaluated/manufacturer points, retaining all other material data. */
export function mergeCoreTestPoints(curve: readonly BhPoint[], additions: readonly BhPoint[]): BhPoint[] {
  const points = new Map(curve.map(point => [point.teslaT, { ...point }]));
  for (const point of additions) {
    positive(point.teslaT, 'Measured flux density');
    if (point.hAtCm === null) throw new EngineError('INVALID_INPUT', 'Enter the evaluated AT/cm value.');
    positive(point.hAtCm, 'Evaluated AT/cm');
    points.set(point.teslaT, { ...point });
  }
  return [...points.values()].sort((a, b) => a.teslaT - b.teslaT);
}
