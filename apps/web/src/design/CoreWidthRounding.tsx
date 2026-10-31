import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermission } from '../auth/session';
import { api, type ReferenceResponse } from '../shared/api';
import { TextField } from '../shared/fields';
import { Button } from '../shared/primitives';
import { useReference } from './useCalculator';

export function CoreWidthRounding({ onPendingChange }: { onPendingChange?: (pending: boolean) => void }) {
  const reference = useReference();
  const queryClient = useQueryClient();
  const canEdit = usePermission('reference.edit');
  const active = reference.data?.settings.coreWidthRoundingTolerancePercent ?? 1;
  const step = reference.data?.settings.slitStepMm ?? 5;
  const [draft, setDraft] = useState(String(active));
  useEffect(() => { setDraft(String(active)); }, [active]);
  const percent = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(percent) && percent >= 0 && percent <= 100;
  const save = useMutation({
    mutationFn: (value: number) => api.saveSetting('coreWidthRoundingTolerancePercent', value),
    onSuccess: data => {
      queryClient.setQueryData<ReferenceResponse>(['reference'], previous => previous ? { ...previous, ...data } : previous);
      void queryClient.invalidateQueries({ queryKey: ['reference'] });
    },
  });
  useEffect(() => { onPendingChange?.(save.isPending); }, [save.isPending, onPendingChange]);
  return <div className="core-rounding-control">
    <div className="core-rounding-editor">
      <TextField label="Rounding tolerance" type="number" unit="%" min={0} max={100} step="0.1" value={draft} disabled={!canEdit || save.isPending} onChange={event => setDraft(event.target.value)} error={!valid ? 'Enter 0–100%.' : undefined} />
      {canEdit && <Button size="sm" disabled={!valid || percent === active || save.isPending} onClick={() => save.mutate(percent)}>{save.isPending ? 'Applying…' : 'Apply'}</Button>}
    </div>
    <p>{step} mm steps · percentage above the lower width.</p>
    <details className="core-rounding-help"><summary>How rounding works</summary><p>The percentage is measured from the lower {step} mm multiple. At 1%: 10.1 → 10 mm, 11 → 15 mm, 14.8 → 15 mm. Saved designs retain their recorded settings. Engineering checks may require a larger width.{!canEdit && ' A reference-data manager can change this value.'}</p></details>
    {save.isError && <p role="alert" className="core-rounding-error">{save.error.message}</p>}
    {save.isSuccess && <span role="status" className="sr-only">Rounding tolerance applied. Widths, weights and costs recalculated.</span>}
  </div>;
}
