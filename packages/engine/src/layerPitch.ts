import { EngineError, type WireGauge } from './types.js';

/** Allocated layer thickness including wire and air. Inter-layer tape is additional. */
export function resolveLayerPitchMm(gauge: WireGauge, insulatedDiameterMm: number, overrides?: Record<string, number> | null): number | undefined {
  const configured = overrides?.[String(gauge.swg)] ?? gauge.layerPitchMm;
  if (configured === undefined) return undefined;
  const pitch = configured === null ? Math.ceil(insulatedDiameterMm - 1e-9) : configured;
  if (!Number.isFinite(pitch) || pitch <= 0 || !Number.isFinite(insulatedDiameterMm) || insulatedDiameterMm <= 0 || pitch + 1e-9 < insulatedDiameterMm) {
    throw new EngineError('INVALID_INPUT', `SWG ${gauge.swg} layer pitch must be at least its insulated diameter (${insulatedDiameterMm.toFixed(3)} mm).`);
  }
  return pitch;
}
