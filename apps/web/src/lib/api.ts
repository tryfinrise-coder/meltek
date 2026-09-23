import type { EngineeringSpec } from '@meltek/engine';
import type { ProcessSettings, ReferenceData } from '@meltek/engine';
import type { Permission, Role } from '@meltek/schema';

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

export interface Customer {
  id: string;
  name: string;
  gstin?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  /** Only present on the customers endpoint; guards deletion in the UI. */
  designCount?: number;
}

export interface ReferenceResponse extends ReferenceData {
  settings: ProcessSettings;
  settingRows: SettingRow[];
  customers: Customer[];
  storeKind: 'json' | 'postgres';
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

export interface Design {
  settingsSnapshot?: ProcessSettings | null;
  referenceSnapshot?: ReferenceData | null;
  id: string;
  designNo: string;
  revision: number;
  customerName: string;
  enquiryNo: string | null;
  poNo: string | null;
  prdNo: string | null;
  quantity: number | null;
  requiredBy: string | null;
  insulationType: string | null;
  inputs: StoredDesignInputs;
  status: 'draft' | 'calculated' | 'approved' | 'in_production' | 'superseded' | 'archived';
  selectedOptionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  supersededById: string | null;
  supersedesId: string | null;
}

export interface SimilarDesign {
  design: Design;
  score: number;
  matches: string[];
}

export interface AuditEntry {
  id: string;
  action: string;
  actor: string;
  before: unknown;
  after: unknown;
  at: string;
}

export interface BomLine {
  id: string;
  itemType: string;
  itemRef: string | null;
  description: string;
  quantity: number;
  unit: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly issues: { path: string; message: string }[];
  /** Set for the cases the UI handles specially, e.g. a blocked delete. */
  readonly code?: string;
  constructor(
    status: number,
    message: string,
    issues: { path: string; message: string }[] = [],
    code?: string,
  ) {
    super(message);
    this.status = status;
    this.issues = issues;
    if (code) this.code = code;
  }
}

/** For 204 responses, where there is no body to parse. */
async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(res.status, body.error ?? `The request failed (${res.status}).`, [], body.code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    // The session cookie identifies the caller. The audit log takes the actor from it
    // server-side, so there is nothing here a client could set to claim another name.
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string; issues?: { path: string; message: string }[]; code?: string;
    };
    throw new ApiError(res.status, body.error ?? `The request failed (${res.status}).`, body.issues ?? [], body.code);
  }
  return (await res.json()) as T;
}

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  /** The built-in administrator: cannot be deleted, demoted or disabled. */
  isProtected: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
}

export const api = {
  /* ── session ── */

  session: () =>
    request<{ needsSetup: boolean; user: AccountUser | null; permissions: Permission[] }>(
      '/auth/session',
    ),

  login: (body: { email: string; password: string }) =>
    request<{ user: AccountUser }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  setup: (body: { name: string; email: string; password: string }) =>
    request<{ user: AccountUser }>('/auth/setup', { method: 'POST', body: JSON.stringify(body) }),

  logout: () => requestVoid('/auth/logout', { method: 'POST' }),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true }>('/auth/password', { method: 'POST', body: JSON.stringify(body) }),

  /* ── accounts ── */

  users: () => request<AccountUser[]>('/users'),

  createUser: (body: unknown) =>
    request<AccountUser>('/users', { method: 'POST', body: JSON.stringify(body) }),

  updateUser: (id: string, body: unknown) =>
    request<AccountUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteUser: (id: string) => requestVoid(`/users/${id}`, { method: 'DELETE' }),

  reference: () => request<ReferenceResponse>('/reference'),

  designs: (query: Record<string, string | number | undefined> = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    const qs = params.toString();
    return request<{ designs: Design[]; similar: SimilarDesign[] }>(`/designs${qs ? `?${qs}` : ''}`);
  },

  similar: (inputs: Partial<StoredDesignInputs>) =>
    request<{ designs: Design[]; similar: SimilarDesign[] }>(
      `/designs?limit=0&similarTo=${encodeURIComponent(JSON.stringify(inputs))}`,
    ),

  design: (id: string) =>
    request<{ design: Design; options: StoredOptionDto[]; bom: BomLine[]; results: unknown[]; history: AuditEntry[] }>(
      `/designs/${id}`,
    ),

  createDesign: (body: unknown) => request<Design>('/designs', { method: 'POST', body: JSON.stringify(body) }),

  patchDesign: (id: string, body: unknown) =>
    request<Design>(`/designs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  calculateDesign: (id: string) =>
    request<{ design: Design; options: StoredOptionDto[] }>(`/designs/${id}/calculate`, { method: 'POST' }),

  selectOption: (id: string, optionId: string) =>
    request<{ design: Design; options: StoredOptionDto[] }>(`/designs/${id}/select`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    }),

  // The approver is the signed-in account; the server does not accept a name.
  approve: (id: string) => request<Design>(`/designs/${id}/approve`, { method: 'POST', body: '{}' }),

  revise: (id: string) => request<Design>(`/designs/${id}/revise`, { method: 'POST' }),

  duplicateDesign: (id: string) => request<Design>(`/designs/${id}/duplicate`, { method: 'POST' }),

  archiveDesign: (id: string) => request<Design>(`/designs/${id}/archive`, { method: 'POST' }),

  restoreDesign: (id: string) => request<Design>(`/designs/${id}/restore`, { method: 'POST' }),

  deleteDesign: (id: string) => requestVoid(`/designs/${id}`, { method: 'DELETE' }),

  customers: () => request<Customer[]>('/customers'),

  updateCustomer: (id: string, body: unknown) =>
    request<Customer>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteCustomer: (id: string) => requestVoid(`/customers/${id}`, { method: 'DELETE' }),

  deleteGrade: (code: string) =>
    request<ReferenceData>(`/reference/grades/${encodeURIComponent(code)}`, { method: 'DELETE' }),

  deleteGauge: (swg: number) =>
    request<ReferenceData>(`/reference/gauges/${swg}`, { method: 'DELETE' }),

  saveGrade: (code: string, body: unknown) =>
    request<ReferenceData>(`/reference/grades/${encodeURIComponent(code)}`, { method: 'PUT', body: JSON.stringify(body) }),

  saveGauge: (swg: number, body: unknown) =>
    request<ReferenceData>(`/reference/gauges/${swg}`, { method: 'PUT', body: JSON.stringify(body) }),

  saveDies: (dies: unknown[]) =>
    request<ReferenceData>('/reference/dies', { method: 'PUT', body: JSON.stringify(dies) }),

  saveSlitWidths: (widths: number[]) =>
    request<ReferenceData>('/reference/slit-widths', { method: 'PUT', body: JSON.stringify({ widths }) }),

  saveCopperRate: (copperRatePerKg: number) =>
    request<ReferenceData>('/reference/rates', { method: 'PUT', body: JSON.stringify({ copperRatePerKg }) }),

  saveSetting: (key: string, value: number | boolean) =>
    request<{ settings: ProcessSettings; settingRows: SettingRow[] }>(`/reference/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
};

/** A stored option as the API returns it - a RankedOption plus its row identity. */
export interface StoredOptionDto {
  id: string;
  designId: string;
  gradeCode: string;
  gradeLabel: string;
  swg: number;
  bRawT: number;
  bUsedT: number;
  wasCapped: boolean;
  coreAreaCm2: number;
  coreWidthMm: number;
  orderedWidthMm: number;
  wireLengthM: number;
  coreWeightKg: number;
  copperWeightKg: number;
  coreCost: number | null;
  copperCost: number;
  totalCost: number | null;
  dieNo: string | null;
  isFeasible: boolean;
  infeasibleReasons: string[];
  isSelected: boolean;
  rank: number | null;
}
