import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import mysql, { type RowDataPacket } from 'mysql2/promise';
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
const dt = (v: string | null | undefined): string | null =>
  v ? v.replace('T', ' ').replace('Z', '').replace(/\.\d+$/, '') : null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = any[];

export class MysqlStore implements Store {
  readonly kind = 'mysql' as const;
  private readonly pool: mysql.Pool;

  constructor(connectionString: string) {
    const url = new URL(connectionString);
    const sslParam = url.searchParams.get('ssl-mode')
      ?? url.searchParams.get('sslmode')
      ?? url.searchParams.get('ssl');
    const ssl = sslParam !== '0' && sslParam?.toLowerCase() !== 'disable' && sslParam?.toLowerCase() !== 'disabled';
    this.pool = mysql.createPool({
      host: url.hostname,
      port: Number(url.port) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 10000,
    });
  }

  async init(): Promise<void> {
    const raw = await readFile(resolve(here, 'schema.mysql.sql'), 'utf8');
    const ddl = raw.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const statements = ddl
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        await this.pool.execute(stmt);
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        // Ignore "duplicate key/index" errors for idempotent re-runs
        if (code === 'ER_DUP_KEYNAME' || code === 'ER_DUP_FIELDNAME') continue;
        throw err;
      }
    }
    const countRows = await this.query('SELECT COUNT(*) AS n FROM steel_grade');
    if (Number(countRows[0]?.n ?? 0) === 0) await this.seed();
  }

  async close(): Promise<void> { await this.pool.end(); }

  private async seed(): Promise<void> {
    const ref = seedReferenceData();
    for (const g of ref.grades) await this.saveGrade(g);
    for (const w of ref.gauges) await this.saveGauge(w);
    for (const c of ref.classes) {
      await this.pool.execute(
        `INSERT INTO accuracy_class (code, percent, per_is, note, max_flux_density_t)
         VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE percent = VALUES(percent), per_is = VALUES(per_is), note = VALUES(note)`,
        [c.code, c.percent, c.perIS ? 1 : 0, c.note, c.maxFluxDensityT ?? null] as Params,
      );
    }
    await this.pool.execute(
      `INSERT INTO material_rate (id, material_type, rate_per_kg) VALUES (?,?,?)`,
      [randomUUID(), 'copper', ref.copperRatePerKg],
    );
    for (const row of defaultSettingRows()) {
      await this.pool.execute(
        `INSERT IGNORE INTO process_setting (\`key\`, value, unit, label, is_confirmed, source_note)
         VALUES (?,?,?,?,?,?)`,
        [row.key, typeof row.value === 'boolean' ? (row.value ? 1 : 0) : row.value,
          row.unit, row.label, row.isConfirmed ? 1 : 0, row.sourceNote],
      );
    }
  }

  private async query(sql: string, params?: Params): Promise<RowDataPacket[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, params ?? []);
    return rows as RowDataPacket[];
  }

  /* ── reference ── */

  async getReference(): Promise<ReferenceData> {
    const grades = await this.query(
      `SELECT g.id, g.code, g.label, g.note, g.density_g_cm3, g.stacking_factor, g.is_available,
              (SELECT r.rate_per_kg FROM material_rate r
                WHERE r.grade_id = g.id AND r.effective_to IS NULL
                ORDER BY r.effective_from DESC LIMIT 1) AS rate_per_kg
         FROM steel_grade g ORDER BY g.code`);
    const points = await this.query(
      `SELECT grade_id, flux_density_t, magnetising_at_cm FROM bh_point ORDER BY flux_density_t`);
    const gauges = await this.query(`SELECT * FROM wire_gauge ORDER BY swg`);
    const classes = await this.query(`SELECT * FROM accuracy_class ORDER BY percent`);
    const dies = await this.query(`SELECT * FROM die ORDER BY die_no`);
    const slits = await this.query(
      `SELECT width_mm FROM slit_width WHERE is_stocked = 1 ORDER BY width_mm`);
    const copper = await this.query(
      `SELECT rate_per_kg FROM material_rate WHERE material_type = 'copper' AND effective_to IS NULL
        ORDER BY effective_from DESC LIMIT 1`);

    return {
      grades: grades.map((g) => ({
        code: g.code as string,
        label: g.label as string,
        note: (g.note as string | null) ?? null,
        ratePerKg: numOrNull(g.rate_per_kg),
        densityGCm3: numOrNull(g.density_g_cm3),
        stackingFactor: numOrNull(g.stacking_factor),
        isAvailable: Boolean(g.is_available),
        curve: points
          .filter((p) => p.grade_id === g.id)
          .map((p) => ({ teslaT: num(p.flux_density_t), hAtCm: numOrNull(p.magnetising_at_cm) })),
      })),
      gauges: gauges.map((w) => ({
        swg: num(w.swg), diaMm: num(w.dia_mm), areaSqmm: num(w.area_sqmm),
        ohmPerM20c: num(w.ohm_per_m_20c), ohmPerM75c: numOrNull(w.ohm_per_m_75c),
        gramPerM: num(w.gram_per_m), isAvailable: Boolean(w.is_available),
      })),
      classes: classes.map((c) => ({
        code: c.code as string, percent: num(c.percent), perIS: Boolean(c.per_is),
        note: (c.note as string) ?? '', maxFluxDensityT: numOrNull(c.max_flux_density_t),
      })),
      dies: dies.map((d) => ({
        id: d.id as string, dieNo: d.die_no as string, minOdMm: num(d.min_od_mm),
        maxOdMm: num(d.max_od_mm), maxWidthMm: num(d.max_width_mm), quantity: num(d.quantity),
        location: (d.location as string | null) ?? null, isAvailable: Boolean(d.is_available),
      })),
      slitWidthsMm: slits.map((s) => num(s.width_mm)),
      copperRatePerKg: copper.length ? num(copper[0]!.rate_per_kg) : 0,
    };
  }

  async saveGrade(grade: SteelGrade): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // Upsert the grade
      const id = randomUUID();
      await conn.execute(
        `INSERT INTO steel_grade (id, code, label, note, density_g_cm3, stacking_factor, is_available)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE label = VALUES(label), note = VALUES(note),
           density_g_cm3 = VALUES(density_g_cm3), stacking_factor = VALUES(stacking_factor),
           is_available = VALUES(is_available), updated_at = CURRENT_TIMESTAMP`,
        [id, grade.code, grade.label, grade.note ?? null, grade.densityGCm3, grade.stackingFactor, grade.isAvailable ? 1 : 0] as Params,
      );

      // Get the actual id (may differ on update)
      const [idRows] = await conn.query('SELECT id FROM steel_grade WHERE code = ?', [grade.code]);
      const gradeId = (idRows as RowDataPacket[])[0]!.id as string;

      await conn.execute('DELETE FROM bh_point WHERE grade_id = ?', [gradeId]);
      for (const p of grade.curve) {
        await conn.execute(
          'INSERT INTO bh_point (id, grade_id, flux_density_t, magnetising_at_cm) VALUES (?,?,?,?)',
          [randomUUID(), gradeId, p.teslaT, p.hAtCm],
        );
      }

      if (grade.ratePerKg !== null) {
        await conn.execute(
          `UPDATE material_rate SET effective_to = CURRENT_DATE
            WHERE grade_id = ? AND effective_to IS NULL AND rate_per_kg <> ?`,
          [gradeId, grade.ratePerKg],
        );
        const [existingRates] = await conn.query(
          `SELECT 1 FROM material_rate WHERE grade_id = ? AND effective_to IS NULL AND rate_per_kg = ?`,
          [gradeId, grade.ratePerKg],
        );
        if ((existingRates as RowDataPacket[]).length === 0) {
          await conn.execute(
            `INSERT INTO material_rate (id, material_type, grade_id, rate_per_kg) VALUES (?,'steel',?,?)`,
            [randomUUID(), gradeId, grade.ratePerKg],
          );
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async deleteGrade(code: string): Promise<void> {
    await this.pool.execute('DELETE FROM steel_grade WHERE code = ?', [code]);
  }

  async saveGauge(g: WireGauge): Promise<void> {
    await this.pool.execute(
      `INSERT INTO wire_gauge (swg, dia_mm, area_sqmm, ohm_per_m_20c, ohm_per_m_75c, gram_per_m, is_available)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE dia_mm = VALUES(dia_mm), area_sqmm = VALUES(area_sqmm),
         ohm_per_m_20c = VALUES(ohm_per_m_20c), ohm_per_m_75c = VALUES(ohm_per_m_75c),
         gram_per_m = VALUES(gram_per_m), is_available = VALUES(is_available)`,
      [g.swg, g.diaMm, g.areaSqmm, g.ohmPerM20c, g.ohmPerM75c, g.gramPerM, g.isAvailable ? 1 : 0],
    );
  }

  async deleteGauge(swg: number): Promise<void> {
    await this.pool.execute('DELETE FROM wire_gauge WHERE swg = ?', [swg]);
  }

  async saveDies(dies: Die[]): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM die');
      for (const d of dies) {
        await conn.execute(
          `INSERT INTO die (id, die_no, min_od_mm, max_od_mm, max_width_mm, quantity, location, is_available)
           VALUES (?,?,?,?,?,?,?,?)`,
          [d.id ?? randomUUID(), d.dieNo, d.minOdMm, d.maxOdMm, d.maxWidthMm, d.quantity, d.location ?? null, d.isAvailable ? 1 : 0],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async saveSlitWidths(widths: number[]): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM slit_width');
      for (const w of [...new Set(widths)].sort((a, b) => a - b)) {
        await conn.execute('INSERT INTO slit_width (width_mm, is_stocked) VALUES (?, 1)', [w]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async saveCopperRate(rate: number): Promise<void> {
    await this.pool.execute(
      `UPDATE material_rate SET effective_to = CURRENT_DATE
        WHERE material_type = 'copper' AND effective_to IS NULL`);
    await this.pool.execute(
      `INSERT INTO material_rate (id, material_type, rate_per_kg) VALUES (?,'copper',?)`,
      [randomUUID(), rate]);
  }

  /* ── settings ── */

  async getSettingRows(): Promise<SettingRow[]> {
    const rows = await this.query('SELECT * FROM process_setting');
    const byKey = new Map(rows.map((r) => [r.key as string, r]));
    return SETTING_META.map((m) => {
      const r = byKey.get(m.key);
      const raw = r ? num(r.value) : (DEFAULT_SETTINGS[m.key] as number | boolean);
      return {
        key: m.key,
        value: typeof DEFAULT_SETTINGS[m.key] === 'boolean' ? Boolean(Number(raw)) : Number(raw),
        unit: m.unit,
        label: m.label,
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
    await this.pool.execute(
      'UPDATE process_setting SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE `key` = ?',
      [typeof value === 'boolean' ? (value ? 1 : 0) : value, actor, key],
    );
  }

  /* ── accounts ── */

  async countUsers(): Promise<number> {
    const rows = await this.query('SELECT COUNT(*) AS n FROM app_user');
    return Number(rows[0]?.n ?? 0);
  }

  async listUsers(): Promise<User[]> {
    const rows = await this.query('SELECT * FROM app_user ORDER BY name');
    return rows.map((r) => {
      const { passwordHash: _pw, ...user } = toUser(r);
      return user;
    });
  }

  async getUser(id: string): Promise<UserWithSecret | null> {
    const rows = await this.query('SELECT * FROM app_user WHERE id = ?', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserByEmail(email: string): Promise<UserWithSecret | null> {
    const rows = await this.query(
      'SELECT * FROM app_user WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async createUser(u: UserWithSecret): Promise<User> {
    await this.pool.execute(
      `INSERT INTO app_user (id, name, email, password_hash, role, is_active, is_protected, last_sign_in_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [u.id, u.name, u.email, u.passwordHash, u.role, u.isActive ? 1 : 0, u.isProtected ? 1 : 0, dt(u.lastSignInAt)],
    );
    const { passwordHash: _pw, ...user } = u;
    return user;
  }

  async updateUser(u: UserWithSecret): Promise<User> {
    await this.pool.execute(
      `UPDATE app_user SET name = ?, email = ?, password_hash = ?, role = ?,
         is_active = ?, last_sign_in_at = ?, is_protected = ?
       WHERE id = ?`,
      [u.name, u.email, u.passwordHash, u.role, u.isActive ? 1 : 0, dt(u.lastSignInAt), u.isProtected ? 1 : 0, u.id],
    );
    const { passwordHash: _pw, ...user } = u;
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await this.pool.execute('DELETE FROM app_user WHERE id = ?', [id]);
  }

  async createSession(s: Session): Promise<void> {
    await this.pool.execute(
      `INSERT INTO user_session (token_hash, user_id, created_at, expires_at, user_agent, ip)
       VALUES (?,?,?,?,?,?)`,
      [s.tokenHash, s.userId, dt(s.createdAt), dt(s.expiresAt), s.userAgent, s.ip],
    );
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    const rows = await this.query(
      'SELECT * FROM user_session WHERE token_hash = ?', [tokenHash]);
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
    await this.pool.execute(
      'UPDATE user_session SET expires_at = ? WHERE token_hash = ?', [dt(expiresAt), tokenHash]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.execute('DELETE FROM user_session WHERE token_hash = ?', [tokenHash]);
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.pool.execute('DELETE FROM user_session WHERE user_id = ?', [userId]);
  }

  async purgeExpiredSessions(): Promise<void> {
    await this.pool.execute('DELETE FROM user_session WHERE expires_at <= NOW()');
  }

  /* ── customers ── */

  async listCustomers(): Promise<Customer[]> {
    const rows = await this.query('SELECT * FROM customer ORDER BY name');
    return rows.map(toCustomer);
  }

  async getCustomer(id: string): Promise<Customer | null> {
    const rows = await this.query('SELECT * FROM customer WHERE id = ?', [id]);
    return rows[0] ? toCustomer(rows[0]) : null;
  }

  async updateCustomer(c: Customer): Promise<Customer> {
    await this.pool.execute(
      `UPDATE customer SET name = ?, gstin = ?, contact_name = ?, contact_email = ?, phone = ?
       WHERE id = ?`,
      [c.name, c.gstin, c.contactName, c.contactEmail, c.phone, c.id],
    );
    await this.pool.execute('UPDATE design SET customer_name = ? WHERE customer_id = ?', [c.name, c.id]);
    return c;
  }

  async deleteCustomer(id: string): Promise<void> {
    await this.pool.execute('DELETE FROM customer WHERE id = ?', [id]);
  }

  async countDesignsForCustomer(id: string): Promise<number> {
    const rows = await this.query(
      'SELECT COUNT(*) AS n FROM design WHERE customer_id = ?', [id]);
    return Number(rows[0]?.n ?? 0);
  }

  async upsertCustomerByName(name: string): Promise<Customer> {
    const found = await this.query(
      'SELECT * FROM customer WHERE LOWER(name) = LOWER(?)', [name]);
    if (found[0]) return toCustomer(found[0]);
    const id = randomUUID();
    await this.pool.execute('INSERT INTO customer (id, name) VALUES (?,?)', [id, name]);
    const rows = await this.query('SELECT * FROM customer WHERE id = ?', [id]);
    return toCustomer(rows[0]!);
  }

  /* ── designs ── */

  async listDesigns(filter: DesignFilter): Promise<Design[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.status) { where.push('status = ?'); params.push(filter.status); }
    if (filter.customer) { where.push('customer_name LIKE ?'); params.push(`%${filter.customer}%`); }
    if (filter.accuracyClass) { where.push('accuracy_class = ?'); params.push(filter.accuracyClass); }
    if (filter.burdenVA !== undefined) { where.push('burden_va = ?'); params.push(filter.burdenVA); }
    if (filter.minId !== undefined) { where.push('finished_id_mm >= ?'); params.push(filter.minId); }
    if (filter.maxOd !== undefined) { where.push('finished_od_mm <= ?'); params.push(filter.maxOd); }
    if (filter.q) {
      where.push(`(design_no LIKE ? OR customer_name LIKE ? OR COALESCE(po_no,'') LIKE ?
                   OR COALESCE(prd_no,'') LIKE ? OR COALESCE(enquiry_no,'') LIKE ?)`);
      const q = `%${filter.q}%`;
      params.push(q, q, q, q, q);
    }
    const sql = `SELECT * FROM design ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY created_at DESC ${filter.limit ? `LIMIT ${Number(filter.limit)}` : ''}`;
    const rows = await this.query(sql, params);
    const designs = rows.map(toDesign);
    return filter.ratio
      ? designs.filter((d) => `${d.inputs.primaryCurrent}/${d.inputs.secondaryCurrent}`.includes(filter.ratio!))
      : designs;
  }

  async getDesign(id: string): Promise<Design | null> {
    const rows = await this.query('SELECT * FROM design WHERE id = ?', [id]);
    return rows[0] ? toDesign(rows[0]) : null;
  }

  async createDesign(d: Design): Promise<Design> {
    await this.pool.execute(
      `INSERT INTO design (id, design_no, revision, customer_id, customer_name, enquiry_no, po_no,
        prd_no, quantity, required_by, ct_type, primary_current, secondary_current, burden_va,
        accuracy_class, finished_id_mm, finished_od_mm, max_width_mm, insulation_type,
        settings_snapshot, reference_snapshot, status, created_by, supersedes, engineering_spec)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.id, d.designNo, d.revision, d.customerId, d.customerName, d.enquiryNo, d.poNo, d.prdNo,
        d.quantity, d.requiredBy, d.inputs.ctType, d.inputs.primaryCurrent, d.inputs.secondaryCurrent,
        d.inputs.burdenVA, d.inputs.accuracyClass, d.inputs.finishedIdMm, d.inputs.finishedOdMm,
        d.inputs.maxWidthMm, d.insulationType, JSON.stringify(d.settingsSnapshot),
        JSON.stringify(d.referenceSnapshot), d.status, d.createdBy, d.supersedesId, JSON.stringify(d.inputs.engineering ?? null)],
    );
    return d;
  }

  async updateDesign(d: Design): Promise<Design> {
    await this.pool.execute(
      `UPDATE design SET customer_id=?, customer_name=?, enquiry_no=?, po_no=?, prd_no=?,
         quantity=?, required_by=?, ct_type=?, primary_current=?, secondary_current=?,
         burden_va=?, accuracy_class=?, finished_id_mm=?, finished_od_mm=?, max_width_mm=?,
         insulation_type=?, settings_snapshot=?, reference_snapshot=?, status=?,
         selected_option_id=?, approved_by=?, approved_at=?, superseded_by=?, engineering_spec=?
       WHERE id=?`,
      [d.customerId, d.customerName, d.enquiryNo, d.poNo, d.prdNo, d.quantity, d.requiredBy,
        d.inputs.ctType, d.inputs.primaryCurrent, d.inputs.secondaryCurrent, d.inputs.burdenVA,
        d.inputs.accuracyClass, d.inputs.finishedIdMm, d.inputs.finishedOdMm, d.inputs.maxWidthMm,
        d.insulationType, JSON.stringify(d.settingsSnapshot), JSON.stringify(d.referenceSnapshot),
        d.status, d.selectedOptionId, d.approvedBy, dt(d.approvedAt), d.supersededById, JSON.stringify(d.inputs.engineering ?? null), d.id],
    );
    return d;
  }

  async deleteDesign(id: string): Promise<void> {
    await this.pool.execute('UPDATE design SET superseded_by = NULL WHERE superseded_by = ?', [id]);
    await this.pool.execute('UPDATE design SET supersedes = NULL WHERE supersedes = ?', [id]);
    await this.pool.execute('DELETE FROM design WHERE id = ?', [id]);
  }

  async nextDesignNo(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `MTK-${year}-`;
    const rows = await this.query(
      `SELECT design_no FROM design WHERE design_no LIKE ? ORDER BY design_no DESC LIMIT 1`,
      [`${prefix}%`],
    );
    const last = rows[0] ? Number.parseInt((rows[0].design_no as string).slice(prefix.length), 10) : 0;
    return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
  }

  /* ── options, bom, results, audit ── */

  async getOptions(designId: string): Promise<StoredOption[]> {
    const rows = await this.query(
      'SELECT payload, id, is_selected FROM design_option WHERE design_id = ?', [designId]);
    return rows.map((r) => {
      const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      return { ...payload, id: r.id as string, isSelected: Boolean(r.is_selected) };
    });
  }

  async replaceOptions(designId: string, options: StoredOption[]): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM design_option WHERE design_id = ?', [designId]);
      for (const o of options) {
        await conn.execute(
          `INSERT INTO design_option (id, design_id, grade_code, swg, b_raw_t, b_used_t, was_capped,
            core_area_cm2, core_width_mm, ordered_width_mm, wire_length_m, resistance_ohm, v_drop,
            v_total, core_weight_kg, copper_weight_kg, core_cost, copper_cost, total_cost, die_id,
            is_feasible, infeasible_reason, is_selected, is_provisional, \`rank\`, iterations, payload)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [o.id, designId, o.gradeCode, o.swg, o.bRawT, o.bUsedT, o.wasCapped ? 1 : 0, o.coreAreaCm2,
            o.coreWidthMm, o.orderedWidthMm, o.wireLengthM, o.resistanceOhm, o.vDrop, o.vTotal,
            o.coreWeightKg, o.copperWeightKg, o.coreCost, o.copperCost, o.totalCost, o.dieId,
            o.isFeasible ? 1 : 0, o.infeasibleReasons.join('; ') || null, o.isSelected ? 1 : 0, 1,
            o.rank, JSON.stringify(o.iterations), JSON.stringify(o)],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getBom(designId: string): Promise<BomLine[]> {
    const rows = await this.query(
      'SELECT * FROM design_bom WHERE design_id = ?', [designId]);
    return rows.map((r) => ({
      id: r.id as string, designId, itemType: r.item_type as BomLine['itemType'],
      itemRef: (r.item_ref as string | null) ?? null, description: r.description as string,
      quantity: num(r.quantity), unit: r.unit as string,
    }));
  }

  async replaceBom(designId: string, lines: BomLine[]): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM design_bom WHERE design_id = ?', [designId]);
      for (const l of lines) {
        await conn.execute(
          `INSERT INTO design_bom (id, design_id, item_type, item_ref, description, quantity, unit)
           VALUES (?,?,?,?,?,?,?)`,
          [l.id, designId, l.itemType, l.itemRef, l.description, l.quantity, l.unit],
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async listResults(designId: string): Promise<ManufacturedResult[]> {
    const rows = await this.query(
      'SELECT * FROM manufactured_result WHERE design_id = ? ORDER BY created_at DESC', [designId]);
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
    await this.pool.execute(
      `INSERT INTO manufactured_result (id, design_id, batch_no, manufactured_on, actual_core_grade,
        actual_core_width_mm, actual_core_weight_kg, actual_copper_weight_kg, measured_ratio_error_pct,
        measured_phase_error_min, measured_resistance_ohm, test_lab, passed, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.designId, r.batchNo, r.manufacturedOn, r.actualCoreGrade, r.actualCoreWidthMm,
        r.actualCoreWeightKg, r.actualCopperWeightKg, r.measuredRatioErrorPct,
        r.measuredPhaseErrorMin, r.measuredResistanceOhm, r.testLab, r.passed ? 1 : 0, r.notes],
    );
  }

  async deleteResult(id: string): Promise<void> {
    await this.pool.execute('DELETE FROM manufactured_result WHERE id = ?', [id]);
  }

  async audit(e: AuditEntry): Promise<void> {
    await this.pool.execute(
      'INSERT INTO audit_log (id, entity, entity_id, action, actor, `before`, `after`) VALUES (?,?,?,?,?,?,?)',
      [e.id || randomUUID(), e.entity, e.entityId, e.action, e.actor,
        JSON.stringify(e.before ?? null), JSON.stringify(e.after ?? null)],
    );
  }

  async listAudit(entityId: string): Promise<AuditEntry[]> {
    const rows = await this.query(
      'SELECT * FROM audit_log WHERE entity_id = ? ORDER BY `at` ASC', [entityId]);
    return rows.map((r) => ({
      id: r.id as string, entity: r.entity as string, entityId: r.entity_id as string,
      action: r.action as string, actor: r.actor as string,
      before: typeof r.before === 'string' ? JSON.parse(r.before) : r.before,
      after: typeof r.after === 'string' ? JSON.parse(r.after) : r.after,
      at: new Date(r.at as string).toISOString(),
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
      engineering: typeof r.engineering_spec === 'string' ? JSON.parse(r.engineering_spec) : r.engineering_spec ?? null,
      primaryCurrent: num(r.primary_current),
      secondaryCurrent: num(r.secondary_current),
      burdenVA: num(r.burden_va),
      accuracyClass: r.accuracy_class as string,
      finishedIdMm: num(r.finished_id_mm),
      finishedOdMm: num(r.finished_od_mm),
      ctType: r.ct_type as 'ring' | 'wound-primary',
      maxWidthMm: numOrNull(r.max_width_mm),
    },
    settingsSnapshot: typeof r.settings_snapshot === 'string'
      ? JSON.parse(r.settings_snapshot) : (r.settings_snapshot as ProcessSettings | null) ?? null,
    referenceSnapshot: typeof r.reference_snapshot === 'string'
      ? JSON.parse(r.reference_snapshot) : (r.reference_snapshot as ReferenceData | null) ?? null,
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
