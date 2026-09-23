import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  optimise, solve, EngineError,
  type DesignInputs, type ProcessSettings, type ReferenceData,
} from '@meltek/engine';
import {
  approveSchema, calculateRequestSchema, createDesignSchema, customerUpdateSchema,
  dieUpsertSchema, gaugeUpsertSchema, gradeUpsertSchema, manufacturedResultSchema,
  patchDesignSchema, ratesSchema, selectOptionSchema, slitWidthsSchema,
} from '@meltek/schema';
import type {
  AuditEntry, Customer, Design, DesignFilter, Store, StoredDesignInputs, StoredOption,
} from './store/index.js';
import { requireAuth, requirePermission } from './auth/middleware.js';
import { findSimilar } from './similar.js';
import { buildBom, bomToCsv } from './bom.js';
import { renderCalculationSheet } from './sheet.js';
import { PdfUnavailable, renderPdf } from './pdf.js';

/**
 * Who did it, for the audit log.
 *
 * This reads the authenticated session, never a client-supplied header. An earlier build
 * trusted `x-meltek-user`, which meant the audit trail recorded whatever the caller
 * claimed. Every route below requires a session, so `req.user` is always present.
 */
const actorOf = (req: Request): string => req.user?.email ?? 'unknown';

const asInputs = (i: StoredDesignInputs | DesignInputs): DesignInputs => ({
  engineering: i.engineering ?? null,
  primaryCurrent: i.primaryCurrent,
  secondaryCurrent: i.secondaryCurrent,
  burdenVA: i.burdenVA,
  accuracyClass: i.accuracyClass,
  finishedIdMm: i.finishedIdMm,
  finishedOdMm: i.finishedOdMm,
  ctType: i.ctType,
  maxWidthMm: i.maxWidthMm ?? null,
});

const store_ = (req: Request): Store => (req.app.locals.store as Store);

/** Express 5 types a route param as string | string[]; we only ever declare single params. */
const param = (req: Request, key: string): string => String((req.params as Record<string, unknown>)[key] ?? '');

/** A design uses its frozen snapshot once approved, live reference data before that (§3.3). */
async function contextFor(store: Store, design: Design): Promise<{ ref: ReferenceData; settings: ProcessSettings }> {
  if (design.settingsSnapshot && design.referenceSnapshot) {
    return { ref: design.referenceSnapshot, settings: design.settingsSnapshot };
  }
  return { ref: await store.getReference(), settings: await store.getSettings() };
}

const audit = (
  store: Store, entity: string, entityId: string, action: string,
  actor: string, before: unknown, after: unknown,
): Promise<void> => {
  const entry: AuditEntry = {
    id: randomUUID(), entity, entityId, action, actor, before, after, at: new Date().toISOString(),
  };
  return store.audit(entry);
};

export function buildRouter(): Router {
  const r = Router();

  // Nothing in here is public. Each route then narrows further by permission.
  r.use(requireAuth);
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };

  /* ─────────── calculate (persists nothing) ─────────── */

  r.post('/calculate', requirePermission('designs.view'), wrap(async (req, res) => {
    const store = store_(req);
    const { inputs, settingsOverride } = calculateRequestSchema.parse(req.body);
    const ref = await store.getReference();
    const settings = { ...(await store.getSettings()), ...(settingsOverride ?? {}) };
    const result = optimise(asInputs(inputs), ref, settings);

    // The UI renders the whole calculation, not just the answer. The top option carries
    // its full substituted chain; the rest are computed without it for speed.
    const best = result.options.find((o) => o.rank === 1);
    const detail = best ? solve(asInputs(inputs), ref, settings, best.gradeCode, best.swg) : null;

    res.json({
      options: result.options,
      warnings: result.warnings,
      computedAtMs: result.computedAtMs,
      detail,
      settings,
    });
  }));

  /** The substituted chain for one grade x gauge, for the detail panel. */
  r.post('/calculate/detail', requirePermission('designs.view'), wrap(async (req, res) => {
    const store = store_(req);
    const body = calculateRequestSchema
      .extend({ gradeCode: z.string(), swg: z.number() })
      .parse(req.body);
    const ref = await store.getReference();
    const settings = { ...(await store.getSettings()), ...(body.settingsOverride ?? {}) };
    res.json(solve(asInputs(body.inputs), ref, settings, body.gradeCode, body.swg));
  }));

  /* ─────────── designs ─────────── */

  r.get('/designs', requirePermission('designs.view'), wrap(async (req, res) => {
    const store = store_(req);
    const q = req.query as Record<string, string | undefined>;
    const filter: DesignFilter = {
      ...(q.q ? { q: q.q } : {}),
      ...(q.customer ? { customer: q.customer } : {}),
      ...(q.status ? { status: q.status as DesignFilter['status'] } : {}),
      ...(q.accuracyClass ? { accuracyClass: q.accuracyClass } : {}),
      ...(q.ratio ? { ratio: q.ratio } : {}),
      ...(q.burdenVA ? { burdenVA: Number(q.burdenVA) } : {}),
      ...(q.minId ? { minId: Number(q.minId) } : {}),
      ...(q.maxOd ? { maxOd: Number(q.maxOd) } : {}),
      ...(q.limit ? { limit: Number(q.limit) } : {}),
    };
    const designs = await store.listDesigns(filter);

    // Similar design matching, surfaced above "calculate new" (§8, §11.1).
    let similar: ReturnType<typeof findSimilar> = [];
    if (q.similarTo) {
      const parsed = JSON.parse(q.similarTo) as StoredDesignInputs;
      similar = findSimilar(parsed, await store.listDesigns({}));
    }
    res.json({ designs, similar });
  }));

  r.post('/designs', requirePermission('designs.create'), wrap(async (req, res) => {
    const store = store_(req);
    const body = createDesignSchema.parse(req.body);
    const actor = actorOf(req);
    const customer = await store.upsertCustomerByName(body.customerName);
    const now = new Date().toISOString();

    const design: Design = {
      id: randomUUID(),
      designNo: await store.nextDesignNo(),
      revision: 1,
      customerId: customer.id,
      customerName: customer.name,
      enquiryNo: body.enquiryNo ?? null,
      poNo: body.poNo ?? null,
      prdNo: body.prdNo ?? null,
      quantity: body.quantity ?? null,
      requiredBy: body.requiredBy ?? null,
      insulationType: body.insulationType ?? null,
      inputs: { ...body.inputs, maxWidthMm: body.inputs.maxWidthMm ?? null },
      settingsSnapshot: null,
      referenceSnapshot: null,
      status: 'draft',
      selectedOptionId: null,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      approvedBy: null,
      approvedAt: null,
      supersededById: null,
      supersedesId: null,
    };
    await store.createDesign(design);
    await audit(store, 'design', design.id, 'create', actor, null, design);
    res.status(201).json(design);
  }));

  r.get('/designs/:id', requirePermission('designs.view'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    const [options, bom, results, history] = await Promise.all([
      store.getOptions(design.id), store.getBom(design.id),
      store.listResults(design.id), store.listAudit(design.id),
    ]);
    return res.json({ design, options, bom, results, history });
  }));

  r.patch('/designs/:id', requirePermission('designs.edit'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    if (['approved','in_production','superseded','archived'].includes(design.status)) {
      return res.status(409).json({
        error: 'This design is approved and locked. Create a revision to change it.',
      });
    }
    const body = patchDesignSchema.parse(req.body);
    if (body.status && body.status !== design.status) return res.status(409).json({ error: 'Use the calculate, approve, revise or archive action to change design status.' });
    const actor = actorOf(req);
    const before = { ...design };

    if (body.customerName) {
      const c = await store.upsertCustomerByName(body.customerName);
      design.customerId = c.id;
      design.customerName = c.name;
    }
    if (body.enquiryNo !== undefined) design.enquiryNo = body.enquiryNo ?? null;
    if (body.poNo !== undefined) design.poNo = body.poNo ?? null;
    if (body.prdNo !== undefined) design.prdNo = body.prdNo ?? null;
    if (body.quantity !== undefined) design.quantity = body.quantity ?? null;
    if (body.requiredBy !== undefined) design.requiredBy = body.requiredBy ?? null;
    if (body.insulationType !== undefined) design.insulationType = body.insulationType ?? null;
    if (body.inputs) {
      design.inputs = { ...body.inputs, maxWidthMm: body.inputs.maxWidthMm ?? null };
      design.status = 'draft';
      design.selectedOptionId = null;
      design.settingsSnapshot = null;
      design.referenceSnapshot = null;
      await store.replaceOptions(design.id, []);
    }
    if (body.status) design.status = body.status;
    design.updatedAt = new Date().toISOString();

    await store.updateDesign(design);
    await audit(store, 'design', design.id, 'update', actor, before, design);
    return res.json(design);
  }));

  r.post('/designs/:id/calculate', requirePermission('designs.calculate'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    if (['approved','in_production','superseded','archived'].includes(design.status)) {
      return res.status(409).json({ error: 'This design is approved and locked. Create a revision to recalculate.' });
    }
    const ref = await store.getReference();
    const settings = await store.getSettings();
    const result = optimise(asInputs(design.inputs), ref, settings);

    const options: StoredOption[] = result.options.map((o) => ({
      ...o, id: randomUUID(), designId: design.id, isSelected: false,
    }));
    await store.replaceOptions(design.id, options);

    design.settingsSnapshot = settings;
    design.referenceSnapshot = ref;
    design.status = 'calculated';
    design.selectedOptionId = null;
    design.updatedAt = new Date().toISOString();
    await store.updateDesign(design);
    await audit(store, 'design', design.id, 'calculate', actorOf(req), null,
      { feasible: options.filter((o) => o.isFeasible).length, total: options.length });

    return res.json({ design, options, warnings: result.warnings, computedAtMs: result.computedAtMs });
  }));

  r.post('/designs/:id/select', requirePermission('designs.select'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    if (['approved','in_production','superseded','archived'].includes(design.status)) {
      return res.status(409).json({ error: 'This design is approved and locked.' });
    }
    const { optionId } = selectOptionSchema.parse(req.body);
    const options = await store.getOptions(design.id);
    const chosen = options.find((o) => o.id === optionId);
    if (!chosen) return res.status(404).json({ error: 'No option with that id on this design.' });

    if (!chosen.isFeasible || chosen.totalCost === null || !Number.isFinite(chosen.totalCost)) return res.status(409).json({ error: 'Only a feasible, costed option can be selected.' });

    for (const o of options) o.isSelected = o.id === optionId;
    await store.replaceOptions(design.id, options);

    const ref = design.referenceSnapshot ?? await store.getReference();
    await store.replaceBom(design.id, buildBom(design, chosen, ref));

    design.selectedOptionId = optionId;
    design.updatedAt = new Date().toISOString();
    await store.updateDesign(design);
    await audit(store, 'design', design.id, 'select', actorOf(req), null,
      { grade: chosen.gradeCode, swg: chosen.swg, totalCost: chosen.totalCost });

    return res.json({ design, options });
  }));

  /** §3.3 - approval freezes the rates, curves and settings used. */
  r.post('/designs/:id/approve', requirePermission('designs.approve'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    if (design.status === 'approved') return res.json(design);
    if (design.status !== 'calculated') return res.status(409).json({ error: 'Only a calculated design can be approved.' });
    if (!design.selectedOptionId) {
      return res.status(409).json({ error: 'Select an option before approving this design.' });
    }
    // The approver is whoever is signed in. A typed name would be unverifiable, and an
    // approval is the one record that has to say who actually signed it off.
    const approvedBy = req.user!.name;
    const chosen = (await store.getOptions(design.id)).find(o => o.id === design.selectedOptionId);
    if (!chosen?.isFeasible || chosen.engineering?.issues.length) return res.status(409).json({ error: 'The selected option does not pass engineering screening.' });
    design.settingsSnapshot ??= await store.getSettings();
    design.referenceSnapshot ??= await store.getReference();
    design.status = 'approved';
    design.approvedBy = approvedBy;
    design.approvedAt = new Date().toISOString();
    design.updatedAt = design.approvedAt;
    await store.updateDesign(design);
    await audit(store, 'design', design.id, 'approve', approvedBy, null,
      { approvedBy, at: design.approvedAt });
    return res.json(design);
  }));

  /** A revision supersedes the old record rather than editing it. */
  r.post('/designs/:id/revise', requirePermission('designs.revise'), wrap(async (req, res) => {
    const store = store_(req);
    const previous = await store.getDesign(param(req, 'id'));
    if (!previous) return res.status(404).json({ error: 'No design with that id.' });
    const actor = actorOf(req);
    const now = new Date().toISOString();

    const revision: Design = {
      ...previous,
      id: randomUUID(),
      revision: previous.revision + 1,
      status: 'draft',
      selectedOptionId: null,
      settingsSnapshot: null,
      referenceSnapshot: null,
      approvedBy: null,
      approvedAt: null,
      supersededById: null,
      supersedesId: previous.id,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    await store.createDesign(revision);

    previous.status = 'superseded';
    previous.supersededById = revision.id;
    previous.updatedAt = now;
    await store.updateDesign(previous);

    await audit(store, 'design', revision.id, 'revise', actor,
      { from: previous.designNo, revision: previous.revision }, { revision: revision.revision });
    return res.status(201).json(revision);
  }));

  /**
   * Delete a design outright.
   *
   * Approved and in-production work is never deleted — it is the record of what was
   * quoted and built. Those are archived instead, which keeps the audit trail and the
   * frozen rates intact while taking the design out of the way.
   */
  r.delete('/designs/:id', requirePermission('designs.delete'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });

    if (['approved','in_production','superseded','archived'].includes(design.status)) {
      return res.status(409).json({
        error: `${design.designNo} is ${design.status.replace('_', ' ')} and is part of the production record. Archive it instead of deleting it.`,
        code: 'DELETE_BLOCKED_APPROVED',
      });
    }

    await store.deleteDesign(design.id);
    await audit(store, 'design', design.id, 'delete', actorOf(req), design, null);
    return res.status(204).end();
  }));

  /** Take a design out of the working set without losing it. */
  r.post('/designs/:id/archive', requirePermission('designs.archive'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    if (design.status === 'archived') return res.json(design);

    const previousStatus = design.status;
    design.status = 'archived';
    design.updatedAt = new Date().toISOString();
    await store.updateDesign(design);
    await audit(store, 'design', design.id, 'archive', actorOf(req), { status: previousStatus }, { status: 'archived' });
    return res.json(design);
  }));

  /** Bring an archived design back into the working set. */
  r.post('/designs/:id/restore', requirePermission('designs.archive'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    if (design.status !== 'archived') return res.json(design);

    // An approved design keeps its approval; anything else comes back as calculated
    // when it has options, or a draft when it does not.
    const options = await store.getOptions(design.id);
    design.status = design.approvedAt ? 'approved' : options.length > 0 ? 'calculated' : 'draft';
    design.updatedAt = new Date().toISOString();
    await store.updateDesign(design);
    await audit(store, 'design', design.id, 'restore', actorOf(req), { status: 'archived' }, { status: design.status });
    return res.json(design);
  }));

  /**
   * Copy a design as a fresh draft — the repeat-order path. The copy carries the
   * specification and the customer, but none of the approval, options or order numbers,
   * because those belong to the original job.
   */
  r.post('/designs/:id/duplicate', requirePermission('designs.create'), wrap(async (req, res) => {
    const store = store_(req);
    const source = await store.getDesign(param(req, 'id'));
    if (!source) return res.status(404).json({ error: 'No design with that id.' });
    const actor = actorOf(req);
    const now = new Date().toISOString();

    const copy: Design = {
      ...source,
      id: randomUUID(),
      designNo: await store.nextDesignNo(),
      revision: 1,
      enquiryNo: null,
      poNo: null,
      prdNo: null,
      quantity: null,
      requiredBy: null,
      status: 'draft',
      selectedOptionId: null,
      settingsSnapshot: null,
      referenceSnapshot: null,
      approvedBy: null,
      approvedAt: null,
      supersededById: null,
      supersedesId: null,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    await store.createDesign(copy);
    await audit(store, 'design', copy.id, 'duplicate', actor, { from: source.designNo }, { designNo: copy.designNo });
    return res.status(201).json(copy);
  }));

  /* ─────────── customers ─────────── */

  r.get('/customers', requirePermission('designs.view'), wrap(async (req, res) => {
    const store = store_(req);
    const customers = await store.listCustomers();
    const designs = await store.listDesigns({});
    res.json(customers.map((c) => ({
      ...c,
      designCount: designs.filter((d) => d.customerId === c.id).length,
    })));
  }));

  r.patch('/customers/:id', requirePermission('customers.edit'), wrap(async (req, res) => {
    const store = store_(req);
    const existing = await store.getCustomer(param(req, 'id'));
    if (!existing) return res.status(404).json({ error: 'No customer with that id.' });
    const body = customerUpdateSchema.parse(req.body);

    const clash = (await store.listCustomers()).find(
      (c) => c.id !== existing.id && c.name.toLowerCase() === body.name.toLowerCase(),
    );
    if (clash) {
      return res.status(409).json({ error: `Another customer is already called "${body.name}".` });
    }

    const updated: Customer = {
      ...existing,
      name: body.name,
      gstin: body.gstin ?? null,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail || null,
      phone: body.phone ?? null,
    };
    await store.updateCustomer(updated);
    await audit(store, 'customer', updated.id, 'update', actorOf(req), existing, updated);
    return res.json(updated);
  }));

  r.delete('/customers/:id', requirePermission('customers.delete'), wrap(async (req, res) => {
    const store = store_(req);
    const existing = await store.getCustomer(param(req, 'id'));
    if (!existing) return res.status(404).json({ error: 'No customer with that id.' });

    const designCount = await store.countDesignsForCustomer(existing.id);
    if (designCount > 0) {
      return res.status(409).json({
        error: `${existing.name} has ${designCount} design${designCount === 1 ? '' : 's'} on record. Delete or reassign those first.`,
        code: 'CUSTOMER_IN_USE',
      });
    }

    await store.deleteCustomer(existing.id);
    await audit(store, 'customer', existing.id, 'delete', actorOf(req), existing, null);
    return res.status(204).end();
  }));

  r.get('/designs/:id/pdf', requirePermission('designs.view'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    const options = await store.getOptions(design.id);
    const selected = options.find((o) => o.id === design.selectedOptionId) ?? options.find((o) => o.rank === 1);
    if (!selected) return res.status(409).json({ error: 'Calculate and select an option before printing the sheet.' });

    // The stored option carries no substituted chain (it is computed without one for
    // speed); recompute it here against the design's own snapshot.
    const { ref, settings } = await contextFor(store, design);
    const full = solve(asInputs(design.inputs), ref, settings, selected.gradeCode, selected.swg);
    const option = { ...selected, ...full, id: selected.id, designId: selected.designId, isSelected: selected.isSelected };
    const filename = `${design.designNo}-rev${design.revision}-calculation-sheet`;

    // ?format=html serves the same markup unrendered, for debugging the stylesheet.
    if (req.query.format === 'html') {
      res.type('html').send(renderCalculationSheet(design, option, { autoPrint: false }));
      return undefined;
    }

    const html = renderCalculationSheet(design, option, { autoPrint: false });
    try {
      const pdf = await renderPdf(html, { title: `${design.designNo} rev ${design.revision}` });
      res.type('application/pdf')
        .setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`)
        .send(Buffer.from(pdf));
    } catch (err) {
      if (!(err instanceof PdfUnavailable)) throw err;
      // No Chromium on this host. Serve the printable sheet rather than failing the
      // request, and say so loudly in the log and in a response header.
      req.log.warn({ err: err.message }, 'PDF rendering unavailable - falling back to printable HTML');
      res.type('html')
        .setHeader('X-Meltek-Pdf-Fallback', 'html')
        .send(renderCalculationSheet(design, option, { autoPrint: true }));
    }
    return undefined;
  }));

  r.get('/designs/:id/bom', requirePermission('designs.view'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    const bom = await store.getBom(design.id);
    if (req.query.format === 'csv') {
      res.type('text/csv').attachment(`${design.designNo}-bom.csv`).send(bomToCsv(design, bom));
      return undefined;
    }
    return res.json({ design, bom });
  }));

  /* ─────────── Phase 3 - manufactured results (§14) ─────────── */

  r.post('/designs/:id/result', requirePermission('results.record'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    const body = manufacturedResultSchema.parse(req.body);
    const result = {
      id: randomUUID(), designId: design.id, createdAt: new Date().toISOString(),
      batchNo: body.batchNo,
      manufacturedOn: body.manufacturedOn ?? null,
      actualCoreGrade: body.actualCoreGrade ?? null,
      actualCoreWidthMm: body.actualCoreWidthMm ?? null,
      actualCoreWeightKg: body.actualCoreWeightKg ?? null,
      actualCopperWeightKg: body.actualCopperWeightKg ?? null,
      measuredRatioErrorPct: body.measuredRatioErrorPct ?? null,
      measuredPhaseErrorMin: body.measuredPhaseErrorMin ?? null,
      measuredResistanceOhm: body.measuredResistanceOhm ?? null,
      testLab: body.testLab ?? null,
      passed: body.passed,
      notes: body.notes ?? null,
    };
    await store.addResult(result);
    await audit(store, 'manufactured_result', design.id, 'record', actorOf(req), null, result);
    return res.status(201).json(result);
  }));

  r.delete('/designs/:id/result/:resultId', requirePermission('results.record'), wrap(async (req, res) => {
    const store = store_(req);
    const design = await store.getDesign(param(req, 'id'));
    if (!design) return res.status(404).json({ error: 'No design with that id.' });
    const results = await store.listResults(design.id);
    const result = results.find((x) => x.id === param(req, 'resultId'));
    if (!result) return res.status(404).json({ error: 'No test result with that id on this design.' });

    await store.deleteResult(result.id);
    await audit(store, 'manufactured_result', design.id, 'delete result', actorOf(req), result, null);
    return res.status(204).end();
  }));

  /* ─────────── reference data ─────────── */

  r.get('/reference', requirePermission('reference.view'), wrap(async (req, res) => {
    const store = store_(req);
    const [ref, settings, settingRows, customers] = await Promise.all([
      store.getReference(), store.getSettings(), store.getSettingRows(), store.listCustomers(),
    ]);
    res.json({ ...ref, settings, settingRows, customers, storeKind: store.kind });
  }));

  r.put('/reference/grades/:code', requirePermission('reference.edit'), wrap(async (req, res) => {
    const store = store_(req);
    const body = gradeUpsertSchema.parse({ ...req.body, code: param(req, 'code') });
    await store.saveGrade({
      code: body.code, label: body.label, note: body.note ?? null, ratePerKg: body.ratePerKg,
      densityGCm3: body.densityGCm3 ?? null, stackingFactor: body.stackingFactor ?? null,
      isAvailable: body.isAvailable, curve: body.curve,
    });
    await audit(store, 'steel_grade', body.code, 'update', actorOf(req), null, body);
    res.json(await store.getReference());
  }));

  r.delete('/reference/grades/:code', requirePermission('reference.edit'), wrap(async (req, res) => {
    const store = store_(req);
    await store.deleteGrade(param(req, 'code'));
    await audit(store, 'steel_grade', param(req, 'code'), 'delete', actorOf(req), null, null);
    res.json(await store.getReference());
  }));

  r.put('/reference/gauges/:swg', requirePermission('reference.edit'), wrap(async (req, res) => {
    const store = store_(req);
    const body = gaugeUpsertSchema.parse({ ...req.body, swg: Number(param(req, 'swg')) });
    await store.saveGauge(body);
    await audit(store, 'wire_gauge', String(body.swg), 'update', actorOf(req), null, body);
    res.json(await store.getReference());
  }));

  r.delete('/reference/gauges/:swg', requirePermission('reference.edit'), wrap(async (req, res) => {
    const store = store_(req);
    await store.deleteGauge(Number(param(req, 'swg')));
    res.json(await store.getReference());
  }));

  r.put('/reference/dies', requirePermission('reference.edit'), wrap(async (req, res) => {
    const store = store_(req);
    const dies = z.array(dieUpsertSchema).parse(req.body);
    await store.saveDies(dies.map((d) => ({
      id: d.id ?? randomUUID(), dieNo: d.dieNo, minOdMm: d.minOdMm, maxOdMm: d.maxOdMm,
      maxWidthMm: d.maxWidthMm, quantity: d.quantity, location: d.location ?? null,
      isAvailable: d.isAvailable,
    })));
    await audit(store, 'die', 'register', 'update', actorOf(req), null, dies);
    res.json(await store.getReference());
  }));

  r.put('/reference/slit-widths', requirePermission('reference.edit'), wrap(async (req, res) => {
    const store = store_(req);
    const { widths } = slitWidthsSchema.parse(req.body);
    await store.saveSlitWidths(widths);
    await audit(store, 'slit_width', 'register', 'update', actorOf(req), null, widths);
    res.json(await store.getReference());
  }));

  r.put('/reference/rates', requirePermission('reference.edit'), wrap(async (req, res) => {
    const store = store_(req);
    const { copperRatePerKg } = ratesSchema.parse(req.body);
    await store.saveCopperRate(copperRatePerKg);
    await audit(store, 'material_rate', 'copper', 'update', actorOf(req), null, { copperRatePerKg });
    res.json(await store.getReference());
  }));

  r.put('/reference/settings/:key', requirePermission('reference.edit'), wrap(async (req, res) => {
    const store = store_(req);
    const { value } = z.object({ value: z.union([z.number(), z.boolean()]) }).parse(req.body);
    const rows = await store.getSettingRows();
    const row = rows.find((s) => s.key === param(req, 'key'));
    if (!row) return res.status(404).json({ error: `No process setting "${param(req, 'key')}".` });
    await store.saveSetting(row.key, value, actorOf(req));
    await audit(store, 'process_setting', row.key, 'update', actorOf(req), row.value, value);
    return res.json({ settings: await store.getSettings(), settingRows: await store.getSettingRows() });
  }));

  return r;
}

/**
 * Error shape (§16): say what failed and what to do. Never "Something went wrong."
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: 'Some fields need attention before this can be calculated.',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof EngineError) {
    res.status(422).json({ error: err.message, code: err.code, detail: err.detail ?? null });
    return;
  }
  const message = err instanceof Error ? err.message : 'The request could not be completed.';
  res.status(500).json({ error: message });
}
