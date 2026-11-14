import { EngineError, MissingReferenceData } from './types.js';
import { positive } from './validate.js';

export interface WindingInputs {
  turns: number;
  swg?: number;
  /** Insulated diameter, not bare conductor diameter. */
  wireDiaMm: number;
  /** Per-layer wire and air allowance; tape is added separately. */
  layerPitchMm?: number;
  /** Bare conductor diameter for pitch calculation. */
  bareDiaMm: number;
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
  layerPitchMm?: number;
  turnsPerLayer: number;
  layers: number;
  windingBuildMm: number;
  /** Radial allowance on ONE side, not a diameter allowance. */
  allowanceMm: number;
  /** Diameter the layer circumference was measured on (core side of the winding). */
  boreMm: number;
}

/**
 * Works method, confirmed by the client: the circumference is measured on the core side
 * of the winding (inner bore + both sides of the build), trying 1 layer, then 2, and so on
 * until the turns fit. Returns null when not even one turn fits.
 */
export function fitLayers(turns: number, innerBoreMm: number, turnPitchMm: number, buildFor: (layers: number) => number): { layers: number; turnsPerLayer: number; boreMm: number } | null {
  for (let layers = 1; ; layers++) {
    const boreMm = innerBoreMm + 2 * buildFor(layers);
    const turnsPerLayer = Math.floor(Math.PI * boreMm / turnPitchMm);
    if (turnsPerLayer < 1) return null;
    if (layers * turnsPerLayer >= turns) return { layers, turnsPerLayer, boreMm };
  }
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
  const pitch = inputs.bareDiaMm * (radial ? 1 : inputs.parallelStrands) / factor;
  const layerPitch = inputs.layerPitchMm ?? inputs.wireDiaMm;
  if (!Number.isFinite(layerPitch) || layerPitch + 1e-9 < inputs.wireDiaMm) throw new EngineError('INVALID_INPUT', 'Layer pitch cannot be smaller than the insulated wire diameter.');
  const tape = ref.interlayerThicknessMm;
  const buildFor = (n: number) => n * layerPitch * (radial ? inputs.parallelStrands : 1) + (n - 1) * tape;
  const fit = fitLayers(inputs.turns, inputs.boreIdMm, pitch, buildFor);
  if (!fit) throw new EngineError('GEOMETRY_IMPOSSIBLE', 'No complete turn bundle fits around the winding bore.');
  const windingBuildMm = buildFor(fit.layers);
  return { ...(inputs.layerPitchMm === undefined ? {} : { layerPitchMm: layerPitch }), ...fit, windingBuildMm, allowanceMm: windingBuildMm + ref.minEpoxyThicknessMm };
}
