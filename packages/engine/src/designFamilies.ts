import { optimise } from './optimise.js';
import { solve } from './solve.js';
import { EngineError, type DesignInputs, type ProcessSettings, type ReferenceData } from './types.js';

/** Each future family owns its input type, validation, solver and search strategy. */
export interface DesignFamily<Inputs, Result, SearchResult> {
  id: string;
  label: string;
  description: string;
  solve: (inputs: Inputs, ref: ReferenceData, settings: ProcessSettings, grade: string, swg: number) => Result;
  optimise: (inputs: Inputs, ref: ReferenceData, settings: ProcessSettings) => SearchResult;
}

export const ltCtFamily = {
  id: 'lt-ct',
  label: 'LT current transformer',
  description: 'Ring core · grade and winding optimisation',
  solve,
  optimise,
} satisfies DesignFamily<DesignInputs, ReturnType<typeof solve>, ReturnType<typeof optimise>>;

// Explicit lookup prevents unsupported products from silently using LT CT physics.
export function getDesignFamily(id: string) {
  if (id !== ltCtFamily.id) throw new EngineError('UNSUPPORTED_CT_TYPE', `Design family "${id}" is not available.`);
  return ltCtFamily;
}

export const designFamilies = [ltCtFamily] as const;
