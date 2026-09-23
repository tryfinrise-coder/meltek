import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  DEFAULT_SETTINGS, SETTING_META, seedReferenceData,
  type Die, type ProcessSettings, type ReferenceData, type SteelGrade, type WireGauge,
} from '@meltek/engine';
import type {
  AuditEntry, BomLine, Customer, Design, DesignFilter, DesignStatus,
  ManufacturedResult, Session, SettingRow, StoredOption, Store, User, UserWithSecret,
} from './types.js';
import { defaultSettingRows } from './json-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * PostgreSQL implementation of the same Store seam, against schema.sql (§7).
 *
 * Selected by setting DATABASE_URL. The schema is applied idempotently at boot and
 * seeded from the engine's reference package on an empty database (§3.2).
 */
export class PgStore implements Store {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string, ssl = false) {
    this.pool = new pg.Pool({
      connectionString,
      ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }

  async init(): Promise<void> {
    const ddl = await readFile(resolve(here, 'schema.sql'), 'utf8');
    await this.pool.query(ddl);
    const { rows } = await this.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM steel_grade');
    if (Number(rows[0]?.n ?? 0) === 0) await this.seed();
  }

  async close(): Promise<void> { await this.pool.end(); }

  private async seed(): Promise<void> {
    const ref = seedReferenceData();
    for (const g of ref.grades) await this.saveGrade(g);
    for (const w of ref.gauges) await this.saveGauge(w);
    for (const c of ref.classes) {
      await this.pool.query(
        `INSERT INTO accuracy_class (code, percent, per_is, note, max_flux_density_t)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO UPDATE
         SET percent = EXCLUDED.percent, per_is = EXCLUDED.per_is, note = EXCLUDED.note`,
        [c.code, c.percent, c.perIS, c.note, c.maxFluxDensityT],
      );
    }
    await this.pool.query(
      `INSERT INTO material_rate (material_type, rate_per_kg) VALUES ('copper', $1)`,
      [ref.copperRatePerKg],
    );
    for (const row of defaultSettingRows()) {
      await this.pool.query(
        `INSERT INTO process_setting (key, value, unit, label, is_confirmed, source_note)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING`,
        [row.key, typeof row.value === 'boolean' ? (row.value ? 1 : 0) : row.value,
          row.unit, row.label, row.isConfirmed, row.sourceNote],
      );
    }
  }

  /* ── reference ── */

  async getReference(): Promise<ReferenceData> {
    const grades = await this.pool.query(
      `SELECT g.id, g.code, g.label, g.note, g.density_g_cm3, g.stacking_factor, g.is_available,
              (SELECT rate_per_kg FROM material_rate r
                WHERE r.grade_id = g.id AND r.effective_to IS NULL
                ORDER BY r.effective_from DESC LIMIT 1) AS rate_per_kg
         FROM steel_grade g ORDER BY g.code`);
    const points = await this.pool.query(
      `SELECT grade_id, flux_density_t, magnetising_at_cm FROM bh_point ORDER BY flux_density_t`);
    const gauges = await this.pool.query(`SELECT * FROM wire_gauge ORDER BY swg`);
    const classes = await this.pool.query(`SELECT * FROM accuracy_class ORDER BY percent`);
    const dies = await this.pool.query(`SELECT * FROM die ORDER BY die_no`);
    const slits = await this.pool.query(`SELECT width_mm FROM slit_width WHERE is_stocked ORDER BY width_mm`);
    const copper = await this.pool.query(
      `SELECT rate_per_kg FROM material_rate WHERE material_type = 'copper' AND effective_to IS NULL
        ORDER BY effective_from DESC LIMIT 1`);

    return {
      grades: grades.rows.map((g) => ({
        code: g.code as string,
        label: g.label as string,
        note: (g.note as string | null) ?? null,
        ratePerKg: numOrNull(g.rate_per_kg),
        densityGCm3: numOrNull(g.density_g_cm3),
        stackingFactor: numOrNull(g.stacking_factor),
        isAvailable: Boolean(g.is_available),
        curve: points.rows
          .filter((p) => p.grade_id === g.id)
          .map((p) => ({ teslaT: num(p.flux_density_t), hAtCm: numOrNull(p.magnetising_at_cm) })),
      })),
      gauges: gauges.rows.map((w) => ({
        swg: num(w.swg), diaMm: num(w.dia_mm), areaSqmm: num(w.area_sqmm),
        ohmPerM20c: num(w.ohm_per_m_20c), ohmPerM75c: numOrNull(w.ohm_per_m_75c),
        gramPerM: num(w.gram_per_m), isAvailable: Boolean(w.is_available),
      })),
      classes: classes.rows.map((c) => ({
        code: c.code as string, percent: num(c.percent), perIS: Boolean(c.per_is),
        note: (c.note as string) ?? '', maxFluxDensityT: numOrNull(c.max_flux_density_t),
      })),
      dies: dies.rows.map((d) => ({
        id: d.id as string, dieNo: d.die_no as string, minOdMm: num(d.min_od_mm),
        maxOdMm: num(d.max_od_mm), maxWidthMm: num(d.max_width_mm), quantity: num(d.quantity),
        location: (d.location as string | null) ?? null, isAvailable: Boolean(d.is_available),
      })),
      slitWidthsMm: slits.rows.map((s) => num(s.width_mm)),
      copperRatePerKg: copper.rows.length ? num(copper.rows[0]!.rate_per_kg) : 0,
    };
  }

  async saveGrade(grade: SteelGrade): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ id: string }>(
        `INSERT INTO steel_grade (code, label, note, density_g_cm3, stacking_factor, is_available)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, note = EXCLUDED.note,
           density_g_cm3 = EXCLUDED.density_g_cm3, stacking_factor = EXCLUDED.stacking_factor,
           is_available = EXCLUDED.is_available, updated_at = now()
         RETURNING id`,
        [grade.code, grade.label, grade.note ?? null, grade.densityGCm3, grade.stackingFactor, grade.isAvailable],
      );
      const id = res.rows[0]!.id;
      await client.query('DELETE FROM bh_point WHERE grade_id = $1', [id]);
      for (const p of grade.curve) {
        await client.query(
          'INSERT INTO bh_point (grade_id, flux_density_t, magnetising_at_cm) VALUES ($1,$2,$3)',
          [id, p.teslaT, p.hAtCm],
        );
      }
      // Rates are effective-dated and snapshotted onto approved designs (§6.4, §3.3).
      if (grade.ratePerKg !== null) {
        await client.query(
          `UPDATE material_rate SET effective_to = CURRENT_DATE
            WHERE grade_id = $1 AND effective_to IS NULL AND rate_per_kg <> $2`,
          [id, grade.ratePerKg],
        );
        await client.query(
          `INSERT INTO material_rate (material_type, grade_id, rate_per_kg)
           SELECT 'steel', $1, $2
            WHERE NOT EXISTS (SELECT 1 FROM material_rate
                               WHERE grade_id = $1 AND effective_to IS NULL AND rate_per_kg = $2)`,
          [id, grade.ratePerKg],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteGrade(code: string): Promise<void> {
    await this.pool.query('DELETE FROM steel_grade WHERE code = $1', [code]);
  }

  async saveGauge(g: WireGauge): Promise<void> {
    await this.pool.query(
      `INSERT INTO wire_gauge (swg, dia_mm, area_sqmm, ohm_per_m_20c, ohm_per_m_75c, gram_per_m, is_available)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (swg) DO UPDATE SET dia_mm = EXCLUDED.dia_mm, area_sqmm = EXCLUDED.area_sqmm,
         ohm_per_m_20c = EXCLUDED.ohm_per_m_20c, ohm_per_m_75c = EXCLUDED.ohm_per_m_75c,
         gram_per_m = EXCLUDED.gram_per_m, is_available = EXCLUDED.is_available`,
      [g.swg, g.diaMm, g.areaSqmm, g.ohmPerM20c, g.ohmPerM75c, g.gramPerM, g.isAvailable],
    );
  }

  async deleteGauge(swg: number): Promise<void> {
    await this.pool.query('DELETE FROM wire_gauge WHERE swg = $1', [swg]);
  }

  async saveDies(dies: Die[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM die');
      for (const d of dies) {
        await client.query(
          `INSERT INTO die (die_no, min_od_mm, max_od_mm, max_width_mm, quantity, location, is_available)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [d.dieNo, d.minOdMm, d.maxOdMm, d.maxWidthMm, d.quantity, d.location ?? null, d.isAvailable],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveSlitWidths(widths: number[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM slit_width');
      for (const w of [...new Set(widths)].sort((a, b) => a - b)) {
        await client.query('INSERT INTO slit_width (width_mm, is_stocked) VALUES ($1, true)', [w]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveCopperRate(rate: number): Promise<void> {
    await this.pool.query(
      `UPDATE material_rate SET effective_to = CURRENT_DATE
        WHERE material_type = 'copper' AND effective_to IS NULL`);
    await this.pool.query(
      `INSERT INTO material_rate (material_type, rate_per_kg) VALUES ('copper', $1)`, [rate]);
  }

  /* ── settings ── */

  async getSettingRows(): Promise<SettingRow[]> {
    const { rows } = await this.pool.query(`SELECT * FROM process_setting`);
    const byKey = new Map(rows.map((r) => [r.key as string, r]));
    return SETTING_META.map((m) => {
      const r = byKey.get(m.key);
      const raw = r ? num(r.value) : (DEFAULT_SETTINGS[m.key] as number | boolean);
      return {
        key: m.key,
        value: typeof DEFAULT_SETTINGS[m.key] === 'boolean' ? Boolean(Number(raw)) : Number(raw),
        unit: m.unit,
        label: m.label,
        // Label, unit, note and the default flag come from the application, not the row:
        // improved wording ships with a deploy rather than being frozen at first run.
        isConfirmed: m.isConfirmed,
        sourceNote: m.sourceNote,
        updatedBy: (r?.updated_by as string | null) ?? null,
        updatedAt: r?.updated_at ? new Date(r.updated_at as string).toISOString() : null,
      };
    });
  }

  async getSettings(): Promise<ProcessSettings> {
    const rows = await this.getSettingRows();
    const out = { ...DEFAULT_SETTINGS } as Record<string, number | boolean>;
    for (const r of rows) out[r.key] = r.value;
    return out as unknown as ProcessSettings;
  }

  async saveSetting(key: keyof ProcessSettings, value: number | boolean, actor: string): Promise<void> {
    await this.pool.query(
      `UPDATE process_setting SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`,
      [key, typeof value === 'boolean' ? (value ? 1 : 0) : value, actor],
    );
  }

  /* ── accounts ── */

  async countUsers(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app_user');
    return Number(rows[0]?.n ?? 0);
  }

  async listUsers(): Promise<User[]> {
    const { rows } = await this.pool.query('SELECT * FROM app_user ORDER BY name');
    return rows.map((r) => {
      const { passwordHash: _passwordHash, ...user } = toUser(r);
      return user;
    });
  }

  async getUser(id: string): Promise<UserWithSecret | null> {
    const { rows } = await this.pool.query('SELECT * FROM app_user WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserByEmail(email: string): Promise<UserWithSecret | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM app_user WHERE lower(email) = lower($1)', [email.trim()]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async createUser(u: UserWithSecret): Promise<User> {
    const { rows } = await this.pool.query(
      `INSERT INTO app_user (id, name, email, password_hash, role, is_active, is_protected)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [u.id, u.name, u.email, u.passwordHash, u.role, u.isActive, u.isProtected],
    );
    const { passwordHash: _passwordHash, ...user } = toUser(rows[0]);
    return user;
  }

  async updateUser(u: UserWithSecret): Promise<User> {
    const { rows } = await this.pool.query(
      `UPDATE app_user SET name = $2, email = $3, password_hash = $4, role = $5,
         is_active = $6, last_sign_in_at = $7, is_protected = $8, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [u.id, u.name, u.email, u.passwordHash, u.role, u.isActive, u.lastSignInAt, u.isProtected],
    );
    const { passwordHash: _passwordHash, ...user } = toUser(rows[0]);
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await this.pool.query('DELETE FROM app_user WHERE id = $1', [id]);
  }

  async createSession(s: Session): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_session (token_hash, user_id, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5)`,
      [s.tokenHash, s.userId, s.expiresAt, s.userAgent, s.ip],
    );
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM user_session WHERE token_hash = $1', [tokenHash]);
    const r = rows[0];
    if (!r) return null;
    return {
      tokenHash: r.token_hash as string,
      userId: r.user_id as string,
      createdAt: new Date(r.created_at as string).toISOString(),
      expiresAt: new Date(r.expires_at as string).toISOString(),
      userAgent: (r.user_agent as string | null) ?? null,
      ip: (r.ip as string | null) ?? null,
    };
  }

  async touchSession(tokenHash: string, expiresAt: string): Promise<void> {
    await this.pool.query(
      'UPDATE user_session SET expires_at = $2 WHERE token_hash = $1', [tokenHash, expiresAt]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM user_session WHERE token_hash = $1', [tokenHash]);
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM user_session WHERE user_id = $1', [userId]);
  }

  async purgeExpiredSessions(): Promise<void> {
    await this.pool.query('DELETE FROM user_session WHERE expires_at <= now()');
  }

  /* ── customers ── */

  async listCustomers(): Promise<Customer[]> {
    const { rows } = await this.pool.query('SELECT * FROM customer ORDER BY name');
    return rows.map(toCustomer);
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const { rows } = await this.pool.query('SELECT * FROM customer WHERE id = $1', [id]);
    return rows[0] ? toCustomer(rows[0]) : null;
  }

  async updateCustomer(c: Customer): Promise<Customer> {
    const { rows } = await this.pool.query(
      `UPDATE customer SET name = $2, gstin = $3, contact_name = $4, contact_email = $5, phone = $6
       WHERE id = $1 RETURNING *`,
      [c.id, c.name, c.gstin, c.contactName, c.contactEmail, c.phone],
    );
    // Designs carry the customer name as it stood, so keep them in step on a rename.
    await this.pool.query('UPDATE design SET customer_name = $2 WHERE customer_id = $1', [c.id, c.name]);
    return toCustomer(rows[0]);
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.pool.query('DELETE FROM customer WHERE id = $1', [id]);
  }

  async countDesignsForCustomer(id: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM design WHERE customer_id = $1', [id]);
    return Number(rows[0]?.n ?? 0);
  }

  async upsertCustomerByName(name: string): Promise<Customer> {
    const found = await this.pool.query('SELECT * FROM customer WHERE lower(name) = lower($1)', [name]);
    if (found.rows[0]) return toCustomer(found.rows[0]);
    const { rows } = await this.pool.query('INSERT INTO customer (name) VALUES ($1) RETURNING *', [name]);
    return toCustomer(rows[0]);
  }

  /* ── designs ── */

  async listDesigns(filter: DesignFilter): Promise<Design[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

    if (filter.status) add('status = ?', filter.status);
    if (filter.customer) add('customer_name ILIKE ?', `%${filter.customer}%`);
    if (filter.accuracyClass) add('accuracy_class = ?', filter.accuracyClass);
    if (filter.burdenVA !== undefined) add('burden_va = ?', filter.burdenVA);
    if (filter.minId !== undefined) add('finished_id_mm >= ?', filter.minId);
    if (filter.maxOd !== undefined) add('finished_od_mm <= ?', filter.maxOd);
    if (filter.q) {
      params.push(`%${filter.q}%`);
      const i = `$${params.length}`;
      where.push(`(design_no ILIKE ${i} OR customer_name ILIKE ${i} OR coalesce(po_no,'') ILIKE ${i}
                   OR coalesce(prd_no,'') ILIKE ${i} OR coalesce(enquiry_no,'') ILIKE ${i})`);
    }
    const sql = `SELECT * FROM design ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY created_at DESC ${filter.limit ? `LIMIT ${Number(filter.limit)}` : ''}`;
    const { rows } = await this.pool.query(sql, params);
    const designs = rows.map(toDesign);
    return filter.ratio
      ? designs.filter((d) => `${d.inputs.primaryCurrent}/${d.inputs.secondaryCurrent}`.includes(filter.ratio!))
      : designs;
  }

  async getDesign(id: string): Promise<Design | null> {
    const { rows } = await this.pool.query('SELECT * FROM design WHERE id = $1', [id]);
    return rows[0] ? toDesign(rows[0]) : null;
  }

  async createDesign(d: Design): Promise<Design> {
    const { rows } = await this.pool.query(
      `INSERT INTO design (id, design_no, revision, customer_id, customer_name, enquiry_no, po_no,
        prd_no, quantity, required_by, ct_type, primary_current, secondary_current, burden_va,
        accuracy_class, finished_id_mm, finished_od_mm, max_width_mm, insulation_type,
        settings_snapshot, reference_snapshot, status, created_by, supersedes, engineering_spec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [d.id, d.designNo, d.revision, d.customerId, d.customerName, d.enquiryNo, d.poNo, d.prdNo,
        d.quantity, d.requiredBy, d.inputs.ctType, d.inputs.primaryCurrent, d.inputs.secondaryCurrent,
        d.inputs.burdenVA, d.inputs.accuracyClass, d.inputs.finishedIdMm, d.inputs.finishedOdMm,
        d.inputs.maxWidthMm, d.insulationType, d.settingsSnapshot, d.referenceSnapshot,
        d.status, d.createdBy, d.supersedesId, d.inputs.engineering ?? null],
    );
    return toDesign(rows[0]);
  }

  async updateDesign(d: Design): Promise<Design> {
    const { rows } = await this.pool.query(
      `UPDATE design SET customer_id=$2, customer_name=$3, enquiry_no=$4, po_no=$5, prd_no=$6,
         quantity=$7, required_by=$8, ct_type=$9, primary_current=$10, secondary_current=$11,
         burden_va=$12, accuracy_class=$13, finished_id_mm=$14, finished_od_mm=$15, max_width_mm=$16,
         insulation_type=$17, settings_snapshot=$18, reference_snapshot=$19, status=$20,
         selected_option_id=$21, approved_by=$22, approved_at=$23, superseded_by=$24, engineering_spec=$25, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [d.id, d.customerId, d.customerName, d.enquiryNo, d.poNo, d.prdNo, d.quantity, d.requiredBy,
        d.inputs.ctType, d.inputs.primaryCurrent, d.inputs.secondaryCurrent, d.inputs.burdenVA,
        d.inputs.accuracyClass, d.inputs.finishedIdMm, d.inputs.finishedOdMm, d.inputs.maxWidthMm,
        d.insulationType, d.settingsSnapshot, d.referenceSnapshot, d.status, d.selectedOptionId,
        d.approvedBy, d.approvedAt, d.supersededById, d.inputs.engineering ?? null],
    );
    return toDesign(rows[0]);
  }

  async deleteDesign(id: string): Promise<void> {
    // design_option, design_bom and manufactured_result cascade on the foreign key.
    await this.pool.query('UPDATE design SET superseded_by = NULL WHERE superseded_by = $1', [id]);
    await this.pool.query('UPDATE design SET supersedes = NULL WHERE supersedes = $1', [id]);
    await this.pool.query('DELETE FROM design WHERE id = $1', [id]);
  }

  async nextDesignNo(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `MTK-${year}-`;
    const { rows } = await this.pool.query<{ design_no: string }>(
      `SELECT design_no FROM design WHERE design_no LIKE $1 ORDER BY design_no DESC LIMIT 1`,
      [`${prefix}%`],
    );
    const last = rows[0] ? Number.parseInt(rows[0].design_no.slice(prefix.length), 10) : 0;
    return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
  }

  /* ── options, bom, results, audit ── */

  async getOptions(designId: string): Promise<StoredOption[]> {
    const { rows } = await this.pool.query(
      'SELECT payload, id, is_selected FROM design_option WHERE design_id = $1', [designId]);
    return rows.map((r) => ({ ...(r.payload as StoredOption), id: r.id as string, isSelected: Boolean(r.is_selected) }));
  }

  async replaceOptions(designId: string, options: StoredOption[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM design_option WHERE design_id = $1', [designId]);
      for (const o of options) {
        await client.query(
          `INSERT INTO design_option (id, design_id, grade_code, swg, b_raw_t, b_used_t, was_capped,
            core_area_cm2, core_width_mm, ordered_width_mm, wire_length_m, resistance_ohm, v_drop,
            v_total, core_weight_kg, copper_weight_kg, core_cost, copper_cost, total_cost, die_id,
            is_feasible, infeasible_reason, is_selected, is_provisional, rank, iterations, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
          [o.id, designId, o.gradeCode, o.swg, o.bRawT, o.bUsedT, o.wasCapped, o.coreAreaCm2,
            o.coreWidthMm, o.orderedWidthMm, o.wireLengthM, o.resistanceOhm, o.vDrop, o.vTotal,
            o.coreWeightKg, o.copperWeightKg, o.coreCost, o.copperCost, o.totalCost, o.dieId,
            o.isFeasible, o.infeasibleReasons.join('; ') || null, o.isSelected, true, o.rank,
            JSON.stringify(o.iterations), JSON.stringify(o)],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getBom(designId: string): Promise<BomLine[]> {
    const { rows } = await this.pool.query('SELECT * FROM design_bom WHERE design_id = $1', [designId]);
    return rows.map((r) => ({
      id: r.id as string, designId, itemType: r.item_type as BomLine['itemType'],
      itemRef: (r.item_ref as string | null) ?? null, description: r.description as string,
      quantity: num(r.quantity), unit: r.unit as string,
    }));
  }

  async replaceBom(designId: string, lines: BomLine[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM design_bom WHERE design_id = $1', [designId]);
      for (const l of lines) {
        await client.query(
          `INSERT INTO design_bom (id, design_id, item_type, item_ref, description, quantity, unit)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [l.id, designId, l.itemType, l.itemRef, l.description, l.quantity, l.unit],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listResults(designId: string): Promise<ManufacturedResult[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM manufactured_result WHERE design_id = $1 ORDER BY created_at DESC', [designId]);
    return rows.map((r) => ({
      id: r.id as string, designId, batchNo: r.batch_no as string,
      manufacturedOn: r.manufactured_on ? String(r.manufactured_on).slice(0, 10) : null,
      actualCoreGrade: (r.actual_core_grade as string | null) ?? null,
      actualCoreWidthMm: numOrNull(r.actual_core_width_mm),
      actualCoreWeightKg: numOrNull(r.actual_core_weight_kg),
      actualCopperWeightKg: numOrNull(r.actual_copper_weight_kg),
      measuredRatioErrorPct: numOrNull(r.measured_ratio_error_pct),
      measuredPhaseErrorMin: numOrNull(r.measured_phase_error_min),
      measuredResistanceOhm: numOrNull(r.measured_resistance_ohm),
      testLab: (r.test_lab as string | null) ?? null,
      passed: Boolean(r.passed), notes: (r.notes as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }

  async addResult(r: ManufacturedResult): Promise<void> {
    await this.pool.query(
      `INSERT INTO manufactured_result (id, design_id, batch_no, manufactured_on, actual_core_grade,
        actual_core_width_mm, actual_core_weight_kg, actual_copper_weight_kg, measured_ratio_error_pct,
        measured_phase_error_min, measured_resistance_ohm, test_lab, passed, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [r.id, r.designId, r.batchNo, r.manufacturedOn, r.actualCoreGrade, r.actualCoreWidthMm,
        r.actualCoreWeightKg, r.actualCopperWeightKg, r.measuredRatioErrorPct,
        r.measuredPhaseErrorMin, r.measuredResistanceOhm, r.testLab, r.passed, r.notes],
    );
  }

  async deleteResult(id: string): Promise<void> {
    await this.pool.query('DELETE FROM manufactured_result WHERE id = $1', [id]);
  }

  async audit(e: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (id, entity, entity_id, action, actor, before, after)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.id || randomUUID(), e.entity, e.entityId, e.action, e.actor,
        JSON.stringify(e.before ?? null), JSON.stringify(e.after ?? null)],
    );
  }

  async listAudit(entityId: string): Promise<AuditEntry[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM audit_log WHERE entity_id = $1 ORDER BY at ASC', [entityId]);
    return rows.map((r) => ({
      id: r.id as string, entity: r.entity as string, entityId: r.entity_id as string,
      action: r.action as string, actor: r.actor as string,
      before: r.before, after: r.after, at: new Date(r.at as string).toISOString(),
    }));
  }
}

function toUser(r: Record<string, unknown>): UserWithSecret {
  return {
    id: r.id as string,
    name: r.name as string,
    email: r.email as string,
    passwordHash: r.password_hash as string,
    role: r.role as UserWithSecret['role'],
    isActive: Boolean(r.is_active),
    isProtected: Boolean(r.is_protected),
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    lastSignInAt: r.last_sign_in_at ? new Date(r.last_sign_in_at as string).toISOString() : null,
  };
}

function toCustomer(r: Record<string, unknown>): Customer {
  return {
    id: r.id as string, name: r.name as string,
    gstin: (r.gstin as string | null) ?? null,
    contactName: (r.contact_name as string | null) ?? null,
    contactEmail: (r.contact_email as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

function toDesign(r: Record<string, unknown>): Design {
  return {
    id: r.id as string,
    designNo: r.design_no as string,
    revision: num(r.revision),
    customerId: (r.customer_id as string | null) ?? null,
    customerName: r.customer_name as string,
    enquiryNo: (r.enquiry_no as string | null) ?? null,
    poNo: (r.po_no as string | null) ?? null,
    prdNo: (r.prd_no as string | null) ?? null,
    quantity: numOrNull(r.quantity),
    requiredBy: r.required_by ? String(r.required_by).slice(0, 10) : null,
    insulationType: (r.insulation_type as string | null) ?? null,
    inputs: {
      engineering: (r.engineering_spec as import('@meltek/engine').EngineeringSpec | null) ?? null,
      primaryCurrent: num(r.primary_current),
      secondaryCurrent: num(r.secondary_current),
      burdenVA: num(r.burden_va),
      accuracyClass: r.accuracy_class as string,
      finishedIdMm: num(r.finished_id_mm),
      finishedOdMm: num(r.finished_od_mm),
      ctType: r.ct_type as 'ring' | 'wound-primary',
      maxWidthMm: numOrNull(r.max_width_mm),
    },
    settingsSnapshot: (r.settings_snapshot as ProcessSettings | null) ?? null,
    referenceSnapshot: (r.reference_snapshot as ReferenceData | null) ?? null,
    status: r.status as DesignStatus,
    selectedOptionId: (r.selected_option_id as string | null) ?? null,
    createdBy: (r.created_by as string) ?? 'system',
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    approvedBy: (r.approved_by as string | null) ?? null,
    approvedAt: r.approved_at ? new Date(r.approved_at as string).toISOString() : null,
    supersededById: (r.superseded_by as string | null) ?? null,
    supersedesId: (r.supersedes as string | null) ?? null,
  };
}
