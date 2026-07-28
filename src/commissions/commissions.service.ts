import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PERMISSIONS } from '../auth/permissions';
import { toNum } from '../common/util';

type Actor = { sub: string; role: string; name?: string };

const ROLES = Object.keys(PERMISSIONS);

@Injectable()
export class CommissionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private serialize(t: any) {
    return {
      ...t,
      minAmount: toNum(t.minAmount),
      maxAmount: t.maxAmount == null ? null : toNum(t.maxAmount),
      percent: toNum(t.percent),
    };
  }

  async list() {
    const items = await this.prisma.commissionTier.findMany({
      orderBy: [{ role: 'asc' }, { minAmount: 'asc' }],
    });
    return { items: items.map((t) => this.serialize(t)) };
  }

  async create(
    actor: Actor,
    body: { role: string; minAmount: number; maxAmount?: number | null; percent: number },
  ) {
    const role = String(body?.role || '').toUpperCase();
    if (!ROLES.includes(role)) throw new BadRequestException('Invalid role');
    const minAmount = Number(body.minAmount);
    const percent = Number(body.percent);
    const maxRaw = body.maxAmount as number | null | undefined | '';
    const maxAmount =
      maxRaw === undefined || maxRaw === null || maxRaw === ''
        ? null
        : Number(maxRaw);

    if (!Number.isFinite(minAmount) || minAmount < 0) throw new BadRequestException('minAmount must be >= 0');
    if (maxAmount != null && (!Number.isFinite(maxAmount) || maxAmount < minAmount)) {
      throw new BadRequestException('maxAmount must be >= minAmount');
    }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new BadRequestException('percent must be between 0 and 100');
    }

    await this.assertNoOverlap(role, minAmount, maxAmount, null);

    const tier = await this.prisma.commissionTier.create({
      data: { role: role as any, minAmount, maxAmount, percent },
    });
    void this.audit.log({
      action: `Created commission tier ${role} ${percent}% [${minAmount}-${maxAmount ?? '∞'}]`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'commission_tier',
      entityId: tier.id,
    });
    return this.serialize(tier);
  }

  async update(
    actor: Actor,
    id: string,
    body: { minAmount?: number; maxAmount?: number | null | string; percent?: number; active?: boolean },
  ) {
    const existing = await this.prisma.commissionTier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tier not found');

    const minAmount = body.minAmount !== undefined ? Number(body.minAmount) : toNum(existing.minAmount);
    const percent = body.percent !== undefined ? Number(body.percent) : toNum(existing.percent);
    let maxAmount: number | null;
    if (body.maxAmount === undefined) {
      maxAmount = existing.maxAmount == null ? null : toNum(existing.maxAmount);
    } else if (body.maxAmount === null || body.maxAmount === '') {
      maxAmount = null;
    } else {
      maxAmount = Number(body.maxAmount);
    }

    if (!Number.isFinite(minAmount) || minAmount < 0) throw new BadRequestException('minAmount must be >= 0');
    if (maxAmount != null && (!Number.isFinite(maxAmount) || maxAmount < minAmount)) {
      throw new BadRequestException('maxAmount must be >= minAmount');
    }
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new BadRequestException('percent must be between 0 and 100');
    }

    await this.assertNoOverlap(existing.role, minAmount, maxAmount, id);

    const tier = await this.prisma.commissionTier.update({
      where: { id },
      data: {
        minAmount,
        maxAmount,
        percent,
        ...(body.active !== undefined ? { active: !!body.active } : {}),
      },
    });
    void this.audit.log({
      action: `Updated commission tier ${tier.role}`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'commission_tier',
      entityId: id,
    });
    return this.serialize(tier);
  }

  async remove(actor: Actor, id: string) {
    const existing = await this.prisma.commissionTier.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tier not found');
    await this.prisma.commissionTier.delete({ where: { id } });
    void this.audit.log({
      action: `Deleted commission tier ${existing.role}`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'commission_tier',
      entityId: id,
    });
    return { id, deleted: true };
  }

  /** Find matching active tier for role + deposit amount. */
  async resolveForDeposit(role: string, amount: number) {
    const tiers = await this.prisma.commissionTier.findMany({
      where: { role: role as any, active: true },
      orderBy: { minAmount: 'desc' },
    });
    const match = tiers.find((t) => {
      const min = toNum(t.minAmount);
      const max = t.maxAmount == null ? null : toNum(t.maxAmount);
      return amount >= min && (max == null || amount <= max);
    });
    if (!match) return { percent: 0, amount: 0 };
    const percent = toNum(match.percent);
    return { percent, amount: Math.round(((amount * percent) / 100) * 100) / 100 };
  }

  private async assertNoOverlap(role: string, minAmount: number, maxAmount: number | null, excludeId: string | null) {
    const others = await this.prisma.commissionTier.findMany({
      where: { role: role as any, active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    const newMax = maxAmount ?? Number.POSITIVE_INFINITY;
    for (const t of others) {
      const oMin = toNum(t.minAmount);
      const oMax = t.maxAmount == null ? Number.POSITIVE_INFINITY : toNum(t.maxAmount);
      const overlaps = minAmount <= oMax && newMax >= oMin;
      if (overlaps) {
        throw new BadRequestException(
          `Range overlaps an existing ${role} tier (${oMin}–${t.maxAmount == null ? '∞' : oMax})`,
        );
      }
    }
  }
}
