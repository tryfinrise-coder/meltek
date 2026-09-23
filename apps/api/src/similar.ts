import type { Design, StoredDesignInputs } from './store/index.js';

export interface SimilarDesign {
  design: Design;
  score: number;
  matches: string[];
}

/**
 * Similar design matching (§8).
 *
 * "A repeat order should reuse a proven design - this will save the design office more
 * time than the calculator itself." Scored on ratio, burden, class and ID/OD, weighted
 * so an exact ratio match dominates. An approved design outranks a draft at equal score.
 */
export function findSimilar(inputs: StoredDesignInputs, designs: Design[], limit = 3): SimilarDesign[] {
  const scored = designs
    .filter((d) => d.status !== 'superseded' && d.status !== 'archived' && (d.inputs.engineering?.purpose ?? 'metering') === (inputs.engineering?.purpose ?? 'metering'))
    .map((d) => {
      const i = d.inputs;
      const matches: string[] = [];
      let score = 0;

      const ratio = (x: StoredDesignInputs) => x.primaryCurrent / x.secondaryCurrent;
      if (i.primaryCurrent === inputs.primaryCurrent && i.secondaryCurrent === inputs.secondaryCurrent) {
        score += 40;
        matches.push(`Same ratio ${i.primaryCurrent}/${i.secondaryCurrent}A`);
      } else {
        score += 25 * closeness(ratio(i), ratio(inputs), 0.5);
      }

      if (i.burdenVA === inputs.burdenVA) { score += 20; matches.push(`Same burden ${i.burdenVA} VA`); }
      else score += 12 * closeness(i.burdenVA, inputs.burdenVA, 0.5);

      if (i.accuracyClass === inputs.accuracyClass) { score += 20; matches.push(`Same class ${i.accuracyClass}`); }

      const idClose = closeness(i.finishedIdMm, inputs.finishedIdMm, 0.25);
      const odClose = closeness(i.finishedOdMm, inputs.finishedOdMm, 0.25);
      score += 10 * idClose + 10 * odClose;
      if (i.finishedIdMm === inputs.finishedIdMm && i.finishedOdMm === inputs.finishedOdMm) {
        matches.push(`Same ${i.finishedIdMm}/${i.finishedOdMm} mm body`);
      }

      if (d.status === 'approved' || d.status === 'in_production') { score += 5; matches.push('Approved design'); }

      return { design: d, score: Math.round(score), matches };
    })
    .filter((s) => s.score >= 45)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

/** 1 when identical, falling linearly to 0 at `tolerance` relative difference. */
function closeness(a: number, b: number, tolerance: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  const diff = Math.abs(a - b) / Math.abs(b);
  return diff >= tolerance ? 0 : 1 - diff / tolerance;
}
