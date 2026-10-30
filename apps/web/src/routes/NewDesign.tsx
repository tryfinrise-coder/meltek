import { accuracyClassLabel } from '../lib/accuracyClasses';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { z } from 'zod';
import { type DesignInputs, type EngineeringSpec, type WireCombinationEntry } from '@meltek/engine';
import { EngineeringEditor } from '../features/EngineeringEditor';
import { WindingAnalysis } from '../features/WindingAnalysis';
import { designInputsSchema } from '@meltek/schema';
import { api, ApiError } from '../lib/api';
import { useCalculator, useDetail, useReference } from '../features/useCalculator';
import { usePermission } from '../lib/session';
import { OptionsTable, type OptionRow } from '../features/OptionsTable';
import { DetailPanel, WarningStrip } from '../features/DetailPanel';
import {
  AnimatedNumber, Badge, Button, Callout, Card, EmptyState,
  Skeleton,
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
  const [activeSection, setActiveSection] = useState('calculator-inputs');
  const [windingInputHost, setWindingInputHost] = useState<HTMLDivElement | null>(null);
  const [engineering, setEngineering] = useState<EngineeringSpec | null>(null);
  const [wireComboEnabled, setWireComboEnabled] = useState(true);
  const [wireMap, setWireMap] = useState<Record<number, number>>({});

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULTS,
    mode: 'onChange',
  });
  const values = form.watch();

  const wireCombination: WireCombinationEntry[] | null = useMemo(() => {
    if (!wireComboEnabled) return null;
    const entries = Object.entries(wireMap)
      .filter(([, count]) => count > 0)
      .map(([swg, count]) => ({ swg: Number(swg), count }));
    return entries.length > 0 ? entries : null;
  }, [wireComboEnabled, wireMap]);

  const setWireCount = useCallback((swg: number, count: number) => {
    setWireMap(prev => ({ ...prev, [swg]: Math.max(0, count) }));
  }, []);

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
      wireCombination,
    });
    return parsed.success ? (parsed.data as DesignInputs) : null;
  }, [values.primaryCurrent, values.secondaryCurrent, values.burdenVA, values.accuracyClass,
    values.finishedIdMm, values.finishedOdMm, values.ctType, values.maxWidthMm, engineering, wireCombination]);

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
    <div className="calculator-page workspace-redesign flex flex-col gap-6" data-view={activeSection}>
      <header className="workspace-topbar">
        <div className="workspace-title"><span className="workspace-title-mark" aria-hidden="true">M</span><h1>CT design calculator</h1></div>
        <div className="workspace-status" role="status"><span />{reference.isLoading ? 'Loading references' : reference.isError ? 'References unavailable' : error ? 'Check specification' : result ? 'Calculations up to date' : 'Enter your specification'}<small>{engineering ? 'Engineering mode' : 'Metering mode'}</small></div>
      </header>
      <section className="workspace-overview" aria-label="Design at a glance">
        <div><span>Current ratio</span><strong className="num">{values.primaryCurrent || '—'}<small> / {values.secondaryCurrent || '—'} A</small></strong></div>
        <div><span>Finished ID × OD</span><strong className="num">{values.finishedIdMm || '—'}<small> × </small>{values.finishedOdMm || '—'}<small> mm</small></strong></div>
        <div><span>Feasible / evaluated</span><strong className="num">{options.filter(o=>o.isFeasible).length}<small> / {options.length}</small></strong></div>
        <div className="workspace-estimate"><span>Estimate / unit</span><strong className="num">{selected?.totalCost != null ? `₹${selected.totalCost.toLocaleString('en-IN', {maximumFractionDigits:2})}` : '—'}</strong></div>
      </section>
      <nav className="workspace-view-switch" aria-label="Calculator workspace views">
        {[
          ['calculator-inputs', '01', 'Inputs', 'Specification & construction'],
          ['calculator-results', '02', 'Results', 'Compare & verify'],
          ['calculator-model', '03', '3D model', 'Explore the assembly'],
        ].map(([target, number, label]) => <button key={target} type="button" aria-pressed={activeSection===target} aria-controls={target} onClick={()=>{
          setActiveSection(target!);
          requestAnimationFrame(()=>document.getElementById(target!)?.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'}));
        }}><span className="num">{number}</span><strong>{label}</strong></button>)}
      </nav>

      <div className="calculator-columns">
        {/* ── the form ── */}
        <form
          id="calculator-inputs"
          className="calculator-inputs flex min-w-0 flex-col gap-4"
          aria-label="Design input parameters"
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <div className="workflow-heading"><span>01</span><div><h2>Input parameters</h2></div></div>
          <div className="parameter-grid">
          <details className="workspace-input-group" open><summary><span>Electrical requirements<small>Ratio, burden & accuracy</small></span><span className="workspace-chevron" aria-hidden="true">⌄</span></summary>
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


          </details>
          <details className="workspace-input-group" open><summary><span>Core dimensions<small>Finished size & physical limits</small></span><span className="workspace-chevron" aria-hidden="true">⌄</span></summary>
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
          </details>
          <details className="workspace-input-group" open={form.formState.errors.customerName ? true : undefined}><summary><span>Customer & order<small>Order details for saving</small></span><span className="workspace-chevron" aria-hidden="true">⌄</span></summary>
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


          </details>
          </div>

          <details className="workspace-input-group" ><summary><span>Wire configuration<small>Automatic search or fixed combination</small></span><span className="workspace-chevron" aria-hidden="true">⌄</span></summary>
          {/* Wire combination picker */}
          <Card title="Wire combination" subtitle={wireComboEnabled && wireCombination
            ? `${wireCombination.map(e => `${e.count}×${e.swg} SWG`).join(' + ')} — optimizer ranks grades only`
            : 'Fix the wire selection and rank by grade alone'}>
            <div className="px-4 py-3">
              <label className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={wireComboEnabled}
                  onChange={e => setWireComboEnabled(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                <span>Use a fixed wire combination</span>
              </label>
              <p className="mt-1 text-[12px] text-[var(--text-3)]">
                {wireComboEnabled
                  ? 'Set the number of wires for each gauge. The optimizer will rank by grade using this combination.'
                  : 'When off, the optimizer explores every grade × gauge pair independently.'}
              </p>
            </div>
            {wireComboEnabled && (
              <div className="border-t border-[var(--line)] px-4 py-3">
                <div className="grid gap-1" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
                  <div className="text-[11px] font-medium text-[var(--text-3)] uppercase tracking-wider pb-1">Gauge</div>
                  <div className="text-[11px] font-medium text-[var(--text-3)] uppercase tracking-wider pb-1">Diameter</div>
                  <div className="text-[11px] font-medium text-[var(--text-3)] uppercase tracking-wider pb-1">Wires</div>
                  {(reference.data?.gauges ?? []).filter(g => g.isAvailable).map(g => {
                    const key = g.swg;
                    return (
                      <div key={key} className="contents">
                        <div className="text-[13px] py-1 font-medium">{g.swg} SWG</div>
                        <div className="text-[13px] py-1 text-[var(--text-3)]">⌀ {g.diaMm.toFixed(3)} mm</div>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={wireMap[g.swg] === undefined ? '' : wireMap[g.swg]}
                          onChange={e => {
                            const raw = e.target.value;
                            if (raw === '') { setWireMap(prev => { const next = { ...prev }; delete next[g.swg]; return next; }); return; }
                            setWireCount(g.swg, parseInt(raw) || 0);
                          }}
                          onBlur={() => { if (wireMap[g.swg] === undefined) setWireCount(g.swg, 0); }}
                          className="w-14 rounded border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1 text-center text-[13px]"
                        />
                      </div>
                    );
                  })}
                </div>
                {wireCombination && (
                  <div className="mt-3 rounded bg-[var(--surface-2)] px-3 py-2 text-[13px]">
                    <strong>Active:</strong>{' '}
                    {wireCombination.map(e => `${e.count}×${e.swg} SWG`).join(' + ')}
                    {' · '}Total area: {wireCombination.reduce((sum, e) => {
                      const g = (reference.data?.gauges ?? []).find(g => g.swg === e.swg);
                      return sum + (g ? g.areaSqmm * e.count : 0);
                    }, 0).toFixed(3)} mm²
                  </div>
                )}
                {wireComboEnabled && !wireCombination && (
                  <p className="mt-2 text-[12px] text-[var(--text-warn)]">Select at least one wire to enable combination mode.</p>
                )}
              </div>
            )}
          </Card>


          </details>

          <details className="workspace-input-group" ><summary><span>Engineering settings<small>Insulation, materials & acceptance limits</small></span><span className="workspace-chevron" aria-hidden="true">⌄</span></summary>
          <EngineeringEditor value={engineering} reference={reference.data} onChange={next => {
            if ((next?.purpose ?? 'metering') !== (engineering?.purpose ?? 'metering')) form.setValue('accuracyClass', next?.purpose === 'protection' ? '5P' : next?.purpose === 'ps' ? 'PS' : '0.5S');
            setEngineering(next);
          }}/>


          </details>

          <details className="workspace-input-group"><summary><span>Winding analysis inputs<small>Wire counts, spacing & material rates</small></span><span className="workspace-chevron" aria-hidden="true">⌄</span></summary><div ref={setWindingInputHost} className="calculator-winding-inputs flex flex-col gap-4" /></details>

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

          <button type="button" className="workspace-mobile-review" onClick={()=>{setActiveSection('calculator-results');requestAnimationFrame(()=>document.getElementById('calculator-results')?.scrollIntoView({behavior:'smooth',block:'start'}));}}>Review calculated results <span aria-hidden="true">→</span></button>
          <div className="calculator-save-actions">
            {canCreate && (
              <Button className="calculator-save-button" type="submit" variant="primary" disabled={!inputs || !result || (!best && !engineering) || save.isPending}>
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
        <div id="calculator-results" className="calculator-results flex min-w-0 flex-col gap-4" aria-label="Calculated results">
          <div className="workspace-results-intro"><h2>Calculated results</h2></div>
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
              <WarningStrip collapsible warnings={[
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

              <Card title="Selected design · key values" subtitle={`${selected.gradeLabel} · ${selected.wireCombinationLabel || `SWG ${selected.swg}`}`}><dl className="calculator-value-list">
                <div><dt>Core width (calc)</dt><dd><AnimatedNumber value={selected.coreWidthMm} dp={2} suffix=" mm" /></dd></div>
                <div><dt>Ordered width</dt><dd><AnimatedNumber value={selected.orderedWidthMm} dp={2} suffix=" mm" /></dd></div>
                <div><dt>Cross-sectional area</dt><dd><AnimatedNumber value={selected.finalAreaCm2} dp={3} suffix=" cm²" /></dd></div>
                <div><dt>Flux density</dt><dd><AnimatedNumber value={selected.bUsedT} dp={4} suffix=" T" /></dd></div>
                <div><dt>Core inner diameter</dt><dd><AnimatedNumber value={selected.geometry.coreIdMm} dp={2} suffix=" mm" /></dd></div>
                <div><dt>Core outer diameter (adj)</dt><dd><AnimatedNumber value={selected.geometry.coreOdMm} dp={2} suffix=" mm" /></dd></div>
                <div><dt>Secondary turns</dt><dd><AnimatedNumber value={selected.geometry.turns} dp={0} suffix=" turns" /></dd></div>
                <div><dt>Steel weight</dt><dd><AnimatedNumber value={selected.coreWeightKg} dp={4} suffix=" kg" /></dd></div>
                <div><dt>Copper weight</dt><dd><AnimatedNumber value={selected.copperWeightKg} dp={4} suffix=" kg" /></dd></div>
                <div><dt>{engineering?.costing.basis === 'manufacturing' ? 'Manufacturing cost' : 'Material cost'}</dt><dd><AnimatedNumber value={selected.totalCost} dp={2} prefix="₹" /></dd></div>
              </dl></Card>

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

              <details className="workspace-report-group"><summary><span>Calculation working<small>Trace each formula, convergence pass and B–H curve</small></span><span className="workspace-chevron" aria-hidden="true">⌄</span></summary>
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
                      title={`${selected.gradeLabel} · ${selected.wireCombinationLabel || `SWG ${selected.swg}`}`}
                      subtitle="Every substituted value, the convergence passes, and the operating point on the grade's curve."
                    >
                      <DetailPanel result={detail} grade={grade} gradeLabel={selected.gradeLabel} />
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              </details>

              <div className="workflow-heading"><span>•</span><div><h2>Winding analysis</h2><p>Practical layer-by-layer MLT and copper weight for {selected.gradeLabel} · {selected.wireCombinationLabel || `SWG ${selected.swg}`}</p></div></div>
              <WindingAnalysis
                inputHost={windingInputHost}
                reduce={Boolean(reduce)}
                gauges={reference.data?.gauges ?? []}
                finishedIdMm={selected.inputs.finishedIdMm}
                resinCoverMm={reference.data?.settings.resinCoverMm ?? 4}
                coreIdMm={selected.geometry.coreIdMm}
                coreOdMm={selected.geometry.coreOdMm}
                coreWidthMm={selected.orderedWidthMm}
                turns={selected.geometry.turns}
                selectedSwg={selected.swg}
                coreWeightKg={selected.coreWeightKg}
              />
            </>
          )}
        </div>
      </div>
      <section id="calculator-model" className="calculator-visuals" aria-label="Selected design 3D model and drawing">
        <div className="workflow-heading"><span>03</span><div><h2>3D model & dimensioned drawing</h2><p>Inspect the assembly, winding layers, insulation and resin cover.</p></div></div>
        {selected?.converged && <Suspense fallback={<Card><div className="p-6">Loading design views...</div></Card>}><SelectedDesignPreview option={selected} resinCoverMm={reference.data?.settings.resinCoverMm ?? 4} coreInsulationMm={reference.data?.settings.coreInsulationMm ?? 1} interLayerTapeMm={reference.data?.settings.interLayerTapeMm ?? 0.1} /></Suspense>}
        {!selected?.converged && <Card><EmptyState title="Your 3D model will appear here">Enter a valid specification to generate the selected design.</EmptyState></Card>}
      </section>
    </div>
  );
}

