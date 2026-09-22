import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ADMIN_TABS as TABS, ADMIN_LABELS as LABEL, parseAdminTab } from '../lib/adminTabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import type { Die, SteelGrade, WireGauge } from '@meltek/engine';
import { HiPencil, HiPlus, HiTrash } from 'react-icons/hi';
import { api, ApiError, type Customer, type SettingRow } from '../lib/api';
import { useReference } from '../features/useCalculator';
import { Checkbox, Label, TextInput } from 'flowbite-react';
import {
  Badge, Button, Callout, Card, PageHeader, ProvisionalMark, Skeleton, UnconfirmedMark,
} from '../components/primitives';
import { TextField } from '../components/fields';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CustomerDialog, GaugeDialog, GradeDialog } from '../features/admin/dialogs';
import { UsersPanel } from '../features/admin/UsersPanel';
import { usePermission } from '../lib/session';
import { ease, fadeUp } from '../lib/motion';

/** Admin — reference data (§11.5). */
export function Admin() {
  const reduce = useReducedMotion();
  const reference = useReference();
  const canManageUsers = usePermission('users.manage');
  const canEditReference = usePermission('reference.edit');
  const canEditCustomers = usePermission('customers.edit');
  const canDeleteCustomers = usePermission('customers.delete');
  const search = useSearch({ from: '/admin' });
  const navigate = useNavigate();
  const requestedTab = parseAdminTab(search.tab);
  const tab = requestedTab === 'accounts' && !canManageUsers ? 'settings' : requestedTab;
  // Accounts is an administrator's tab; it is hidden rather than shown and refused.
  const tabs = TABS.filter((t) => t !== 'accounts' || canManageUsers);

  if (reference.isLoading) {
    return <Card><div className="flex flex-col gap-3 p-5"><Skeleton className="h-8 w-48" /><Skeleton className="h-64" /></div></Card>;
  }
  if (!reference.data) {
    return <Callout tone="warn" title="Reference data could not be loaded">Check that the API is running, then reload.</Callout>;
  }

  const ref = reference.data;
  const unconfirmed = ref.settingRows.filter((s) => !s.isConfirmed);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Admin" title="Reference data">
        The curves, gauges, dies, rates and process settings the engine reads. Changing one
        here changes every future calculation; approved designs keep the values they were
        approved with.
      </PageHeader>

      {unconfirmed.length > 0 && (
        <Callout tone="warn" title={`${unconfirmed.length} settings still hold their shipped default`}>
          These values have not yet been confirmed for your works. Each one
          explains what it controls and what to consider when setting it.
        </Callout>
      )}

      <div className="reference-tabs flex flex-wrap gap-1" aria-label="Reference data sections">
        {tabs.map((t) => (
          <button
            key={t} type="button" onClick={() => void navigate({ to: '/admin', search: { tab: t } })}
            aria-current={tab === t ? 'page' : undefined}
            className="relative px-3 py-2.5 text-[13px]"
            style={{ color: tab === t ? 'var(--text)' : 'var(--text-2)' }}
          >
            {LABEL[t]}
            {tab === t && (
              <motion.span
                layoutId="admin-tab" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                style={{ background: 'var(--brand)' }}
                transition={reduce ? { duration: 0 } : ease.spring}
              />
            )}
          </button>
        ))}
      </div>

      {!canEditReference && (
        <Callout tone="info" title="You can read this, but not change it">
          Reference data changes every future calculation, so it is maintained by an approver
          or an administrator. Ask one of them if something here needs correcting.
        </Callout>
      )}

      <motion.div variants={fadeUp(Boolean(reduce))} initial="hidden" animate="show" key={tab}>
        {/*
          * A disabled fieldset disables every control inside it, so a read-only account
          * cannot reach a change the API would refuse anyway. The interface and the server
          * agree rather than arguing after the fact.
          */}
        <fieldset disabled={!canEditReference} className="contents">
        {tab === 'settings' && <Settings rows={ref.settingRows} />}
        {tab === 'grades' && <Grades grades={ref.grades} />}
        {tab === 'gauges' && <Gauges gauges={ref.gauges} />}
        {tab === 'dies' && <Dies dies={ref.dies} slitWidths={ref.slitWidthsMm} />}
        {tab === 'rates' && <Rates copperRatePerKg={ref.copperRatePerKg} grades={ref.grades} storeKind={ref.storeKind} />}
        </fieldset>
        {/* Customers are maintained under a separate permission from reference data. */}
        <fieldset disabled={!canEditCustomers} className="contents">
          {tab === 'customers' && <Customers canDelete={canDeleteCustomers} />}
        </fieldset>
        {tab === 'accounts' && canManageUsers && <UsersPanel />}
      </motion.div>
    </div>
  );
}

function useRefreshing<T>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['reference'] }); },
  });
}

/* ─────────── process settings ─────────── */

function Settings({ rows }: { rows: SettingRow[] }) {
  const save = useRefreshing(({ key, value }: { key: string; value: number | boolean }) =>
    api.saveSetting(key, value));

  return (
    <Card
      title="Process settings"
      subtitle="Every constant the calculation uses is a value you can change here. Those still on a shipped default are marked."
    >
      <ul className="divide-y divide-[var(--line)]">
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[1fr_200px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium">{row.label}</span>
                <span className="mono text-[11px] text-[var(--text-3)]">{row.key}</span>
                {row.isConfirmed
                  ? <Badge tone="ok">set</Badge>
                  : <UnconfirmedMark note={row.sourceNote} />}
              </div>
              {row.sourceNote && (
                <p className="measure mt-1 text-[12.5px] text-[var(--text-2)]">{row.sourceNote}</p>
              )}
              {row.updatedBy && (
                <p className="mt-1 text-[11px] text-[var(--text-3)]">
                  Last changed by {row.updatedBy} on {row.updatedAt?.slice(0, 10)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 md:justify-end">
              {typeof row.value === 'boolean' ? (
                <Label className="flex cursor-pointer items-center gap-2 normal-case tracking-normal text-[13px] text-[var(--text-2)]">
                  <Checkbox
                    checked={row.value}
                    onChange={(e) => save.mutate({ key: row.key, value: e.target.checked })}
                  />
                  {row.value ? 'Enabled' : 'Disabled'}
                </Label>
              ) : (
                <>
                  <TextInput
                    className="num w-28 [&_input]:text-right"
                    type="number" step="any" defaultValue={row.value}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== row.value) save.mutate({ key: row.key, value: v });
                    }}
                  />
                  <span className="w-12 text-[12px] text-[var(--text-3)]">{row.unit}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ─────────── grades ─────────── */

function Grades({ grades }: { grades: SteelGrade[] }) {
  const qc = useQueryClient();
  const save = useRefreshing(({ code, body }: { code: string; body: unknown }) => api.saveGrade(code, body));
  const remove = useRefreshing((code: string) => api.deleteGrade(code));
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; grade?: SteelGrade } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SteelGrade | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['reference'] }); };

  return (
    <div className="flex flex-col gap-4">
      <Card
        actions={
          <Button size="sm" variant="primary" onClick={() => setDialog({ mode: 'add' })}>
            <HiPlus className="mr-1.5 h-4 w-4" aria-hidden /> Add grade
          </Button>
        }
        title="Steel grades" subtitle="The B–H curve is what turns magnetising force into flux density for each grade. A grade with no curve cannot be calculated and is greyed out in the options table.">
        <ul className="divide-y divide-[var(--line)]">
          {grades.map((g) => (
            <li key={g.code}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium">{g.label}</span>
                    <span className="mono text-[11px] text-[var(--text-3)]">{g.code}</span>
                    {!g.isAvailable && <Badge tone="warn">not in stock</Badge>}
                    {g.curve.filter((p) => p.hAtCm !== null).length === 0 && <Badge tone="warn">no curve</Badge>}
                    {g.ratePerKg === null && <Badge tone="warn">no rate</Badge>}
                  </div>
                  {g.note && <p className="measure mt-1 text-[12.5px] text-[var(--text-2)]">{g.note}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <Label className="flex items-center gap-2">
                    ₹/kg
                    <TextInput
                      className="num w-24 [&_input]:text-right" type="number" step="any"
                      defaultValue={g.ratePerKg ?? ''}
                      placeholder="—"
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v !== g.ratePerKg) save.mutate({ code: g.code, body: { ...g, ratePerKg: v } });
                      }}
                    />
                  </Label>
                  <Label className="flex cursor-pointer items-center gap-2 normal-case tracking-normal text-[13px] text-[var(--text-2)]">
                    <Checkbox
                      checked={g.isAvailable}
                      onChange={(e) => save.mutate({ code: g.code, body: { ...g, isAvailable: e.target.checked } })}
                    />
                    in stock
                  </Label>
                  <Button size="sm" onClick={() => setOpen(open === g.code ? null : g.code)}>
                    {open === g.code ? 'Hide curve' : `Curve (${g.curve.filter((p) => p.hAtCm !== null).length} pts)`}
                  </Button>
                  <Button size="sm" title="Edit grade" onClick={() => setDialog({ mode: 'edit', grade: g })}>
                    <HiPencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button size="sm" title="Delete grade" onClick={() => setPendingDelete(g)}>
                    <HiTrash className="h-4 w-4" aria-hidden style={{ color: 'var(--warn)' }} />
                  </Button>
                </div>
              </div>

              {open === g.code && (
                <div className="border-t border-[var(--line)] bg-[var(--surface-2)] px-5 py-4">
                  <p className="measure mb-3 text-[12.5px] text-[var(--text-2)]">
                    Magnetising force in AT/cm against flux density in tesla. Leave a cell blank
                    where the grade is not characterised — blank rows are skipped, never read as
                    zero.
                  </p>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
                    {g.curve.map((p, i) => (
                      <label key={p.teslaT} className="flex items-center gap-2">
                        <span className="mono w-12 shrink-0 text-right text-[12px] text-[var(--text-3)]">{p.teslaT}</span>
                        <TextInput
                          className="num flex-1" sizing="sm" type="number" step="any"
                          defaultValue={p.hAtCm ?? ''}
                          placeholder="—"
                          onBlur={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            if (v === p.hAtCm) return;
                            const curve = g.curve.map((q, j) => (j === i ? { ...q, hAtCm: v } : q));
                            save.mutate({ code: g.code, body: { ...g, curve } });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <GradeDialog
        open={dialog !== null}
        existing={dialog?.mode === 'edit' ? dialog.grade : null}
        onClose={() => setDialog(null)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.code, { onSuccess: () => setPendingDelete(null) });
        }}
        title={pendingDelete ? `Delete ${pendingDelete.label}?` : 'Delete grade'}
        confirmLabel="Delete grade"
        busy={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
      >
        <p>
          The grade and its B–H curve are removed, and it stops appearing in new calculations.
        </p>
        <p>
          Designs already approved keep their own copy of the curve and rate, so their costings
          do not change.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/* ─────────── gauges ─────────── */

function Gauges({ gauges }: { gauges: WireGauge[] }) {
  const qc = useQueryClient();
  const save = useRefreshing(({ swg, body }: { swg: number; body: unknown }) => api.saveGauge(swg, body));
  const remove = useRefreshing((swg: number) => api.deleteGauge(swg));
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; gauge?: WireGauge } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WireGauge | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['reference'] }); };

  return (
    <Card
      actions={
        <Button size="sm" variant="primary" onClick={() => setDialog({ mode: 'add' })}>
          <HiPlus className="mr-1.5 h-4 w-4" aria-hidden /> Add wire size
        </Button>
      }
      title="Wire gauges"
      subtitle="Wire sizes available to the calculation. Resistance at 75 °C is shown as missing until you enter it, rather than estimated."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--line-strong)] text-left">
              {['SWG', 'Dia mm', 'Area mm²', 'Ω/m @20°C', 'Ω/m @75°C', 'g/m', 'In stock', ''].map((h, i) => (
                <th key={h || `a-${i}`} className="label px-4 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gauges.map((g) => (
              <tr key={g.swg} className="border-b border-[var(--line)]">
                <td className="px-4 py-2 num font-medium">{g.swg}</td>
                <td className="px-4 py-2 num">{g.diaMm}</td>
                <td className="px-4 py-2 num">{g.areaSqmm}</td>
                <td className="px-4 py-2 num mono text-[12px]">{g.ohmPerM20c}</td>
                <td className="px-4 py-2">
                  {g.ohmPerM75c === null
                    ? <Badge tone="warn">not entered</Badge>
                    : <span className="num mono text-[12px]">{g.ohmPerM75c}</span>}
                </td>
                <td className="px-4 py-2 num">{g.gramPerM}</td>
                <td className="px-4 py-2">
                  <Checkbox
                    checked={g.isAvailable}
                    aria-label={`SWG ${g.swg} in stock`}
                    onChange={(e) => save.mutate({ swg: g.swg, body: { ...g, isAvailable: e.target.checked } })}
                  />
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-1">
                    <Button size="xs" title={`Edit SWG ${g.swg}`} onClick={() => setDialog({ mode: 'edit', gauge: g })}>
                      <HiPencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <Button size="xs" title={`Delete SWG ${g.swg}`} onClick={() => setPendingDelete(g)}>
                      <HiTrash className="h-3.5 w-3.5" aria-hidden style={{ color: 'var(--warn)' }} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <GaugeDialog
        open={dialog !== null}
        existing={dialog?.mode === 'edit' ? dialog.gauge : null}
        onClose={() => setDialog(null)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete.swg, { onSuccess: () => setPendingDelete(null) });
        }}
        title={pendingDelete ? `Delete SWG ${pendingDelete.swg}?` : 'Delete wire size'}
        confirmLabel="Delete wire size"
        busy={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
      >
        <p>This wire size stops appearing in new calculations. Existing designs are unaffected.</p>
      </ConfirmDialog>
    </Card>
  );
}

/* ─────────── dies & slit widths ─────────── */

function Dies({ dies, slitWidths }: { dies: Die[]; slitWidths: number[] }) {
  const saveDies = useRefreshing((v: unknown[]) => api.saveDies(v));
  const saveSlits = useRefreshing((v: number[]) => api.saveSlitWidths(v));
  const [draft, setDraft] = useState({ dieNo: '', minOdMm: '', maxOdMm: '', maxWidthMm: '', quantity: '1', location: '' });
  const [slits, setSlits] = useState(slitWidths.join(', '));
  const [pendingDelete, setPendingDelete] = useState<Die | null>(null);

  /** Dies are stored as a set, so an edit rewrites the row in place and saves them all. */
  const patchDie = (id: string, patch: Partial<Die>) =>
    saveDies.mutate(dies.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Die register"
        subtitle="Your moulds, and the core sizes each one takes. Until at least one die is entered, options are not checked against tooling."
      >
        {dies.length === 0 ? (
          <div className="px-5 py-4">
            <Callout tone="warn" title="No dies on record">
              Options are not checked against tooling. Add your dies and the options table will
              start rejecting cores no mould can take.
            </Callout>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--line-strong)] text-left">
                {['Die no', 'Min OD', 'Max OD', 'Max width', 'Qty', 'Location', ''].map((h) => (
                  <th key={h} className="label px-4 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dies.map((d) => (
                <tr key={d.id} className="border-b border-[var(--line)]">
                  <td className="px-4 py-2">
                    <TextInput
                      sizing="sm" defaultValue={d.dieNo}
                      onBlur={(e) => { if (e.target.value !== d.dieNo) patchDie(d.id, { dieNo: e.target.value }); }}
                    />
                  </td>
                  {(['minOdMm', 'maxOdMm', 'maxWidthMm', 'quantity'] as const).map((field) => (
                    <td key={field} className="px-4 py-2">
                      <TextInput
                        sizing="sm" type="number" step="any" className="num w-24 [&_input]:text-right"
                        defaultValue={d[field]}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v !== d[field]) patchDie(d.id, { [field]: v } as Partial<Die>);
                        }}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <TextInput
                      sizing="sm" defaultValue={d.location ?? ''}
                      onBlur={(e) => { if (e.target.value !== (d.location ?? '')) patchDie(d.id, { location: e.target.value || null }); }}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="xs" title={`Delete die ${d.dieNo}`} onClick={() => setPendingDelete(d)}>
                      <HiTrash className="h-3.5 w-3.5" aria-hidden style={{ color: 'var(--warn)' }} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="grid grid-cols-2 gap-3 border-t border-[var(--line)] p-4 md:grid-cols-6">
          {([['dieNo', 'Die no'], ['minOdMm', 'Min OD'], ['maxOdMm', 'Max OD'], ['maxWidthMm', 'Max width'], ['quantity', 'Qty'], ['location', 'Location']] as const).map(([k, label]) => (
            <TextField
              key={k} label={label} value={draft[k]}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          ))}
          <div className="col-span-2 md:col-span-6">
            <Button
              variant="primary" size="sm"
              disabled={!draft.dieNo || !draft.maxWidthMm}
              onClick={() => {
                saveDies.mutate([...dies, {
                  dieNo: draft.dieNo,
                  minOdMm: Number(draft.minOdMm || 0),
                  maxOdMm: Number(draft.maxOdMm || 0),
                  maxWidthMm: Number(draft.maxWidthMm),
                  quantity: Number(draft.quantity || 1),
                  location: draft.location || null,
                  isAvailable: true,
                }]);
                setDraft({ dieNo: '', minOdMm: '', maxOdMm: '', maxWidthMm: '', quantity: '1', location: '' });
              }}
            >
              Add die
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title="Stocked slit widths"
        subtitle="Steel arrives in fixed widths. Until these are entered, core widths round up to the nearest 5 mm instead of to a width you buy."
      >
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[280px] flex-1">
            <TextField
              label="Widths, mm, comma separated" value={slits}
              onChange={(e) => setSlits(e.target.value)} placeholder="10, 15, 20, 25, 30…"
            />
          </div>
          <Button
            variant="primary"
            onClick={() => saveSlits.mutate(
              slits.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0),
            )}
          >
            Save widths
          </Button>
          {slitWidths.length === 0 && <span className="text-[12px]" style={{ color: 'var(--warn)' }}>none on record</span>}
        </div>
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            saveDies.mutate(dies.filter((x) => x.id !== pendingDelete.id), {
              onSuccess: () => setPendingDelete(null),
            });
          }
        }}
        title={pendingDelete ? `Delete die ${pendingDelete.dieNo}?` : 'Delete die'}
        confirmLabel="Delete die"
        busy={saveDies.isPending}
      >
        <p>
          Options will no longer be checked against this mould. If it was the only die wide
          enough for a design, that design will start reporting no tooling.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/* ─────────── customers ─────────── */

function Customers({ canDelete }: { canDelete: boolean }) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ['customers'], queryFn: api.customers });
  const [editing, setEditing] = useState<Customer | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Customer | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['customers'] });
    void qc.invalidateQueries({ queryKey: ['reference'] });
    void qc.invalidateQueries({ queryKey: ['designs'] });
  };

  const remove = useMutation({
    mutationFn: (c: Customer) => api.deleteCustomer(c.id),
    onSuccess: () => { refresh(); setPendingDelete(null); },
  });

  const rows = customers.data ?? [];

  return (
    <Card
      title="Customers"
      subtitle="Created automatically the first time a design is raised against a name. Rename one here and every design on record follows."
    >
      {customers.isLoading && <div className="p-5"><Skeleton className="h-24 w-full" /></div>}

      {!customers.isLoading && rows.length === 0 && (
        <div className="px-5 py-10 text-center text-[13px] text-[var(--text-2)]">
          No customers yet. The first design you save creates one.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--line-strong)] text-left">
                {['Customer', 'GSTIN', 'Contact', 'Email', 'Phone', 'Designs', ''].map((h, i) => (
                  <th key={h || `a-${i}`} className="label px-4 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-[var(--line)]">
                  <td className="px-4 py-2.5 font-medium">{c.name}</td>
                  <td className="px-4 py-2.5 mono text-[12px] text-[var(--text-2)]">{c.gstin || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-2)]">{c.contactName || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-2)]">{c.contactEmail || '—'}</td>
                  <td className="px-4 py-2.5 num text-[var(--text-2)]">{c.phone || '—'}</td>
                  <td className="px-4 py-2.5 num">{c.designCount ?? 0}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" title={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                        <HiPencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <Button
                        size="xs"
                        title={!canDelete
                          ? 'Only an approver or administrator can delete a customer'
                          : (c.designCount ?? 0) > 0
                            ? 'Customers with designs on record cannot be deleted'
                            : `Delete ${c.name}`}
                        disabled={!canDelete || (c.designCount ?? 0) > 0}
                        onClick={() => setPendingDelete(c)}
                      >
                        <HiTrash className="h-3.5 w-3.5" aria-hidden style={{ color: 'var(--warn)' }} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CustomerDialog
        open={editing !== null}
        customer={editing}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) remove.mutate(pendingDelete); }}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete customer'}
        confirmLabel="Delete customer"
        busy={remove.isPending}
        error={remove.error instanceof ApiError ? remove.error.message : null}
      >
        <p>The customer record is removed. This cannot be undone.</p>
      </ConfirmDialog>
    </Card>
  );
}

/* ─────────── rates ─────────── */

function Rates({
  copperRatePerKg, grades, storeKind,
}: { copperRatePerKg: number; grades: SteelGrade[]; storeKind: string }) {
  const save = useRefreshing((v: number) => api.saveCopperRate(v));
  const [rate, setRate] = useState(String(copperRatePerKg));

  return (
    <div className="flex flex-col gap-4">
      <Card title="Material rates" subtitle="Approved designs snapshot the rates they were approved with, so a rate change never rewrites a past costing.">
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] p-4">
          <div className="w-36">
            <TextField
              label="Copper ₹/kg" type="number" step="any" value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
          <Button variant="primary" onClick={() => save.mutate(Number(rate))}>Save rate</Button>
        </div>
        <ul className="divide-y divide-[var(--line)]">
          {grades.map((g) => (
            <li key={g.code} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
              <span>{g.label}</span>
              <span className="num">
                {g.ratePerKg === null
                  ? <Badge tone="warn">no rate on record</Badge>
                  : `₹${g.ratePerKg}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="System">
        <div className="flex flex-col gap-2 p-4 text-[13px] text-[var(--text-2)]">
          <p>Storage: <span className="mono">{storeKind}</span></p>
          <p className="flex items-center gap-2">
            Weights and costs are marked <ProvisionalMark /> because they follow the rate table
            above, which moves. The works order is the final word on a quoted price.
          </p>
        </div>
      </Card>
    </div>
  );
}
