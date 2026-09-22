export const ADMIN_TABS = ['settings', 'grades', 'gauges', 'dies', 'rates', 'customers', 'accounts'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];
export const ADMIN_LABELS: Record<AdminTab, string> = {
  settings: 'Process settings', grades: 'Steel grades', gauges: 'Wire gauges',
  dies: 'Dies & slit widths', rates: 'Rates', customers: 'Customers', accounts: 'Accounts',
};
export function parseAdminTab(value: unknown): AdminTab {
  return ADMIN_TABS.includes(value as AdminTab) ? value as AdminTab : 'settings';
}
export function validateAdminSearch(search: Record<string, unknown>): { tab?: AdminTab } {
  return search.tab === undefined ? {} : { tab: parseAdminTab(search.tab) };
}
