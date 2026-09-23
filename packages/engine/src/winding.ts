import { EngineError, MissingReferenceData } from './types.js';
import { positive } from './validate.js';

export interface WindingInputs {
  turns: number;
  swg?: number;
  /** Insulated diameter, not bare conductor diameter. */
  wireDiaMm: number;
  parallelStrands: number;
  /** Minimum diameter at the winding's inner surface. */
  boreIdMm: number;
  arrangement?: 'side-by-side' | 'radial-stack';
}
export interface WindingReference {
  layerStackingFactorBySwg: Record<number, number> | null;
  interlayerThicknessMm: number | null;
  minEpoxyThicknessMm: number | null;
}
export interface WindingResult {
  turnsPerLayer: number;
  layers: number;
  windingBuildMm: number;
  /** Radial allowance on ONE side, not a diameter allowance. */
  allowanceMm: number;
}
export function computeWindingAllowance(inputs: WindingInputs, ref: WindingReference): WindingResult {
  const factor = inputs.swg == null ? undefined : ref.layerStackingFactorBySwg?.[inputs.swg];
  if (factor == null || ref.interlayerThicknessMm == null || ref.minEpoxyThicknessMm == null) {
    throw new MissingReferenceData('Supply SWG, packing factor for that SWG, interlayer thickness and outer cover thickness.');
  }
  for (const [name, n] of Object.entries({ turns: inputs.turns, insulatedDiameter: inputs.wireDiaMm, strands: inputs.parallelStrands, bore: inputs.boreIdMm, packingFactor: factor })) positive(n, name);
  positive(ref.interlayerThicknessMm, 'Interlayer thickness', true);
  positive(ref.minEpoxyThicknessMm, 'Outer cover thickness', true);
  if (factor > 1 || !Number.isInteger(inputs.turns) || !Number.isInteger(inputs.parallelStrands)) throw new EngineError('INVALID_INPUT', 'Packing must be at most 1; turns and strands must be integers.');
  const radial = inputs.arrangement === 'radial-stack';
  const pitch = inputs.wireDiaMm * (radial ? 1 : inputs.parallelStrands) / factor;
  // Conservative capacity: every layer uses the limiting bore circumference.
  const turnsPerLayer = Math.floor(Math.PI * (inputs.boreIdMm + inputs.wireDiaMm) / pitch);
  if (turnsPerLayer < 1) throw new EngineError('GEOMETRY_IMPOSSIBLE', 'No complete turn bundle fits around the winding bore.');
  const layers = Math.ceil(inputs.turns / turnsPerLayer);
  const windingBuildMm = layers * inputs.wireDiaMm * (radial ? inputs.parallelStrands : 1) + (layers - 1) * ref.interlayerThicknessMm;
  return { turnsPerLayer, layers, windingBuildMm, allowanceMm: windingBuildMm + ref.minEpoxyThicknessMm };
}
