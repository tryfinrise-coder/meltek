import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { calculateCoreTests, CORE_TEST_TURNS, mergeCoreTestPoints, type SolveResult, type SteelGrade } from '@meltek/engine';
import { usePermission } from '../auth/session';
import { api, type ReferenceResponse } from '../shared/api';
import { Button, Card } from '../shared/primitives';

export function CoreTestResults({ result, grade, frequencyHz, onPendingChange }: {
  result: SolveResult;
  grade: SteelGrade;
  frequencyHz: number;
  onPendingChange?: (pending: boolean) => void;
}) {
  const id = useId();
  const canEdit = usePermission('reference.edit');
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const draft = edits[grade.code] ?? {};
  const entries = Object.entries(draft);
  const valid = entries.every(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0);
  const additions = entries.filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([flux, value]) => ({ teslaT: Number(flux), hAtCm: Number(value) }));
  const report = calculateCoreTests({
    flux100T: result.bUsedT, areaCm2: result.finalAreaCm2,
    coreIdMm: result.geometry.coreIdMm, coreOdMm: result.geometry.coreOdMm,
    accuracyClass: result.inputs.accuracyClass, frequencyHz,
    curve: mergeCoreTestPoints(grade.curve, additions),
  });
  const save = useMutation({
    mutationFn: async (value: { gradeCode: string; points: typeof additions }) => {
      // Merge into the latest reference so unrelated rates and curve points survive.
      const reference = await api.reference();
      const current = reference.grades.find(item => item.code === value.gradeCode);
      if (!current) throw new Error('This material is no longer available. Refresh the reference data.');
      return api.saveGrade(current.code, { ...current, curve: mergeCoreTestPoints(current.curve, value.points) });
    },
    onSuccess: (data, value) => {
      queryClient.setQueryData<ReferenceResponse>(['reference'], previous => previous ? { ...previous, ...data } : previous);
      void queryClient.invalidateQueries({ queryKey: ['reference'] });
      setEdits(previous => ({ ...previous, [value.gradeCode]: {} }));
    },
  });
  useEffect(() => {
    onPendingChange?.(save.isPending);
    return () => onPendingChange?.(false);
  }, [save.isPending, onPendingChange]);

  return <Card title="Test voltages & max current" subtitle={`${grade.label} · B₁₀₀ = ${result.bUsedT.toFixed(4)} T · MML = ${report.mmlCm.toFixed(2)} cm`}>
    <div className="px-4 py-3 text-[13px] text-[var(--text-2)]">
      Enter evaluated or manufacturer-provided AT/cm values at the displayed flux densities. Current limits update immediately for 5, 10 and 15 turns.
      {entries.length > 0 && <span className="ml-2 font-medium text-[var(--brand)]">Unsaved preview</span>}
      <span className="mt-1 block text-xs text-[var(--text-3)] md:hidden">Swipe across the table to see voltages and current limits for all three turn counts.</span>
    </div>
    <div className="max-w-full overflow-x-auto">
      <table className="data-table w-full text-[13px]">
        <thead><tr>
          <th className="label">Point</th><th className="label text-right">Flux (T)</th><th className="label">AT/cm</th>
          {CORE_TEST_TURNS.map(turns => <th key={`v${turns}`} className="label text-right whitespace-nowrap">V · {turns} turns</th>)}
          {CORE_TEST_TURNS.map(turns => <th key={`i${turns}`} className="label text-right whitespace-nowrap">I max · {turns} turns (A)</th>)}
        </tr></thead>
        <tbody>{report.points.map(point => {
          const raw = draft[String(point.fluxT)];
          const invalid = raw !== undefined && (!Number.isFinite(Number(raw)) || Number(raw) <= 0);
          const missing = point.hAtCm === null;
          return <tr key={point.percent}>
            <th scope="row" className="whitespace-nowrap font-medium">{point.percent}%</th>
            <td className="num text-right" title={String(point.fluxT)}>{point.fluxT.toFixed(6)}</td>
            <td>
              <input aria-label={`${grade.label} AT/cm at ${point.percent}%`} aria-describedby={`${id}-${point.percent}`} aria-invalid={invalid}
                type="number" min="0" step="any" value={raw ?? ''} disabled={save.isPending}
                placeholder={missing ? 'Required' : point.hAtCm!.toPrecision(6)}
                onChange={event => {
                  const value = event.target.value;
                  setEdits(previous => {
                    const next = { ...previous[grade.code] };
                    if (value === '') delete next[String(point.fluxT)]; else next[String(point.fluxT)] = value;
                    return { ...previous, [grade.code]: next };
                  });
                }}
                className="num w-28 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-2 text-[14px] focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]" />
              <span id={`${id}-${point.percent}`} className={`mt-1 block text-[11px] ${invalid || missing ? 'text-[var(--brand)]' : 'text-[var(--text-3)]'}`}>
                {invalid ? 'Enter a positive value' : raw !== undefined ? 'Entered · unsaved' : missing ? 'AT/cm data required' : 'Material curve'}
              </span>
            </td>
            {point.tests.map(test => <td key={`v${test.turns}`} className="num text-right">{test.voltageV.toFixed(4)}</td>)}
            {point.tests.map(test => <td key={`i${test.turns}`} className="num text-right" title={invalid || test.currentLimitA === null ? 'AT/cm data required' : `${test.currentLimitA} A`}>
              {invalid || test.currentLimitA === null ? '—' : test.currentLimitA.toFixed(6)}
            </td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-4 py-3">
      {canEdit && <Button size="sm" disabled={!entries.length || !valid || save.isPending} onClick={() => save.mutate({ gradeCode: grade.code, points: additions })}>
        {save.isPending ? 'Saving…' : 'Save to material curve'}
      </Button>}
      {entries.length > 0 && <Button size="sm" disabled={save.isPending} onClick={() => setEdits(previous => ({ ...previous, [grade.code]: {} }))}>Discard preview</Button>}
      <p className="flex-1 basis-64 text-xs text-[var(--text-3)]">{canEdit ? 'Save before saving the design. Saved points update this material’s B–H curve and future calculations; approved designs retain their frozen data.' : 'Preview only. A reference-data manager can save these points for future calculations.'}</p>
      {save.isError && save.variables?.gradeCode === grade.code && <p role="alert" className="w-full text-[13px] text-[var(--brand)]">{save.error.message}</p>}
      {save.isSuccess && save.variables?.gradeCode === grade.code && !entries.length && <p role="status" className="w-full text-[13px]">Material AT/cm values saved.</p>}
    </div>
    <p className="px-4 pb-3 text-xs text-[var(--text-3)]">
      V = {Number(report.coefficient.toPrecision(8))} × B × N × A (cm²) at {frequencyHz} Hz · I max = (AT/cm × MML) / N · Area = {result.finalAreaCm2.toFixed(4)} cm².
      {' '}5% and 1% use ×0.05 and ×0.01; 1% is shown only for class 0.5S. A dash means no current limit is calculated without supporting AT/cm data. Blank fields use the saved curve; out-of-range values are not extrapolated.
    </p>
  </Card>;
}
