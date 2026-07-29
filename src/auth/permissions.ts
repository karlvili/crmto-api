/* Server-side permission map - single source of truth for RBAC.
   The frontend copy is for UI hiding only; THIS one is enforced. */
export const PERMISSIONS: Record<string, Record<string, boolean>> = {
  RM: { upload: true, manageUsers: true, viewAll: true, export: true, fullPhone: true, editLeads: true, leadsList: true, clients: true, finance: true, financeApprove: true, affiliates: true },
  RA: { fullPhone: true, editLeads: true, leadsList: true, clients: true, finance: true },
  CM: { viewAll: true, fullPhone: true, editLeads: true, shuffle: true, leadsList: true, clients: true, finance: true, financeApprove: true, affiliates: true },
  // leadsList: agents open assigned leads from the list (Call Center removed)
  CA: { leadsList: true },
};

export type Permission =
  | 'upload' | 'manageUsers' | 'viewAll' | 'export' | 'fullPhone' | 'editLeads'
  | 'shuffle' | 'leadsList' | 'clients' | 'finance' | 'financeApprove' | 'affiliates';

export const hasPermission = (role: string, perm: Permission): boolean =>
  !!PERMISSIONS[role]?.[perm];
