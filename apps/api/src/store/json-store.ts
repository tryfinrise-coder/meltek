import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SETTINGS, SETTING_META, seedReferenceData,
  type Die, type ProcessSettings, type ReferenceData, type SteelGrade, type WireGauge,
} from '@meltek/engine';
import type {
  AuditEntry, BomLine, Customer, Design, DesignFilter, ManufacturedResult,
  Session, SettingRow, StoredOption, Store, User, UserWithSecret,
} from './types.js';

interface Db {
  reference: ReferenceData;
  settings: SettingRow[];
  customers: Customer[];
  designs: Design[];
  options: StoredOption[];
  bom: BomLine[];
  results: ManufacturedResult[];
  audit: AuditEntry[];
  users: UserWithSecret[];
  sessions: Session[];
}

/**
 * File-backed store. No infrastructure, so the app runs and hosts anywhere Node runs.
 * Writes go through a serialised queue and land atomically via rename.
 */
export class JsonStore implements Store {
  readonly kind = 'json' as const;
  private readonly file: string;
  private db!: Db;
  private queue: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = resolve(file);
  }

  async init(): Promise<void> {
    try {
      this.db = JSON.parse(await readFile(this.file, 'utf8')) as Db;
      // A setting row is half code and half data: the works owns the value and who last
      // changed it, the application owns the label, unit and explanatory note. Refresh the
      // presentation half on every boot so improved wording ships with a deploy instead of
      // being frozen into the data file at first run.
      const known = new Map(this.db.settings.map((s) => [s.key, s]));
      this.db.settings = defaultSettingRows().map((fresh) => {
        const existing = known.get(fresh.key);
        return existing
          ? { ...fresh, value: existing.value, updatedBy: existing.updatedBy, updatedAt: existing.updatedAt }
          : fresh;
      });
      // Files written before accounts existed have neither collection.
      this.db.users ??= [];
      this.db.sessions ??= [];
    } catch {
      this.db = {
        reference: seedReferenceData(),
        settings: defaultSettingRows(),
        customers: [], designs: [], options: [], bom: [], results: [], audit: [],
        users: [], sessions: [],
      };
      await mkdir(dirname(this.file), { recursive: true });
      await this.flush();
    }
  }

  async close(): Promise<void> { await this.queue; }

  private write(mutate: () => void): Promise<void> {
    this.queue = this.queue.then(async () => { mutate(); await this.flush(); });
    return this.queue;
  }

  private async flush(): Promise<void> {
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    await rename(tmp, this.file);
  }

  private clone<T>(v: T): T { return structuredClone(v); }

  /* ── reference ── */

  async getReference(): Promise<ReferenceData> {
    const reference = this.clone(this.db.reference);
    reference.gauges = reference.gauges.map(g => ({...g,layerPitchMm:g.layerPitchMm ?? null}));
    return reference;
  }

  async saveGrade(grade: SteelGrade): Promise<void> {
    return this.write(() => {
      const i = this.db.reference.grades.findIndex((g) => g.code === grade.code);
      if (i >= 0) this.db.reference.grades[i] = grade;
      else this.db.reference.grades.push(grade);
    });
  }

  async deleteGrade(code: string): Promise<void> {
    return this.write(() => {
      this.db.reference.grades = this.db.reference.grades.filter((g) => g.code !== code);
    });
  }

  async saveGauge(gauge: WireGauge): Promise<void> {
    return this.write(() => {
      const i = this.db.reference.gauges.findIndex((g) => g.swg === gauge.swg);
      if (i >= 0) this.db.reference.gauges[i] = gauge;
      else this.db.reference.gauges.push(gauge);
      this.db.reference.gauges.sort((a, b) => a.swg - b.swg);
    });
  }

  async deleteGauge(swg: number): Promise<void> {
    return this.write(() => {
      this.db.reference.gauges = this.db.reference.gauges.filter((g) => g.swg !== swg);
    });
  }

  async saveDies(dies: Die[]): Promise<void> {
    return this.write(() => { this.db.reference.dies = dies; });
  }

  async saveSlitWidths(widths: number[]): Promise<void> {
    return this.write(() => {
      this.db.reference.slitWidthsMm = [...new Set(widths)].sort((a, b) => a - b);
    });
  }

  async saveCopperRate(rate: number): Promise<void> {
    return this.write(() => { this.db.reference.copperRatePerKg = rate; });
  }

  /* ── settings ── */

  async getSettings(): Promise<ProcessSettings> {
    const out = { ...DEFAULT_SETTINGS } as Record<string, number | boolean>;
    for (const row of this.db.settings) out[row.key] = row.value;
    return out as unknown as ProcessSettings;
  }

  async getSettingRows(): Promise<SettingRow[]> { return this.clone(this.db.settings); }

  async saveSetting(key: keyof ProcessSettings, value: number | boolean, actor: string): Promise<void> {
    return this.write(() => {
      const row = this.db.settings.find((s) => s.key === key);
      if (!row) return;
      row.value = value;
      row.updatedBy = actor;
      row.updatedAt = new Date().toISOString();
    });
  }

  /* ── accounts ── */

  private strip(u: UserWithSecret): User {
    const { passwordHash: _passwordHash, ...rest } = u;
    return this.clone(rest);
  }

  async countUsers(): Promise<number> { return this.db.users.length; }

  async listUsers(): Promise<User[]> {
    return this.db.users
      .map((u) => this.strip(u))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getUser(id: string): Promise<UserWithSecret | null> {
    return this.clone(this.db.users.find((u) => u.id === id) ?? null);
  }

  async getUserByEmail(email: string): Promise<UserWithSecret | null> {
    const wanted = email.trim().toLowerCase();
    return this.clone(this.db.users.find((u) => u.email === wanted) ?? null);
  }

  async createUser(user: UserWithSecret): Promise<User> {
    await this.write(() => { this.db.users.push(user); });
    return this.strip(user);
  }

  async updateUser(user: UserWithSecret): Promise<User> {
    await this.write(() => {
      const i = this.db.users.findIndex((u) => u.id === user.id);
      if (i >= 0) this.db.users[i] = user;
    });
    return this.strip(user);
  }

  async deleteUser(id: string): Promise<void> {
    return this.write(() => {
      this.db.users = this.db.users.filter((u) => u.id !== id);
      this.db.sessions = this.db.sessions.filter((s) => s.userId !== id);
    });
  }

  async createSession(session: Session): Promise<void> {
    return this.write(() => { this.db.sessions.push(session); });
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    return this.clone(this.db.sessions.find((s) => s.tokenHash === tokenHash) ?? null);
  }

  async touchSession(tokenHash: string, expiresAt: string): Promise<void> {
    return this.write(() => {
      const s = this.db.sessions.find((x) => x.tokenHash === tokenHash);
      if (s) s.expiresAt = expiresAt;
    });
  }

  async deleteSession(tokenHash: string): Promise<void> {
    return this.write(() => {
      this.db.sessions = this.db.sessions.filter((s) => s.tokenHash !== tokenHash);
    });
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    return this.write(() => {
      this.db.sessions = this.db.sessions.filter((s) => s.userId !== userId);
    });
  }

  async purgeExpiredSessions(): Promise<void> {
    const now = new Date().toISOString();
    if (!this.db.sessions.some((s) => s.expiresAt <= now)) return;
    return this.write(() => {
      this.db.sessions = this.db.sessions.filter((s) => s.expiresAt > now);
    });
  }

  /* ── customers ── */

  async listCustomers(): Promise<Customer[]> { return this.clone(this.db.customers); }

  async getCustomer(id: string): Promise<Customer | null> {
    return this.clone(this.db.customers.find((c) => c.id === id) ?? null);
  }

  async updateCustomer(customer: Customer): Promise<Customer> {
    await this.write(() => {
      const i = this.db.customers.findIndex((c) => c.id === customer.id);
      if (i >= 0) this.db.customers[i] = customer;
      // Designs carry the customer name as it stood, so keep them in step on a rename.
      for (const d of this.db.designs) {
        if (d.customerId === customer.id) d.customerName = customer.name;
      }
    });
    return customer;
  }

  async deleteCustomer(id: string): Promise<void> {
    return this.write(() => {
      this.db.customers = this.db.customers.filter((c) => c.id !== id);
    });
  }

  async countDesignsForCustomer(id: string): Promise<number> {
    return this.db.designs.filter((d) => d.customerId === id).length;
  }

  async upsertCustomerByName(name: string): Promise<Customer> {
    const existing = this.db.customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return this.clone(existing);
    const customer: Customer = {
      id: randomUUID(), name, gstin: null, contactName: null,
      contactEmail: null, phone: null, createdAt: new Date().toISOString(),
    };
    await this.write(() => { this.db.customers.push(customer); });
    return customer;
  }

  /* ── designs ── */

  async listDesigns(filter: DesignFilter): Promise<Design[]> {
    let rows = this.db.designs;
    if (filter.status) rows = rows.filter((d) => d.status === filter.status);
    if (filter.customer) {
      const q = filter.customer.toLowerCase();
      rows = rows.filter((d) => d.customerName.toLowerCase().includes(q));
    }
    if (filter.accuracyClass) rows = rows.filter((d) => d.inputs.accuracyClass === filter.accuracyClass);
    if (filter.burdenVA !== undefined) rows = rows.filter((d) => d.inputs.burdenVA === filter.burdenVA);
    if (filter.minId !== undefined) rows = rows.filter((d) => d.inputs.finishedIdMm >= filter.minId!);
    if (filter.maxOd !== undefined) rows = rows.filter((d) => d.inputs.finishedOdMm <= filter.maxOd!);
    if (filter.ratio) {
      rows = rows.filter((d) => `${d.inputs.primaryCurrent}/${d.inputs.secondaryCurrent}`.includes(filter.ratio!));
    }
    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter((d) =>
        [d.designNo, d.customerName, d.poNo, d.prdNo, d.enquiryNo]
          .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
    }
    rows = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return this.clone(filter.limit ? rows.slice(0, filter.limit) : rows);
  }

  async getDesign(id: string): Promise<Design | null> {
    return this.clone(this.db.designs.find((d) => d.id === id) ?? null);
  }

  async createDesign(design: Design): Promise<Design> {
    await this.write(() => { this.db.designs.push(design); });
    return design;
  }

  async updateDesign(design: Design): Promise<Design> {
    await this.write(() => {
      const i = this.db.designs.findIndex((d) => d.id === design.id);
      if (i >= 0) this.db.designs[i] = design;
    });
    return design;
  }

  async deleteDesign(id: string): Promise<void> {
    return this.write(() => {
      this.db.designs = this.db.designs.filter((d) => d.id !== id);
      this.db.options = this.db.options.filter((o) => o.designId !== id);
      this.db.bom = this.db.bom.filter((b) => b.designId !== id);
      this.db.results = this.db.results.filter((r) => r.designId !== id);
      // Any revision that pointed at this one no longer has a predecessor.
      for (const d of this.db.designs) {
        if (d.supersededById === id) d.supersededById = null;
        if (d.supersedesId === id) d.supersedesId = null;
      }
    });
  }

  async nextDesignNo(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `MTK-${year}-`;
    const used = this.db.designs
      .map((d) => d.designNo)
      .filter((n) => n.startsWith(prefix))
      .map((n) => Number.parseInt(n.slice(prefix.length), 10))
      .filter((n) => Number.isFinite(n));
    const next = (used.length ? Math.max(...used) : 0) + 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  /* ── options, bom, results, audit ── */

  async getOptions(designId: string): Promise<StoredOption[]> {
    return this.clone(this.db.options.filter((o) => o.designId === designId));
  }

  async replaceOptions(designId: string, options: StoredOption[]): Promise<void> {
    return this.write(() => {
      this.db.options = this.db.options.filter((o) => o.designId !== designId).concat(options);
    });
  }

  async getBom(designId: string): Promise<BomLine[]> {
    return this.clone(this.db.bom.filter((b) => b.designId === designId));
  }

  async replaceBom(designId: string, lines: BomLine[]): Promise<void> {
    return this.write(() => {
      this.db.bom = this.db.bom.filter((b) => b.designId !== designId).concat(lines);
    });
  }

  async listResults(designId: string): Promise<ManufacturedResult[]> {
    return this.clone(this.db.results.filter((r) => r.designId === designId));
  }

  async addResult(result: ManufacturedResult): Promise<void> {
    return this.write(() => { this.db.results.push(result); });
  }

  async deleteResult(id: string): Promise<void> {
    return this.write(() => {
      this.db.results = this.db.results.filter((r) => r.id !== id);
    });
  }

  async audit(entry: AuditEntry): Promise<void> {
    return this.write(() => { this.db.audit.push(entry); });
  }

  async listAudit(entityId: string): Promise<AuditEntry[]> {
    return this.clone(
      this.db.audit.filter((a) => a.entityId === entityId).sort((a, b) => a.at.localeCompare(b.at)),
    );
  }
}

export function defaultSettingRows(): SettingRow[] {
  return SETTING_META.map((m) => ({
    key: m.key,
    value: DEFAULT_SETTINGS[m.key] as number | boolean,
    unit: m.unit,
    label: m.label,
    isConfirmed: m.isConfirmed,
    sourceNote: m.sourceNote,
    updatedBy: null,
    updatedAt: null,
  }));
}
