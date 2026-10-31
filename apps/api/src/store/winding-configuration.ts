import type { StoredDesignInputs } from './types.js';

type Configuration = Pick<StoredDesignInputs, 'wireCombination' | 'layerPitchOverridesMm'>;
export function serializeWindingConfiguration(inputs: StoredDesignInputs): string {
  return JSON.stringify({wireCombination:inputs.wireCombination ?? null,layerPitchOverridesMm:inputs.layerPitchOverridesMm ?? null});
}
export function parseWindingConfiguration(value: unknown): Configuration {
  const data = (typeof value === 'string' ? JSON.parse(value) : value) as Configuration | null;
  return {wireCombination:data?.wireCombination ?? null,layerPitchOverridesMm:data?.layerPitchOverridesMm ?? null};
}
