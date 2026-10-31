import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import {
  HiArchive, HiDocumentDuplicate, HiExternalLink, HiTrash, HiUpload,
} from 'react-icons/hi';
import { api, ApiError, type Design } from '../shared/api';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, Skeleton } from '../shared/primitives';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { usePermission } from './session';
import { SelectField, TextField } from '../shared/fields';
import { useDebouncedValue } from '../shared/useDebouncedValue';
import { useReference } from '../design/useCalculator';
import { duration, ease, stagger } from '../shared/motion';

const STATUS_TONE: Record<Design['status'], 'ok' | 'neutral' | 'info' | 'warn'> = {
  draft: 'neutral',
  calculated: 'info',
  approved: 'ok',
  in_production: 'ok',
  superseded: 'warn',
  archived: 'neutral',
};

const STATUS_LABEL: Record<Design['status'], string> = {
  draft: 'draft',
  calculated: 'calculated',
  approved: 'approved',
  in_production: 'in production',
  superseded: 'superseded',
  archived: 'archived',
};

/** The design register (§11.4) — filter by ratio, burden, class, ID/OD, customer, status. */
export function Register() {
  const reduce = useReducedMotion();
  const reference = useReference();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canCreate = usePermission('designs.create');
  const canArchive = usePermission('designs.archive');
  const canDelete = usePermission('designs.delete');
  const [view, setView] = useState<'table' | 'cards'>(() => window.matchMedia('(max-width: 700px)').matches ? 'cards' : 'table');
  const [pendingDelete, setPendingDelete] = useState<Design | null>(null);
  const [filters, setFilters] = useState({
    q: '', customer: '', status: '', accuracyClass: '', ratio: '', burdenVA: '', minId: '', maxOd: '',
  });

  const settledFilters = useDebouncedValue(filters);
  const designs = useQuery({
    queryKey: ['designs', settledFilters],
    queryFn: () => api.designs(settledFilters),
    placeholderData: keepPreviousData,
  });

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['designs'] }); };

  const duplicate = useMutation({
    mutationFn: (d: Design) => api.duplicateDesign(d.id),
    onSuccess: (copy) => {
      refresh();
      void navigate({ to: '/designs/$id', params: { id: copy.id } });
    },
  });
  const archive = useMutation({ mutationFn: (d: Design) => api.archiveDesign(d.id), onSuccess: refresh });
  const restore = useMutation({ mutationFn: (d: Design) => api.restoreDesign(d.id), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (d: Design) => api.deleteDesign(d.id),
    onSuccess: () => { refresh(); setPendingDelete(null); },
  });

  /*
   * Inline icon buttons rather than an overflow menu. A dense table is scanned, not
   * explored: one click beats two, and a popover anchored inside a scrolling table cell
   * is fragile. The design page keeps the overflow menu, where there is room for it.
   */
  const rowActions = (d: Design) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="xs" title={`Open ${d.designNo}`}
        onClick={() => void navigate({ to: '/designs/$id', params: { id: d.id } })}
      >
        <HiExternalLink className="h-3.5 w-3.5" aria-hidden />
      </Button>
      {canCreate && (
        <Button size="xs" title="Duplicate as a new design" disabled={duplicate.isPending} onClick={() => duplicate.mutate(d)}>
          <HiDocumentDuplicate className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
      {canArchive && (d.status === 'archived' ? (
        <Button size="xs" title="Restore to the working register" disabled={restore.isPending} onClick={() => restore.mutate(d)}>
          <HiUpload className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : (
        <Button size="xs" title="Archive" disabled={archive.isPending} onClick={() => archive.mutate(d)}>
          <HiArchive className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ))}
      {canDelete && (
        <Button size="xs" title="Delete" onClick={() => setPendingDelete(d)}>
          <HiTrash className="h-3.5 w-3.5" aria-hidden style={{ color: 'var(--warn)' }} />
        </Button>
      )}
    </div>
  );

  const rows = designs.data?.designs ?? [];

  return (
    <div className="design-register flex flex-col gap-6">
      <PageHeader
        eyebrow="Design library"
        title="Design register"
        actions={
          <>
            <Button size="sm" aria-label="Table view" aria-pressed={view === 'table'} variant={view === 'table' ? 'secondary' : 'ghost'} onClick={() => setView('table')}>Table</Button>
            <Button size="sm" aria-label="Card view" aria-pressed={view === 'cards'} variant={view === 'cards' ? 'secondary' : 'ghost'} onClick={() => setView('cards')}>Cards</Button>
            {canCreate && <Link to="/design/new" className="action-link action-primary">+ New design</Link>}
          </>
        }
      >
        Every design this office has calculated, with what was chosen and who approved it.
      </PageHeader>

      <Card className="register-filter-panel">
        <div className="register-filter-toolbar"><div><strong>Find a design</strong><span role="status" aria-live="polite">{designs.isFetching ? 'Updating results…' : `${rows.length} designs shown`}</span></div><Button size="sm" variant="ghost" disabled={!Object.values(filters).some(Boolean)} onClick={() => setFilters({q: '', customer: '', status: '', accuracyClass: '', ratio: '', burdenVA: '', minId: '', maxOd: ''})}>Clear filters</Button></div>
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 xl:grid-cols-8">
          <TextField label="Search" value={filters.q} onChange={set('q')} placeholder="No, PO, PRD" sizing="sm" />
          <TextField label="Customer" value={filters.customer} onChange={set('customer')} sizing="sm" />
          <TextField label="Ratio" value={filters.ratio} onChange={set('ratio')} placeholder="300/5" sizing="sm" />
          <TextField label="Burden VA" inputMode="decimal" className="num" value={filters.burdenVA} onChange={set('burdenVA')} sizing="sm" />
          <SelectField label="Class" value={filters.accuracyClass} onChange={set('accuracyClass')} sizing="sm">
            <option value="">Any</option>
            {(reference.data?.classes ?? []).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
          </SelectField>
          <TextField label="Min ID" inputMode="decimal" className="num" value={filters.minId} onChange={set('minId')} sizing="sm" />
          <TextField label="Max OD" inputMode="decimal" className="num" value={filters.maxOd} onChange={set('maxOd')} sizing="sm" />
          <SelectField label="Status" value={filters.status} onChange={set('status')} sizing="sm">
            <option value="">Any</option>
            {(Object.keys(STATUS_LABEL) as Design['status'][]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </SelectField>
        </div>
      </Card>

      {designs.isError && <Callout tone="warn" title="Design register could not be loaded"><p className="mb-3">{designs.error.message}</p><Button size="sm" onClick={() => { void designs.refetch(); }}>Try again</Button></Callout>}
      {[duplicate.error, archive.error, restore.error].filter(Boolean).map((error, index) => <Callout key={index} tone="warn" title="The design could not be updated">{error?.message}</Callout>)}
      {designs.isLoading && (
        <Card><div className="flex flex-col gap-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div></Card>
      )}

      {designs.data && rows.length === 0 && (
        <Card><EmptyState title="No designs match these filters">
          Clear a filter, or start a new design — it takes about thirty seconds.
        </EmptyState></Card>
      )}

      {rows.length > 0 && view === 'table' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="data-table w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line-strong)] text-left">
                  {['Design no', 'Rev', 'Customer', 'Ratio', 'Burden', 'Class', 'ID / OD', 'Status', 'Created', ''].map((h, i) => (
                    <th key={h || `actions-${i}`} className="label whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <motion.tbody variants={stagger(Boolean(reduce))} initial="hidden" animate="show">
                {rows.map((d) => (
                  <motion.tr
                    key={d.id}
                    variants={{
                      hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
                      show: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
                    }}
                    className="border-b border-[var(--line)]"
                    whileHover={reduce ? {} : { y: -2, backgroundColor: 'var(--surface-2)' }}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Link to="/designs/$id" params={{ id: d.id }} className="font-medium underline-offset-4 hover:underline">
                        {d.designNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 num text-[var(--text-3)]">{d.revision}</td>
                    <td className="px-3 py-2.5">{d.customerName}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 num">{d.inputs.primaryCurrent}/{d.inputs.secondaryCurrent}A</td>
                    <td className="px-3 py-2.5 num">{d.inputs.burdenVA} VA</td>
                    <td className="px-3 py-2.5">{d.inputs.accuracyClass}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 num">{d.inputs.finishedIdMm} / {d.inputs.finishedOdMm} mm</td>
                    <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2.5 num text-[var(--text-3)]">{d.createdAt.slice(0, 10)}</td>
                    <td className="px-3 py-2.5 text-right">{rowActions(d)}</td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) remove.mutate(pendingDelete); }}
        title={pendingDelete ? `Delete ${pendingDelete.designNo}?` : 'Delete design'}
        confirmLabel="Delete permanently"
        busy={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        typeToConfirm={pendingDelete?.designNo}
      >
        <p>
          This removes the design, its calculated options, its bill of materials and any test
          results recorded against it. It cannot be undone.
        </p>
        <p>If you only want it out of the way, archive it instead.</p>
      </ConfirmDialog>

      {rows.length > 0 && view === 'cards' && (
        <motion.div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          variants={stagger(Boolean(reduce))} initial="hidden" animate="show"
        >
          {rows.map((d) => (
            <motion.div
              key={d.id}
              variants={{
                hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 12 },
                show: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
              }}
              whileHover={reduce ? {} : { y: -2, boxShadow: 'var(--shadow-md)' }}
            >
              <div className="register-design-card">
                <Card className="h-full">
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div>
                      <Link to="/designs/$id" params={{ id: d.id }} className="register-card-title">{d.designNo}</Link>
                      <div className="text-[13px] text-[var(--text-2)]">{d.customerName}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                      {rowActions(d)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 border-t border-[var(--line)] p-4 text-[13px]">
                    <Spec label="Ratio">{d.inputs.primaryCurrent}/{d.inputs.secondaryCurrent}A</Spec>
                    <Spec label="Burden">{d.inputs.burdenVA} VA</Spec>
                    <Spec label="Class">{d.inputs.accuracyClass}</Spec>
                    <Spec label="Body">{d.inputs.finishedIdMm}/{d.inputs.finishedOdMm} mm</Spec>
                  </div>
                </Card>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="label">{label}</div><div className="num">{children}</div></div>;
}
