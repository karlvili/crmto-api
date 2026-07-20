import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { hasPermission } from '../auth/permissions';
import { maskPhone } from '../common/util';

type Actor = { sub: string; role: string; name?: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newApiKey = () => 'ak_' + randomBytes(16).toString('hex');

@Injectable()
export class AffiliatesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list() {
    const items = await this.prisma.affiliate.findMany({
      include: { _count: { select: { leads: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const accepted = await this.prisma.affiliateLead.groupBy({
      by: ['affiliateId'],
      where: { status: 'ACCEPTED' },
      _count: { _all: true },
    });
    const acceptedMap = new Map(accepted.map((a) => [a.affiliateId, a._count._all]));
    return {
      items: items.map((a) => ({
        id: a.id, name: a.name, code: a.code, commission: a.commission, active: a.active, createdAt: a.createdAt,
        totalLeads: a._count.leads, acceptedLeads: acceptedMap.get(a.id) ?? 0,
      })),
    };
  }

  async create(actor: Actor, body: { name: string; commission?: number }) {
    if (!body?.name?.trim()) throw new BadRequestException('Name required');
    const name = body.name.trim();
    const base = name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 3) || 'AFF';
    let code = base;
    for (let i = 2; await this.prisma.affiliate.findUnique({ where: { code } }); i++) code = `${base}${i}`;
    const rawKey = newApiKey();
    const aff = await this.prisma.affiliate.create({
      data: { name, code, commission: Math.min(Math.max(Number(body.commission) || 25, 0), 100), apiKeyHash: sha256(rawKey) },
    });
    void this.audit.log({ action: `Created affiliate ${name}`, actorId: actor.sub, actorName: actor.name, entity: 'affiliate', entityId: aff.id });
    /* rawKey returned ONCE - only the hash is stored */
    return { id: aff.id, name: aff.name, code: aff.code, commission: aff.commission, active: aff.active, apiKey: rawKey };
  }

  async update(actor: Actor, id: string, body: { active?: boolean; commission?: number; name?: string }) {
    const data: any = {};
    if (body.active !== undefined) data.active = !!body.active;
    if (body.commission !== undefined) data.commission = Math.min(Math.max(Number(body.commission) || 0, 0), 100);
    if (body.name !== undefined) data.name = String(body.name).trim();
    const aff = await this.prisma.affiliate.update({ where: { id }, data }).catch(() => null);
    if (!aff) throw new NotFoundException('Affiliate not found');
    void this.audit.log({ action: `Updated affiliate ${aff.name}`, actorId: actor.sub, actorName: actor.name, entity: 'affiliate', entityId: id });
    return { id: aff.id, name: aff.name, code: aff.code, commission: aff.commission, active: aff.active };
  }

  async rotateKey(actor: Actor, id: string) {
    const rawKey = newApiKey();
    const aff = await this.prisma.affiliate.update({ where: { id }, data: { apiKeyHash: sha256(rawKey) } }).catch(() => null);
    if (!aff) throw new NotFoundException('Affiliate not found');
    void this.audit.log({ action: `Rotated API key for ${aff.name}`, actorId: actor.sub, actorName: actor.name, entity: 'affiliate', entityId: id });
    return { id: aff.id, apiKey: rawKey };
  }

  async listLeads(actor: Actor, q: { affiliateId?: string }) {
    const full = hasPermission(actor.role, 'fullPhone');
    const items = await this.prisma.affiliateLead.findMany({
      where: q.affiliateId ? { affiliateId: q.affiliateId } : {},
      include: { affiliate: { select: { name: true } } },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    return {
      items: items.map((l) => ({
        id: l.id, affiliateId: l.affiliateId, affiliateName: l.affiliate.name,
        name: l.name, phone: full ? l.phone : maskPhone(l.phone), email: l.email, country: l.country,
        status: l.status, leadId: l.leadId, receivedAt: l.receivedAt,
      })),
    };
  }

  /* Public inbound endpoint - authenticated by X-Api-Key header, not JWT.
     Mirrors what an affiliate's server posts to us. */
  async ingest(apiKey: string | undefined, payload: { name?: string; phone?: string; email?: string; country?: string }) {
    if (!apiKey) throw new UnauthorizedException('X-Api-Key header required');
    const aff = await this.prisma.affiliate.findUnique({ where: { apiKeyHash: sha256(apiKey) } });
    if (!aff || !aff.active) throw new UnauthorizedException('Unknown or inactive affiliate key');

    const name = String(payload?.name ?? '').trim();
    const phone = String(payload?.phone ?? '').trim();
    const email = String(payload?.email ?? '').trim();
    const country = String(payload?.country ?? '').trim();

    let status: 'ACCEPTED' | 'DUPLICATE' | 'INVALID' = 'ACCEPTED';
    if (!name || !phone) status = 'INVALID';
    else if (await this.prisma.lead.findFirst({ where: { phone }, select: { id: true } })) status = 'DUPLICATE';

    let leadId: string | null = null;
    if (status === 'ACCEPTED') {
      const agents = await this.prisma.user.findMany({ where: { active: true }, select: { id: true } });
      const lead = await this.prisma.lead.create({
        data: { name, phone, email, country, source: 'Partner', assignedToId: agents[Math.floor(Math.random() * agents.length)]?.id },
      });
      leadId = lead.id;
    }

    const record = await this.prisma.affiliateLead.create({
      data: { affiliateId: aff.id, name, phone, email, country, status, leadId, rawPayload: payload as any },
    });
    void this.audit.log({ action: `Affiliate lead ${status} from ${aff.name}`, actorName: aff.name, entity: 'affiliate_lead', entityId: record.id });
    return { id: record.id, status, leadId };
  }
}
