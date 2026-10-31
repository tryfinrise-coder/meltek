import type { DesignInputs, EngineeringSpec, WireCombinationEntry } from '@meltek/engine';
import { designInputsSchema } from '@meltek/schema';

export interface CalculatorFormInputs {
  primaryCurrent: unknown;
  secondaryCurrent: unknown;
  burdenVA: unknown;
  accuracyClass: string;
  finishedIdMm: unknown;
  finishedOdMm: unknown;
  maxWidthMm?: unknown;
  ctType: DesignInputs['ctType'];
}

/** Preserve the existing form-to-engine conversion in a directly testable boundary. */
export function createCalculatorInputs(
  values: CalculatorFormInputs,
  engineering: EngineeringSpec | null,
  wireCombination: WireCombinationEntry[] | null,
  layerPitchOverridesMm?: Record<string, number> | null,
): DesignInputs | null {
  const parsed = designInputsSchema.safeParse({
    engineering,
    primaryCurrent: Number(values.primaryCurrent),
    secondaryCurrent: Number(values.secondaryCurrent),
    burdenVA: Number(values.burdenVA),
    accuracyClass: values.accuracyClass,
    finishedIdMm: Number(values.finishedIdMm),
    finishedOdMm: Number(values.finishedOdMm),
    ctType: values.ctType,
    maxWidthMm: values.maxWidthMm === '' ? null : Number(values.maxWidthMm),
    wireCombination,
    ...(layerPitchOverridesMm == null ? {} : {layerPitchOverridesMm}),
  });
  return parsed.success ? parsed.data as DesignInputs : null;
}

export function wireCombinationFromMap(enabled: boolean, wireMap: Record<number, number>): WireCombinationEntry[] | null {
  if (!enabled) return null;
  const entries = Object.entries(wireMap)
    .filter(([, count]) => count > 0)
    .map(([swg, count]) => ({ swg: Number(swg), count }));
  return entries.length ? entries : null;
}

/** Explicit mode wins on reload; older drafts keep their existing count-based fallback. */
export function wireModeFromDraft(draft: { wireComboEnabled?: boolean; wireMap?: Record<number, number> } | null): boolean {
  if (typeof draft?.wireComboEnabled === 'boolean') return draft.wireComboEnabled;
  return Object.values(draft?.wireMap ?? {}).some(count => count > 0);
}
