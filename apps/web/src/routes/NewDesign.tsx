import { accuracyClassLabel } from '../lib/accuracyClasses';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { z } from 'zod';
import { ltCtFamily, type DesignInputs, type EngineeringSpec } from '@meltek/engine';
import { EngineeringEditor } from '../features/EngineeringEditor';
import { DesignStudio } from '../features/DesignStudio';
import { designInputsSchema } from '@meltek/schema';
import { api, ApiError } from '../lib/api';
import { useCalculator, useDetail, useReference } from '../features/useCalculator';
import { usePermission } from '../lib/session';
import { OptionsTable, type OptionRow } from '../features/OptionsTable';
import { DetailPanel, WarningStrip } from '../features/DetailPanel';
import {
  AnimatedNumber, Badge, Button, Callout, Card, EmptyState, PageHeader, ProvisionalMark,
  Skeleton, StatTile,
} from '../components/primitives';
import { SelectField, TextField } from '../components/fields';
import { duration, ease, fadeUp } from '../lib/motion';

/** The form carries the order fields alongside the electrical spec (§11.1). */
const formSchema = z.object({
  customerName: z.string().min(1, 'Customer is required.'),
  enquiryNo: z.string().optional(),
  poNo: z.string().optional(),
  prdNo: z.string().optional(),
  quantity: z.coerce.number().int().positive().optional().or(z.literal('')),
  requiredBy: z.string().optional(),
  insulationType: z.string().optional(),
  primaryCurrent: z.coerce.number().positive('Primary current must be greater than zero.'),
  secondaryCurrent: z.coerce.number().positive(),
  burdenVA: z.coerce.number().positive('Burden must be greater than zero.'),
  accuracyClass: z.string().min(1),
  finishedIdMm: z.coerce.number().positive('Finished ID must be greater than zero.'),
  finishedOdMm: z.coerce.number().positive('Finished OD must be greater than zero.'),
  maxWidthMm: z.coerce.number().positive().optional().or(z.literal('')),
  ctType: z.enum(['ring', 'wound-primary']),
});

type FormValues = z.input<typeof formSchema>;

const SelectedDesignPreview = lazy(() => import('../features/SelectedDesignPreview'));

const DEFAULTS: FormValues = {
  customerName: '', enquiryNo: '', poNo: '', prdNo: '', quantity: '', requiredBy: '',
  insulationType: '', primaryCurrent: 300, secondaryCurrent: 5, burdenVA: 5,
  accuracyClass: '0.5S', finishedIdMm: 40, finishedOdMm: 75, maxWidthMm: '', ctType: 'ring',
};

export function NewDesign() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const reference = useReference();
  const canCreate = usePermission('designs.create');
  const canSelect = usePermission('designs.select');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [engineering, setEngineering] = useState<EngineeringSpec | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULTS,
    mode: 'onChange',
  });
  const values = form.watch();

  /** Valid electrical spec → live engine run, in the browser, on every keystroke (§3.1). */
  const inputs: DesignInputs | null = useMemo(() => {
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
    });
    return parsed.success ? (parsed.data as DesignInputs) : null;
  }, [values.primaryCurrent, values.secondaryCurrent, values.burdenVA, values.accuracyClass,
    values.finishedIdMm, values.finishedOdMm, values.ctType, values.maxWidthMm, engineering]);

  const { result, error } = useCalculator(inputs, reference.data);

  const options: OptionRow[] = result?.options ?? [];
  const best = options.find((o) => o.rank === 1) ?? null;

  // Keep a selection alive across recalculations, falling back to the leader.
  useEffect(() => {
    if (!result) return;
    const exists = options.some((o) => `${o.gradeCode}:${o.swg}` === selectedKey && o.converged);
    const fallback = best ?? options.find(o => o.converged);
    if (!exists) setSelectedKey(fallback ? `${fallback.gradeCode}:${fallback.swg}` : null);
  }, [result, options, selectedKey, best]);

  const selected = options.find((o) => `${o.gradeCode}:${o.swg}` === selectedKey) ?? best ?? options.find(o => o.converged) ?? options[0] ?? null;
  const detail = useDetail(inputs, reference.data, selected?.gradeCode ?? null, selected?.swg ?? null);
  const grade = reference.data?.grades.find((g) => g.code === selected?.gradeCode);

  /** Similar design matching, shown before the save action (§11.1). */
  const similar = useQuery({
    queryKey: ['similar', inputs],
    queryFn: () => api.similar(inputs as unknown as Record<string, never>),
    enabled: Boolean(inputs),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const design = await api.createDesign({
        customerName: v.customerName,
        enquiryNo: v.enquiryNo || null,
        poNo: v.poNo || null,
        prdNo: v.prdNo || null,
        quantity: v.quantity === '' ? null : Number(v.quantity),
        requiredBy: v.requiredBy || null,
        insulationType: v.insulationType || null,
        inputs,
      });
      const calculated = await api.calculateDesign(design.id);
      const choice = calculated.options.find(o => `${o.gradeCode}:${o.swg}` === selectedKey && o.isFeasible)
        ?? calculated.options.find(o => o.rank === 1);
      if (choice && canSelect) await api.selectOption(design.id, choice.id);
      return design;
    },
    onSuccess: (design) => navigate({ to: '/designs/$id', params: { id: design.id } }),
  });

  const classes = engineering?.purpose === 'protection'
    ? ['5P','10P'].map(code=>({code,perIS:false,note:'Protection engineering screening; confirm standard and limits.'}))
    : engineering?.purpose === 'ps' ? ['PS','PX'].map(code=>({code,perIS:false,note:'Special protection: specify knee voltage, excitation and resistance requirements.'}))
    : (reference.data?.classes ?? []).filter(c=>!['5P','10P','PS','PX'].includes(c.code));
  const unconfirmed = (reference.data?.settingRows ?? []).filter((s) => !s.isConfirmed);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Engineering workspace / LT CT" title="Design less. Discover more.">
        Every grade and gauge is computed as you type, ranked by material cost. Nothing is
        saved until you say so.
      </PageHeader>



      <div className="flex flex-col gap-8">
        {/* ── the form ── */}
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <div className="workflow-heading"><span>01</span><div><h2>Define your design</h2><p>Enter the electrical requirements, dimensions and order details.</p></div></div>
          <div className="parameter-grid">
          <Card title="Customer & order">
            <div className="grid grid-cols-2 gap-3 p-4">
              <TextField
                label="Customer" span list="customers" placeholder="Company name"
                error={form.formState.errors.customerName?.message}
                {...form.register('customerName')}
              />
              <datalist id="customers">
                {(reference.data?.customers ?? []).map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
              <TextField label="Enquiry no" {...form.register('enquiryNo')} />
              <TextField label="PO no" {...form.register('poNo')} />
              <TextField label="PRD no" {...form.register('prdNo')} />
              <TextField label="Quantity" type="number" {...form.register('quantity')} />
              <TextField label="Required by" span type="date" {...form.register('requiredBy')} />
            </div>
          </Card>

          <Card title="Electrical spec">
            <div className="grid grid-cols-2 gap-3 p-4">
              <TextField
                label="Primary current Ip" unit="A" type="number" step="any"
                hint="The large current being measured - the 300 in 300/5A."
                error={form.formState.errors.primaryCurrent?.message}
                {...form.register('primaryCurrent')}
              />
              <SelectField
                label="Secondary current Is"
                hint="Output to the meter. Almost always 5 A, occasionally 1 A."
                {...form.register('secondaryCurrent')}
              >
                <option value={5}>5 A</option>
                <option value={1}>1 A</option>
              </SelectField>
              <TextField
                label="Burden" unit="VA" type="number" step="any"
                hint="Power the customer's meter and its wiring draw from the CT."
                error={form.formState.errors.burdenVA?.message}
                {...form.register('burdenVA')}
              />
              <SelectField
                label="Accuracy class" span aria-label="Accuracy class"
                hint="Permitted error. A tighter class needs more steel."
                {...form.register('accuracyClass')}
                value={values.accuracyClass}
              >
                {classes.map((c) => (
                  <option key={c.code} value={c.code}>{accuracyClassLabel(c.code)}</option>
                ))}
              </SelectField>
            </div>
            {classes.find((c) => c.code === values.accuracyClass && !c.perIS) && (
              <p className="border-t border-[var(--line)] px-4 py-3 text-[12px] text-[var(--text-3)]">
                {classes.find((c) => c.code === values.accuracyClass)?.note}
              </p>
            )}
          </Card>

          <Card title="Physical limits">
            <div className="grid grid-cols-2 gap-3 p-4">
              <TextField
                label="Finished ID" unit="mm" type="number" step="any"
                hint="Inner diameter of the moulded part, given by the customer."
                error={form.formState.errors.finishedIdMm?.message}
                {...form.register('finishedIdMm')}
              />
              <TextField
                label="Finished OD" unit="mm" type="number" step="any"
                hint="Outer diameter of the moulded part, given by the customer."
                error={form.formState.errors.finishedOdMm?.message}
                {...form.register('finishedOdMm')}
              />
              <TextField
                label="Max width" unit="mm" type="number" step="any"
                hint="Optional. Engineering mode limits finished axial width; legacy mode limits ordered core width."
                {...form.register('maxWidthMm')}
              />
              <SelectField
                label="CT type"
                hint="Ring type: the customer's busbar passes through, no primary winding."
                {...form.register('ctType')}
              >
                <option value="ring">Ring type</option>
                <option value="wound-primary" disabled>Wound primary (not yet supported)</option>
              </SelectField>
              <TextField label="Insulation type" span {...form.register('insulationType')} />
            </div>
          </Card>

          </div>

          <EngineeringEditor value={engineering} reference={reference.data} onChange={next => {
            if ((next?.purpose ?? 'metering') !== (engineering?.purpose ?? 'metering')) form.setValue('accuracyClass', next?.purpose === 'protection' ? '5P' : next?.purpose === 'ps' ? 'PS' : '0.5S');
            setEngineering(next);
          }}/>

          {/* Similar designs, before the calculate/save action (§11.1). */}
          <AnimatePresence>
            {(similar.data?.similar.length ?? 0) > 0 && (
              <motion.div
                variants={fadeUp(Boolean(reduce))} initial="hidden" animate="show" exit="exit"
              >
                <Card
                  title="This has been designed before"
                  subtitle="A repeat order should reuse a proven design rather than starting again."
                >
                  <ul className="divide-y divide-[var(--line)]">
                    {similar.data!.similar.map((s) => (
                      <li key={s.design.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <div className="flex items-center gap-2 text-[13px] font-medium">
                            {s.design.designNo}
                            <Badge tone={s.design.status === 'approved' ? 'ok' : 'neutral'}>{s.design.status}</Badge>
                          </div>
                          <div className="mt-0.5 text-[12px] text-[var(--text-3)]">
                            {s.design.customerName} · {s.matches.join(' · ')}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => navigate({ to: '/designs/$id', params: { id: s.design.id } })}
                        >
                          Reuse this
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {save.error instanceof ApiError && (
            <Callout tone="warn" title="This design could not be saved">
              {save.error.message}
              {save.error.issues.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {save.error.issues.map((i) => <li key={i.path}>{i.message}</li>)}
                </ul>
              )}
            </Callout>
          )}

          <div className="flex items-center gap-3">
            {canCreate && (
              <Button type="submit" variant="primary" disabled={!inputs || !result || (!best && !engineering) || save.isPending}>
                {save.isPending ? 'Saving…' : !best && engineering ? 'Save draft with missing data' : 'Save design & options'}
              </Button>
            )}
            <span className="text-[12px] text-[var(--text-3)]">
              {!canCreate
                ? 'Your account can calculate but not save designs.'
                : result
                  ? `${result.options.length} combinations in ${result.computedAtMs} ms`
                  : 'Waiting for a valid spec'}
            </span>
          </div>
        </form>

        {/* ── results ── */}
        <div className="flex min-w-0 flex-col gap-4">
          {reference.isLoading && (
            <Card><div className="flex flex-col gap-3 p-5"><Skeleton className="h-6 w-48" /><Skeleton className="h-40 w-full" /></div></Card>
          )}

          {reference.isError && (
            <Callout tone="warn" title="Reference data could not be loaded">
              The grades, gauges and process settings come from the server. Reload the page; if it
              persists, check that the API is running.
            </Callout>
          )}

          {error && <Callout tone="warn" title="This specification cannot be built">{error}</Callout>}

          {!inputs && !error && reference.data && (
            <Card><EmptyState title="Enter the electrical spec">
              Ratio, burden, class and the finished ID/OD are all it takes. The calculation runs
              as you type — there is no calculate button and no waiting.
            </EmptyState></Card>
          )}

          {result && !best && <Callout tone="warn" title="No feasible combination">Review the rejected options below, adjust your dimensions, or update stock and reference data.</Callout>}

          {result && selected && (
            <>
              <div className="workflow-heading" id="design-guidance"><span>02</span><div><h2>Review the guidance</h2><p>Check these assumptions and reference-data requirements before choosing an option.</p></div></div>
              <WarningStrip warnings={[
                ...result.warnings,
                ...(detail?.warnings ?? []),
                ...(unconfirmed.length
                  ? [{
                      code: 'UNCONFIRMED_SETTINGS',
                      ref: 'Settings',
                      message: `${unconfirmed.length} settings still hold their shipped default: ${unconfirmed.map((s) => s.label).join(', ')}. Review them under Reference data.`,
                    }]
                  : []),
              ]} />

              <div className="workflow-heading"><span>03</span><div><h2>Compare design combinations</h2><p>Select a row to inspect its dimensions, diagram and 3D model.</p></div></div>
      <DesignStudio inputs={inputs} best={best} options={options} quantity={Number(values.quantity) || 1} family={ltCtFamily.label} />
              <Card
                title="Ranked options"
                subtitle="Every grade × gauge combination, cheapest configured cost first. Infeasible rows stay visible with their reason."
              >
                <OptionsTable
                  options={options}
                  selectedKey={selectedKey}
                  onSelect={(o) => setSelectedKey(`${o.gradeCode}:${o.swg}`)}
                  showAll={showAll || !best}
                  onToggleShowAll={() => setShowAll((v) => !v)}
                />
              </Card>

              <div className="workflow-heading"><span>04</span><div><h2>Explore the selected design</h2><p>{selected.gradeLabel} · SWG {selected.swg}</p></div></div>
              <motion.div
                className="grid grid-cols-2 gap-3 md:grid-cols-4"
                variants={fadeUp(Boolean(reduce))} initial="hidden" animate="show"
              >
                <StatTile label="Core width" note={`${selected.gradeLabel} · SWG ${selected.swg}`}>
                  <AnimatedNumber value={selected.coreWidthMm} dp={2} suffix=" mm" />
                </StatTile>
                <StatTile label="Ordered width" tone="provisional" note={<ProvisionalMark />}>
                  <AnimatedNumber value={selected.orderedWidthMm} dp={0} suffix=" mm" />
                </StatTile>
                <StatTile
                  label="Flux density"
                  note={selected.wasCapped ? <Badge tone="warn">ceiling applied</Badge> : `from the ${selected.gradeLabel} curve`}
                >
                  <AnimatedNumber value={selected.bUsedT} dp={4} suffix=" T" />
                </StatTile>
                <StatTile label={engineering?.costing.basis === 'manufacturing' ? 'Manufacturing cost' : 'Material cost'} tone="provisional" note={<ProvisionalMark />}>
                  <AnimatedNumber value={selected.totalCost} dp={2} prefix="₹" />
                </StatTile>
              </motion.div>


              {selected.converged && <Suspense fallback={<Card><div className="p-6">Loading design views...</div></Card>}><SelectedDesignPreview option={selected} /></Suspense>}
              <AnimatePresence mode="wait">
                {detail && (
                  <motion.div
                    key={`${selected.gradeCode}:${selected.swg}`}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                    animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: duration.micro } }}
                    transition={{ duration: duration.base, ease: ease.out }}
                  >
                    <Card
                      title={`${selected.gradeLabel} · SWG ${selected.swg}`}
                      subtitle="Every substituted value, the convergence passes, and the operating point on the grade's curve."
                    >
                      <DetailPanel result={detail} grade={grade} />
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

