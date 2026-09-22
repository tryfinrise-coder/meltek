import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, Link } from '@tanstack/react-router';
import { Dropdown, DropdownDivider, DropdownItem } from 'flowbite-react';
import {
  HiArchive, HiDocumentDuplicate, HiDotsVertical, HiPencil, HiRefresh, HiTrash, HiUpload,
} from 'react-icons/hi';
import { motion, useReducedMotion } from 'motion/react';
import type { DesignInputs } from '@meltek/engine';
import { api, ApiError, type StoredOptionDto } from '../lib/api';
import { useDetail, useReference } from '../features/useCalculator';
import { useCurrentUser, usePermission } from '../lib/session';
import { OptionsTable, type OptionRow } from '../features/OptionsTable';
import { DetailPanel, WarningStrip } from '../features/DetailPanel';
import {
  Badge, Button, Callout, Card, EmptyState, ProvisionalMark, Skeleton, StatTile,
} from '../components/primitives';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditDesignDialog } from '../components/EditDesignDialog';
import { fadeUp } from '../lib/motion';

const SelectedDesignPreview = lazy(() => import('../features/SelectedDesignPreview'));

/** The saved design screen (§11.3). */
export function DesignDetail() {
  const { id } = useParams({ from: '/designs/$id' });
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const reference = useReference();
  const [showAll, setShowAll] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const navigate = useNavigate();
  const canEdit = usePermission('designs.edit');
  const canCalculate = usePermission('designs.calculate');
  const canSelect = usePermission('designs.select');
  const canApprove = usePermission('designs.approve');
  const canRevise = usePermission('designs.revise');
  const canArchive = usePermission('designs.archive');
  const canDelete = usePermission('designs.delete');
  const canCreate = usePermission('designs.create');
  const me = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<null | 'delete' | 'archive'>(null);

  const q = useQuery({ queryKey: ['design', id], queryFn: () => api.design(id) });
  const design = q.data?.design;
  const options = (q.data?.options ?? []) as unknown as OptionRow[];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['design', id] });
    void qc.invalidateQueries({ queryKey: ['designs'] });
  };

  const recalc = useMutation({ mutationFn: () => api.calculateDesign(id), onSuccess: invalidate });
  const select = useMutation({ mutationFn: (optionId: string) => api.selectOption(id, optionId), onSuccess: invalidate });
  const approve = useMutation({ mutationFn: () => api.approve(id), onSuccess: invalidate });
  const revise = useMutation({ mutationFn: () => api.revise(id), onSuccess: invalidate });

  const duplicate = useMutation({
    mutationFn: () => api.duplicateDesign(id),
    onSuccess: (copy) => {
      invalidate();
      void navigate({ to: '/designs/$id', params: { id: copy.id } });
    },
  });

  const archive = useMutation({
    mutationFn: () => api.archiveDesign(id),
    onSuccess: () => { invalidate(); setConfirming(null); },
  });

  const restore = useMutation({ mutationFn: () => api.restoreDesign(id), onSuccess: invalidate });

  const remove = useMutation({
    mutationFn: () => api.deleteDesign(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['designs'] });
      void navigate({ to: '/register' });
    },
  });

  const chosen =
    options.find((o) => `${o.gradeCode}:${o.swg}` === selectedKey) ??
    options.find((o) => (o as unknown as StoredOptionDto).isSelected) ??
    options.find((o) => o.rank === 1);

  const inputs: DesignInputs | null = design ? { ...design.inputs } : null;
  const detail = useDetail(inputs, reference.data, chosen?.gradeCode ?? null, chosen?.swg ?? null);
  const grade = reference.data?.grades.find((g) => g.code === chosen?.gradeCode);
  const locked = design?.status === 'approved' || design?.status === 'superseded';

  if (q.isLoading) {
    return <Card><div className="flex flex-col gap-3 p-5"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div></Card>;
  }
  if (!design) {
    return <Card><EmptyState title="No design with that reference">
      It may have been superseded by a later revision. Check the register.
    </EmptyState></Card>;
  }

  return (
    <div className="flex flex-col gap-6">
      <motion.header variants={fadeUp(Boolean(reduce))} initial="hidden" animate="show">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[24px]">{design.designNo}</h1>
                <Badge tone={design.status === 'approved' ? 'ok' : design.status === 'superseded' ? 'warn' : 'info'}>
                  {design.status}
                </Badge>
                <span className="text-[13px] text-[var(--text-3)]">revision {design.revision}</span>
              </div>
              <p className="mt-1 text-[14px] text-[var(--text-2)]">
                {design.customerName}
                {design.poNo && ` · PO ${design.poNo}`}
                {design.prdNo && ` · PRD ${design.prdNo}`}
                {design.quantity && ` · ${design.quantity} off`}
              </p>
              {design.approvedBy && (
                <p className="mt-1 text-[12px] text-[var(--text-3)]">
                  Approved by {design.approvedBy} on {design.approvedAt?.slice(0, 10)}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a href={`/api/designs/${id}/pdf`} target="_blank" rel="noreferrer">
                <Button size="sm">Calculation sheet</Button>
              </a>
              {!locked && canEdit && (
                <Button size="sm" onClick={() => setEditing(true)}>
                  <HiPencil className="mr-1.5 h-4 w-4" aria-hidden /> Edit
                </Button>
              )}
              {!locked && canCalculate && (
                <Button size="sm" onClick={() => recalc.mutate()} disabled={recalc.isPending}>
                  {recalc.isPending ? 'Recalculating…' : 'Recalculate'}
                </Button>
              )}
              {locked && design.status !== 'archived' && canRevise && (
                <Button size="sm" variant="primary" onClick={() => revise.mutate()} disabled={revise.isPending}>
                  {revise.isPending ? 'Creating…' : 'New revision'}
                </Button>
              )}
              {design.status === 'archived' && canArchive && (
                <Button size="sm" variant="primary" onClick={() => restore.mutate()} disabled={restore.isPending}>
                  <HiUpload className="mr-1.5 h-4 w-4" aria-hidden /> Restore
                </Button>
              )}

              <Dropdown
                arrowIcon={false}
                label=""
                placement="bottom-end"
                renderTrigger={() => (
                  <button
                    type="button"
                    aria-label="More actions"
                    className="flex h-8 w-8 items-center justify-center rounded-[5px] border border-[var(--line)] bg-[var(--surface-1)] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  >
                    <HiDotsVertical className="h-4 w-4" />
                  </button>
                )}
              >
                {canCreate && (
                  <DropdownItem icon={HiDocumentDuplicate} onClick={() => duplicate.mutate()}>
                    Duplicate as new design
                  </DropdownItem>
                )}
                <DropdownItem
                  icon={HiRefresh}
                  onClick={() => window.open(`/api/designs/${id}/bom?format=csv`, '_self')}
                >
                  Download BOM (CSV)
                </DropdownItem>
                {(canArchive || canDelete) && <DropdownDivider />}
                {canArchive && (design.status !== 'archived' ? (
                  <DropdownItem icon={HiArchive} onClick={() => setConfirming('archive')}>
                    Archive
                  </DropdownItem>
                ) : (
                  <DropdownItem icon={HiUpload} onClick={() => restore.mutate()}>
                    Restore
                  </DropdownItem>
                ))}
                {canDelete && (
                  <DropdownItem icon={HiTrash} onClick={() => setConfirming('delete')}>
                    <span style={{ color: 'var(--warn)' }}>Delete</span>
                  </DropdownItem>
                )}
              </Dropdown>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-[var(--line)] p-5 md:grid-cols-6">
            <Spec label="Ratio">{design.inputs.primaryCurrent}/{design.inputs.secondaryCurrent}A</Spec>
            <Spec label="Burden">{design.inputs.burdenVA} VA</Spec>
            <Spec label="Class">{design.inputs.accuracyClass}</Spec>
            <Spec label="Finished ID">{design.inputs.finishedIdMm} mm</Spec>
            <Spec label="Finished OD">{design.inputs.finishedOdMm} mm</Spec>
            <Spec label="CT type">{design.inputs.ctType}</Spec>
          </div>
        </Card>
      </motion.header>

      {design.status === 'superseded' && (
        <Callout tone="warn" title="Superseded">
          A later revision has replaced this design. It is kept on record so the costing quoted
          at the time cannot change after the fact.
        </Callout>
      )}

      {chosen && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Grade" note={`SWG ${chosen.swg}`}>{chosen.gradeLabel}</StatTile>
          <StatTile label="Core width">{chosen.coreWidthMm.toFixed(2)} mm</StatTile>
          <StatTile label="Ordered width" tone="provisional" note={<ProvisionalMark />}>
            {chosen.orderedWidthMm.toFixed(0)} mm
          </StatTile>
          <StatTile label="Material cost" tone="provisional" note={<ProvisionalMark />}>
            {chosen.totalCost === null ? '—' : `₹${chosen.totalCost.toFixed(2)}`}
          </StatTile>
        </div>
      )}

      {detail && <WarningStrip warnings={detail.warnings} />}

      {options.length === 0 ? (
        <Card><EmptyState title="No options calculated yet">
          Run the calculation to produce the ranked grade × gauge options for this design.
        </EmptyState></Card>
      ) : (
        <Card
          title="Options"
          subtitle={locked
            ? 'This design is approved. These are the options as approved, costed against the rates in force at that moment.'
            : 'Choose the option to manufacture. Selecting one builds the bill of materials.'}
          actions={
            !locked && chosen && canSelect && (
              <Button
                size="sm" variant="primary"
                onClick={() => select.mutate((chosen as unknown as StoredOptionDto).id)}
                disabled={select.isPending}
              >
                Select this option
              </Button>
            )
          }
        >
          <OptionsTable
            options={options}
            selectedKey={chosen ? `${chosen.gradeCode}:${chosen.swg}` : null}
            onSelect={(o) => setSelectedKey(`${o.gradeCode}:${o.swg}`)}
            showAll={showAll}
            onToggleShowAll={() => setShowAll((v) => !v)}
          />
        </Card>
      )}

      {chosen?.isFeasible && <Suspense fallback={<Card><div className="p-6">Loading design views...</div></Card>}><SelectedDesignPreview option={chosen} /></Suspense>}

      {detail && (
        <Card
          title={`${chosen?.gradeLabel} · SWG ${chosen?.swg}`}
          subtitle="The full chain, as calculated. Every number traces back to the inputs above."
        >
          <DetailPanel result={detail} grade={grade} />
        </Card>
      )}

      {(q.data?.bom.length ?? 0) > 0 && (
        <Card title="Bill of materials" subtitle="Per unit. Quantities derive from the provisional costing block.">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--line-strong)] text-left">
                {['Type', 'Ref', 'Description', 'Qty', 'Unit'].map((h) => (
                  <th key={h} className="label px-4 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data!.bom.map((l) => (
                <tr key={l.id} className="border-b border-[var(--line)]">
                  <td className="px-4 py-2.5">{l.itemType}</td>
                  <td className="px-4 py-2.5 mono text-[12px]">{l.itemRef ?? '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-2)]">{l.description}</td>
                  <td className="px-4 py-2.5 num">{l.quantity}</td>
                  <td className="px-4 py-2.5">{l.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!locked && design.selectedOptionId && canApprove && (
        <Card
          title="Approve"
          subtitle="Approval locks the design and stores the rates, curves and settings used, so this costing cannot change later."
        >
          <div className="flex flex-wrap items-center gap-3 p-4">
            <Button variant="primary" disabled={approve.isPending} onClick={() => approve.mutate()}>
              {approve.isPending ? 'Approving…' : 'Approve design'}
            </Button>
            <span className="text-[13px] text-[var(--text-2)]">
              Signed off as <strong className="text-[var(--text)]">{me?.name}</strong>.
            </span>
            {approve.error instanceof ApiError && (
              <span className="text-[13px]" style={{ color: 'var(--warn)' }}>{approve.error.message}</span>
            )}
          </div>
        </Card>
      )}

      {!locked && design.selectedOptionId && !canApprove && (
        <Callout tone="info" title="Ready for approval">
          An option has been selected. An approver signs this design off before it goes to
          production.
        </Callout>
      )}

      {(q.data?.history.length ?? 0) > 0 && (
        <Card title="History" subtitle="Every change to this record, with who made it.">
          <ul className="divide-y divide-[var(--line)]">
            {q.data!.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]">
                <span className="font-medium">{h.action}</span>
                <span className="text-[var(--text-2)]">{h.actor}</span>
                <span className="num text-[12px] text-[var(--text-3)]">{h.at.replace('T', ' ').slice(0, 16)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Link to="/register" className="text-[13px] text-[var(--text-2)] underline underline-offset-4">
        ← Back to the register
      </Link>

      <EditDesignDialog design={design} open={editing} onClose={() => setEditing(false)} />

      <ConfirmDialog
        open={confirming === 'archive'}
        onClose={() => setConfirming(null)}
        onConfirm={() => archive.mutate()}
        title={`Archive ${design.designNo}?`}
        confirmLabel="Archive"
        busy={archive.isPending}
        error={archive.error instanceof ApiError ? archive.error.message : null}
      >
        <p>
          It comes out of the working register but stays on record, with its options, bill of
          materials and history intact. You can restore it at any time.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === 'delete'}
        onClose={() => setConfirming(null)}
        onConfirm={() => remove.mutate()}
        title={`Delete ${design.designNo}?`}
        confirmLabel="Delete permanently"
        busy={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
        typeToConfirm={design.designNo}
      >
        <p>
          This removes the design, its calculated options, its bill of materials and any test
          results recorded against it. It cannot be undone.
        </p>
        <p>If you only want it out of the way, archive it instead.</p>
      </ConfirmDialog>
    </div>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="label">{label}</div><div className="mt-0.5 num text-[15px]">{children}</div></div>;
}
