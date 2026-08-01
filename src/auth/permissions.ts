/* Default RBAC matrix + in-memory effective map (DB overrides applied by PermissionsService). */

export const ROLES = ['RM', 'RA', 'CM', 'CA'] as const;
export type RoleCode = (typeof ROLES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  RM: 'Retention Manager',
  RA: 'Retention Agent',
  CM: 'Conversion Manager',
  CA: 'Conversion Agent',
};

export const ALL_PERMISSIONS = [
  'upload',
  'manageUsers',
  'viewAll',
  'export',
  'fullPhone',
  'editLeads',
  'shuffle',
  'leadsList',
  'clients',
  'finance',
  'financeApprove',
  'affiliates',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_META: Record<Permission, { label: string; description: string }> = {
  upload: { label: 'Upload leads', description: 'Import leads from CSV/XLS' },
  manageUsers: { label: 'Manage users & roles', description: 'Team admin, role pay, and permission matrix' },
  viewAll: { label: 'View all records', description: 'See all leads/clients, not only assigned' },
  export: { label: 'Export leads', description: 'Download leads as CSV' },
  fullPhone: { label: 'Full phone numbers', description: 'See unmasked phone numbers' },
  editLeads: { label: 'Edit leads', description: 'Edit, assign, delete leads and review KYC' },
  shuffle: { label: 'Shuffle leads', description: 'Redistribute pending leads between agents' },
  leadsList: { label: 'Leads list', description: 'Access the leads module' },
  clients: { label: 'Clients', description: 'Access clients and convert qualified leads' },
  finance: { label: 'Finance', description: 'View deposits and withdrawals' },
  financeApprove: { label: 'Approve finance', description: 'Approve or reject transactions' },
  affiliates: { label: 'Affiliates', description: 'Manage affiliates and affiliate leads' },
};

/** Hardcoded defaults used when no DB override exists for a role+permission. */
export const DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  RM: {
    upload: true,
    manageUsers: true,
    viewAll: true,
    export: true,
    fullPhone: true,
    editLeads: true,
    shuffle: false,
    leadsList: true,
    clients: true,
    finance: true,
    financeApprove: true,
    affiliates: true,
  },
  RA: {
    upload: false,
    manageUsers: false,
    viewAll: false,
    export: false,
    fullPhone: true,
    editLeads: true,
    shuffle: false,
    leadsList: true,
    clients: true,
    finance: true,
    financeApprove: false,
    affiliates: false,
  },
  CM: {
    upload: false,
    manageUsers: false,
    viewAll: true,
    export: false,
    fullPhone: true,
    editLeads: true,
    shuffle: true,
    leadsList: true,
    clients: true,
    finance: true,
    financeApprove: true,
    affiliates: true,
  },
  CA: {
    upload: false,
    manageUsers: false,
    viewAll: false,
    export: false,
    fullPhone: false,
    editLeads: false,
    shuffle: false,
    leadsList: true,
    clients: false,
    finance: false,
    financeApprove: false,
    affiliates: false,
  },
};

/** @deprecated Use DEFAULT_PERMISSIONS or permissionsForRole — kept for older imports */
export const PERMISSIONS = DEFAULT_PERMISSIONS;

let effective: Record<string, Record<string, boolean>> = cloneDefaults();

function cloneDefaults(): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const role of ROLES) {
    out[role] = { ...DEFAULT_PERMISSIONS[role] };
  }
  return out;
}

export function setEffectivePermissions(map: Record<string, Record<string, boolean>>) {
  effective = map;
}

export function getEffectivePermissions(): Record<string, Record<string, boolean>> {
  return effective;
}

export function permissionsForRole(role: string): Record<string, boolean> {
  return effective[role] ?? DEFAULT_PERMISSIONS[role] ?? {};
}

export const hasPermission = (role: string, perm: Permission): boolean =>
  !!permissionsForRole(role)[perm];

export function buildEffectiveFromOverrides(
  overrides: Array<{ role: string; permission: string; allowed: boolean }>,
): Record<string, Record<string, boolean>> {
  const map = cloneDefaults();
  for (const row of overrides) {
    if (!ROLES.includes(row.role as RoleCode)) continue;
    if (!ALL_PERMISSIONS.includes(row.permission as Permission)) continue;
    map[row.role][row.permission] = !!row.allowed;
  }
  return map;
}
