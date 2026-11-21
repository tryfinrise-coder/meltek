import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { calculateCoreTests, CORE_TEST_TURNS, mergeCoreTestPoints, ratioErrorPercent, type SolveResult, type SteelGrade } from '@meltek/engine';
import { usePermission } from '../auth/session';
import { api, type ReferenceResponse } from '../shared/api';
import { Button, Card, Hint } from '../shared/primitives';

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
  const [offsetText, setOffsetText] = useState('0');
  const offset = Number.isFinite(Number(offsetText)) ? Number(offsetText) : 0;
  const draft = edits[grade.code] ?? {};
  const entries = Object.entries(draft);
  const valid = entries.every(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0);
  const additions = entries.filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([flux, value]) => ({ teslaT: Number(flux), hAtCm: Number(value) }));
  const testInput = {
    flux100T: result.bUsedT, areaCm2: result.finalAreaCm2,
    coreIdMm: result.geometry.coreIdMm, coreOdMm: result.geometry.coreOdMm,
    accuracyClass: result.inputs.accuracyClass, frequencyHz,
    curve: mergeCoreTestPoints(grade.curve, additions),
  };
  const report = calculateCoreTests(testInput);
  // QL = quarter burden at 100% current: the same test at a quarter of the rated flux.
  const quarter = calculateCoreTests({ ...testInput, flux100T: result.bUsedT / 4 }).points.find(point => point.percent === 100)!;
  const ctTurns = result.geometry.turns;
  const secondaryA = result.inputs.secondaryCurrent;
  const rows = [
    ...report.points.map(point => ({ ...point, label: `${point.percent}%`, currentPercent: point.percent })),
    { ...quarter, label: 'QL', currentPercent: 100 },
  ].map(row => ({ ...row, re: row.hAtCm === null ? null : ratioErrorPercent(row.hAtCm, report.mmlCm, ctTurns, secondaryA, row.currentPercent) }));
  const re20 = rows.find(row => row.label === '20%')?.re ?? null;
  const reQl = rows.find(row => row.label === 'QL')?.re ?? null;
  const band = re20 === null || reQl === null ? null : re20 - reQl;
  const reSample = rows.find(row => row.label === '100%' && row.re !== null);
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

  // Worked example for the popups: the 100% point when present.
  const sample = report.points.find(point => point.percent === 100) ?? report.points[0];
  return <Card title="Test voltages & max current" subtitle={`${grade.label} · B₁₀₀ = ${result.bUsedT.toFixed(4)} T · MML = ${report.mmlCm.toFixed(2)} cm`}>
    <div className="px-4 py-3 text-[13px] text-[var(--text-2)]">
      Enter evaluated or manufacturer-provided AT/cm values at the displayed flux densities. Current limits update immediately for 5, 10 and 15 turns.
      {entries.length > 0 && <span className="ml-2 font-medium text-[var(--brand)]">Unsaved preview</span>}
      <span className="mt-1 block text-xs text-[var(--text-3)] md:hidden">Swipe across the table to see voltages and current limits for all three turn counts.</span>
    </div>
    <div className="max-w-full overflow-x-auto">
      <table className="data-table w-full text-[13px]">
        <thead><tr>
          <th className="label">Point<Hint label="Point">Test point as a percentage of rated flux density (B₁₀₀).<br/><br/>Standard points: 120%, 100%, 20%, 5%. The 1% point appears only for class 0.5S.{sample && <><br/><br/><strong>This design:</strong> B₁₀₀ = {result.bUsedT.toFixed(4)} T, so the {sample.percent}% point is {sample.fluxT.toFixed(4)} T.</>}</Hint></th><th className="label text-right">Flux (T)<Hint label="Flux">Magnetic flux density at this test point, in Tesla.<br/><br/><strong>Formula:</strong> percentage × B₁₀₀.{sample && <><br/><br/><strong>This design:</strong> {sample.percent}% × {result.bUsedT.toFixed(4)} T = {sample.fluxT.toFixed(4)} T.</>}</Hint></th><th className="label">AT/cm<Hint label="AT/cm">Magnetising force in Ampere-Turns per centimetre at this flux density, from the material's B–H curve.<br/><br/>Enter or edit values here.{sample && sample.hAtCm !== null && <><br/><br/><strong>This design:</strong> at {sample.fluxT.toFixed(4)} T the curve gives {sample.hAtCm.toPrecision(4)} AT/cm.</>}</Hint></th>
          {CORE_TEST_TURNS.map(turns => <th key={`v${turns}`} className="label text-right whitespace-nowrap">V · {turns} turns<Hint label={`V · ${turns} turns`}>Test voltage for {turns} secondary turns.<br/><br/><strong>Formula:</strong> 4.44 × frequency × B × N × Area (cm²).<br/><br/>This is the voltage applied during the CT accuracy test.{sample && <><br/><br/><strong>This design, {sample.percent}% point:</strong> {Number(report.coefficient.toPrecision(6))} × {sample.fluxT.toFixed(4)} T × {turns} turns × {result.finalAreaCm2.toFixed(4)} cm² = {sample.tests.find(test => test.turns === turns)?.voltageV.toFixed(4)} V.</>}</Hint></th>)}
          {CORE_TEST_TURNS.map(turns => <th key={`i${turns}`} className="label text-right whitespace-nowrap">I max · {turns} turns (A)<Hint label={`I max · ${turns} turns`}>Maximum magnetising current at {turns} turns.<br/><br/><strong>Formula:</strong> (AT/cm × Mean Magnetic Length) ÷ N.<br/><br/>The CT must handle this current without saturating.{sample && sample.hAtCm !== null && <><br/><br/><strong>This design, {sample.percent}% point:</strong> ({sample.hAtCm.toPrecision(4)} AT/cm × {report.mmlCm.toFixed(2)} cm) ÷ {turns} = {sample.tests.find(test => test.turns === turns)?.currentLimitA?.toFixed(6) ?? '—'} A.</>}</Hint></th>)}
          <th className="label text-right whitespace-nowrap">% RE<Hint label="% RE (ratio error)">Worst-case ratio error at this test point. The whole exciting current is counted as error, so the real ratio error is somewhat smaller.<br/><br/><strong>Step 1 – exciting current:</strong> Io = AT/cm × mean magnetic length ÷ CT secondary turns ({ctTurns}).<br/><br/><strong>Step 2 – error:</strong> % RE = −Io ÷ (secondary current × test point %) × 100.<br/><br/><strong>QL</strong> is quarter burden at 100% current: flux is B₁₀₀ ÷ 4, current is the full {secondaryA} A.{reSample && reSample.hAtCm !== null && <><br/><br/><strong>This design, 100% point:</strong> Io = {reSample.hAtCm.toPrecision(4)} × {report.mmlCm.toFixed(2)} ÷ {ctTurns} = {(reSample.hAtCm * report.mmlCm / ctTurns).toFixed(5)} A. % RE = −{(reSample.hAtCm * report.mmlCm / ctTurns).toFixed(5)} ÷ {secondaryA} × 100 = {reSample.re!.toFixed(3)}%.</>}</Hint></th>
          <th className="label text-right whitespace-nowrap">Adjusted % RE<Hint label="Adjusted % RE">% RE plus the adjustment you enter below the table (for example turns compensation). The same adjustment is added at every test point.<br/><br/><strong>Formula:</strong> % RE + adjustment.{reSample && <><br/><br/><strong>This design, 100% point:</strong> {reSample.re!.toFixed(3)}% + {offset}% = {(reSample.re! + offset).toFixed(3)}%.</>}</Hint></th>
        </tr></thead>
        <tbody>{rows.map(point => {
          const raw = draft[String(point.fluxT)];
          const invalid = raw !== undefined && (!Number.isFinite(Number(raw)) || Number(raw) <= 0);
          const missing = point.hAtCm === null;
          return <tr key={point.label}>
            <th scope="row" className="whitespace-nowrap font-medium">{point.label}</th>
            <td className="num text-right" title={String(point.fluxT)}>{point.fluxT.toFixed(6)}</td>
            <td>
              <input aria-label={`${grade.label} AT/cm at ${point.label}`} aria-describedby={`${id}-${point.label}`} aria-invalid={invalid}
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
              <span id={`${id}-${point.label}`} className={`mt-1 block text-[11px] ${invalid || missing ? 'text-[var(--brand)]' : 'text-[var(--text-3)]'}`}>
                {invalid ? 'Enter a positive value' : raw !== undefined ? 'Entered · unsaved' : missing ? 'AT/cm data required' : 'Material curve'}
              </span>
            </td>
            {point.tests.map(test => <td key={`v${test.turns}`} className="num text-right">{test.voltageV.toFixed(4)}</td>)}
            {point.tests.map(test => <td key={`i${test.turns}`} className="num text-right" title={invalid || test.currentLimitA === null ? 'AT/cm data required' : `${test.currentLimitA} A`}>
              {invalid || test.currentLimitA === null ? '—' : test.currentLimitA.toFixed(6)}
            </td>)}
            <td className="num text-right">{invalid || point.re === null ? '—' : point.re.toFixed(3)}</td>
            <td className="num text-right">{invalid || point.re === null ? '—' : (point.re + offset).toFixed(3)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--line)] px-4 py-3 text-[13px]">
      <label className="flex items-center gap-2">Adjustment (%)
        <input type="number" step="any" value={offsetText} onChange={event => setOffsetText(event.target.value)} aria-label="Ratio error adjustment in percent"
          className="num w-24 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]" />
      </label>
      <span>BAND (20% − QL): <strong className="num">{band === null ? '—' : `${band.toFixed(3)}%`}</strong><Hint label="BAND">Spread of the ratio error between the 20% point and the quarter-load point: % RE at 20% minus % RE at QL. The adjustment does not change it.{band !== null && <><br/><br/><strong>This design:</strong> {re20!.toFixed(3)}% − ({reQl!.toFixed(3)}%) = {band.toFixed(3)}%.</>}</Hint></span>
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
      {' '}% RE = −(AT/cm × MML ÷ {ctTurns} CT turns) ÷ ({secondaryA} A × test %) × 100; QL is quarter burden at 100% current (flux B₁₀₀ ÷ 4).
      {' '}5% and 1% use ×0.05 and ×0.01; 1% is shown only for class 0.5S. A dash means no current limit is calculated without supporting AT/cm data. Blank fields use the saved curve; out-of-range values are not extrapolated.
    </p>
  </Card>;
}
