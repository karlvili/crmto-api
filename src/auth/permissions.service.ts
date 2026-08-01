import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  PERMISSION_META,
  Permission,
  ROLE_LABELS,
  ROLES,
  RoleCode,
  buildEffectiveFromOverrides,
  getEffectivePermissions,
  permissionsForRole,
  setEffectivePermissions,
} from './permissions';

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.refresh();
  }

  async refresh() {
    try {
      const rows = await this.prisma.rolePermission.findMany();
      setEffectivePermissions(buildEffectiveFromOverrides(rows));
    } catch (err) {
      // Don't crash boot if migration hasn't applied yet — use code defaults.
      console.error('Failed to load role_permissions; using defaults', err);
      setEffectivePermissions(buildEffectiveFromOverrides([]));
    }
  }

  forRole(role: string) {
    return permissionsForRole(role);
  }

  matrix() {
    const effective = getEffectivePermissions();
    return {
      roles: ROLES.map((role) => ({
        role,
        label: ROLE_LABELS[role],
        permissions: effective[role] ?? {},
      })),
      permissions: ALL_PERMISSIONS.map((key) => ({
        key,
        label: PERMISSION_META[key].label,
        description: PERMISSION_META[key].description,
      })),
      defaults: DEFAULT_PERMISSIONS,
    };
  }

  /**
   * Replace overrides for the full matrix.
   * Body shape: { matrix: { RM: { upload: true, ... }, ... } }
   */
  async saveMatrix(
    actor: { sub: string; role: string; name?: string },
    body: { matrix?: Record<string, Record<string, boolean>> },
  ) {
    const incoming = body?.matrix;
    if (!incoming || typeof incoming !== 'object') {
      throw new BadRequestException('matrix required');
    }

    const next = buildEffectiveFromOverrides([]);
    for (const role of ROLES) {
      const row = incoming[role];
      if (!row || typeof row !== 'object') {
        throw new BadRequestException(`matrix.${role} required`);
      }
      for (const perm of ALL_PERMISSIONS) {
        next[role][perm] = !!row[perm];
      }
    }

    // Safety: at least one role must keep manageUsers, and the editor's role must keep it
    const anyManager = ROLES.some((r) => next[r].manageUsers);
    if (!anyManager) {
      throw new BadRequestException('At least one role must have Manage users & roles');
    }
    if (!next[actor.role as RoleCode]?.manageUsers) {
      throw new BadRequestException('You cannot remove Manage users & roles from your own role');
    }

    const writes: Array<{ role: RoleCode; permission: Permission; allowed: boolean }> = [];
    for (const role of ROLES) {
      for (const perm of ALL_PERMISSIONS) {
        const allowed = next[role][perm];
        const def = !!DEFAULT_PERMISSIONS[role][perm];
        // Only persist rows that differ from defaults (keeps table small)
        if (allowed !== def) {
          writes.push({ role, permission: perm, allowed });
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany();
      if (writes.length) {
        await tx.rolePermission.createMany({ data: writes });
      }
    });

    setEffectivePermissions(next);
    void this.audit.log({
      action: 'Updated role permissions',
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'role_permissions',
      meta: { type: 'permissions_save', overrideCount: writes.length },
    });

    return this.matrix();
  }

  async resetToDefaults(actor: { sub: string; role: string; name?: string }) {
    await this.prisma.rolePermission.deleteMany();
    setEffectivePermissions(buildEffectiveFromOverrides([]));
    void this.audit.log({
      action: 'Reset role permissions to defaults',
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'role_permissions',
      meta: { type: 'permissions_reset' },
    });
    return this.matrix();
  }
}
