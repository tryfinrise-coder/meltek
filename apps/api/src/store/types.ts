import type { EngineeringSpec } from '@meltek/engine';
import type {
  Die, ProcessSettings, RankedOption, ReferenceData, SteelGrade, WireGauge,
} from '@meltek/engine';
import type { Role } from '@meltek/schema';

export interface User {
  id: string;
  name: string;
  /** Stored lowercase; it is the sign-in identifier. */
  email: string;
  role: Role;
  isActive: boolean;
  /**
   * The built-in administrator, recreated at boot if it is ever missing.
   * It cannot be deleted, demoted or disabled, so the works can always get back in.
   * Its password can and should be changed.
   */
  isProtected: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
}

/** A user plus the credential. Never leaves the store layer. */
export interface UserWithSecret extends User {
  passwordHash: string;
}

export interface Session {
  /** SHA-256 of the token. The token itself is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
}

export interface Customer {
  id: string;
  name: string;
  gstin: string | null;
  contactName: string | null;
  contactEmail: string | null;
  phone: string | null;
  createdAt: string;
}

export interface StoredDesignInputs {
  engineering?: EngineeringSpec | null;
  primaryCurrent: number;
  secondaryCurrent: number;
  burdenVA: number;
  accuracyClass: string;
  finishedIdMm: number;
  finishedOdMm: number;
  ctType: 'ring' | 'wound-primary';
  maxWidthMm: number | null;
}

export type DesignStatus =
  | 'draft'
  | 'calculated'
  | 'approved'
  | 'in_production'
  | 'superseded'
  /** Kept on record but out of the way. Approved work is archived, never deleted. */
  | 'archived';

export interface Design {
  id: string;
  designNo: string;
  revision: number;
  customerId: string | null;
  customerName: string;
  enquiryNo: string | null;
  poNo: string | null;
  prdNo: string | null;
  quantity: number | null;
  requiredBy: string | null;
  insulationType: string | null;
  inputs: StoredDesignInputs;
  /** §3.3 - frozen on approval so historical costings never drift. */
  settingsSnapshot: ProcessSettings | null;
  referenceSnapshot: ReferenceData | null;
  status: DesignStatus;
  selectedOptionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  supersededById: string | null;
  supersedesId: string | null;
}

export interface StoredOption extends RankedOption {
  id: string;
  designId: string;
  isSelected: boolean;
}

export interface BomLine {
  id: string;
  designId: string;
  itemType: 'core' | 'copper' | 'insulation' | 'resin' | 'other';
  itemRef: string | null;
  description: string;
  quantity: number;
  unit: string;
}

export interface ManufacturedResult {
  id: string;
  designId: string;
  batchNo: string;
  manufacturedOn: string | null;
  actualCoreGrade: string | null;
  actualCoreWidthMm: number | null;
  actualCoreWeightKg: number | null;
  actualCopperWeightKg: number | null;
  measuredRatioErrorPct: number | null;
  measuredPhaseErrorMin: number | null;
  measuredResistanceOhm: number | null;
  testLab: string | null;
  passed: boolean;
  notes: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  before: unknown;
  after: unknown;
  at: string;
}

/** A process setting row, carrying the is_confirmed flag that drives the UI badge (§7, §12). */
export interface SettingRow {
  key: keyof ProcessSettings;
  value: number | boolean;
  unit: string;
  label: string;
  isConfirmed: boolean;
  sourceNote: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface DesignFilter {
  q?: string;
  customer?: string;
  status?: DesignStatus;
  accuracyClass?: string;
  ratio?: string;
  burdenVA?: number;
  minId?: number;
  maxOd?: number;
  limit?: number;
}

/**
 * The persistence seam. `JsonStore` is the zero-infrastructure default so the app runs
 * and hosts without a database; `PgStore` implements the same interface against the
 * PostgreSQL schema in schema.sql (§7).
 */
export interface Store {
  readonly kind: 'json' | 'postgres' | 'mysql';
  init(): Promise<void>;
  close(): Promise<void>;

  getReference(): Promise<ReferenceData>;
  saveGrade(grade: SteelGrade): Promise<void>;
  deleteGrade(code: string): Promise<void>;
  saveGauge(gauge: WireGauge): Promise<void>;
  deleteGauge(swg: number): Promise<void>;
  saveDies(dies: Die[]): Promise<void>;
  saveSlitWidths(widths: number[]): Promise<void>;
  saveCopperRate(rate: number): Promise<void>;

  getSettings(): Promise<ProcessSettings>;
  getSettingRows(): Promise<SettingRow[]>;
  saveSetting(key: keyof ProcessSettings, value: number | boolean, actor: string): Promise<void>;

  /* ── accounts ── */
  countUsers(): Promise<number>;
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<UserWithSecret | null>;
  getUserByEmail(email: string): Promise<UserWithSecret | null>;
  createUser(user: UserWithSecret): Promise<User>;
  updateUser(user: UserWithSecret): Promise<User>;
  deleteUser(id: string): Promise<void>;

  createSession(session: Session): Promise<void>;
  getSession(tokenHash: string): Promise<Session | null>;
  touchSession(tokenHash: string, expiresAt: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Used when a password changes or an account is disabled. */
  deleteSessionsForUser(userId: string): Promise<void>;
  purgeExpiredSessions(): Promise<void>;

  listCustomers(): Promise<Customer[]>;
  upsertCustomerByName(name: string): Promise<Customer>;
  getCustomer(id: string): Promise<Customer | null>;
  updateCustomer(customer: Customer): Promise<Customer>;
  deleteCustomer(id: string): Promise<void>;
  /** Guards deletion: a customer with designs against them is never removed. */
  countDesignsForCustomer(id: string): Promise<number>;

  listDesigns(filter: DesignFilter): Promise<Design[]>;
  getDesign(id: string): Promise<Design | null>;
  createDesign(design: Design): Promise<Design>;
  updateDesign(design: Design): Promise<Design>;
  deleteDesign(id: string): Promise<void>;
  nextDesignNo(): Promise<string>;

  getOptions(designId: string): Promise<StoredOption[]>;
  replaceOptions(designId: string, options: StoredOption[]): Promise<void>;

  getBom(designId: string): Promise<BomLine[]>;
  replaceBom(designId: string, lines: BomLine[]): Promise<void>;

  listResults(designId: string): Promise<ManufacturedResult[]>;
  addResult(result: ManufacturedResult): Promise<void>;
  deleteResult(id: string): Promise<void>;

  audit(entry: AuditEntry): Promise<void>;
  listAudit(entityId: string): Promise<AuditEntry[]>;
}
