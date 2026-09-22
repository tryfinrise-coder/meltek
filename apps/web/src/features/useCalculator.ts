import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ltCtFamily, EngineError,
  type DesignInputs, type OptimiseResult, type SolveResult,
} from '@meltek/engine';
import { api, type ReferenceResponse } from '../lib/api';

/**
 * Reference data and process settings, loaded once and cached.
 * The engine takes them as an argument - it never imports them implicitly (§3.2).
 */
export function useReference() {
  return useQuery<ReferenceResponse>({
    queryKey: ['reference'],
    queryFn: api.reference,
    staleTime: 60_000,
  });
}

export interface CalculatorState {
  result: OptimiseResult | null;
  error: string | null;
  ready: boolean;
}

/**
 * The calculation runs in the browser, against the identical engine package the server
 * uses (§3.1). No network round trip, no spinner, no loading state on the calculator -
 * roughly 96 combinations in single-digit milliseconds.
 */
export function useCalculator(inputs: DesignInputs | null, ref: ReferenceResponse | undefined): CalculatorState {
  return useMemo(() => {
    if (!ref || !inputs) return { result: null, error: null, ready: false };
    try {
      return { result: ltCtFamily.optimise(inputs, ref, ref.settings), error: null, ready: true };
    } catch (err) {
      const message = err instanceof EngineError ? err.message : 'This specification could not be calculated.';
      return { result: null, error: message, ready: true };
    }
  }, [inputs, ref]);
}

/** The substituted chain for one grade x gauge, for the detail panel (§11.2). */
export function useDetail(
  inputs: DesignInputs | null,
  ref: ReferenceResponse | undefined,
  gradeCode: string | null,
  swg: number | null,
): SolveResult | null {
  return useMemo(() => {
    if (!ref || !inputs || !gradeCode || swg === null) return null;
    try {
      return ltCtFamily.solve(inputs, ref, ref.settings, gradeCode, swg);
    } catch {
      return null;
    }
  }, [inputs, ref, gradeCode, swg]);
}
