import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { hasPermission } from '../auth/permissions';
import { maskPhone, toEnumName } from '../common/util';

type Actor = { sub: string; role: string; name?: string };

const OUTCOME_TO_STATUS: Record<string, string> = {
  TRANSFERRED: 'QUALIFIED',
  NOT_INTERESTED: 'CLOSED',
};
const NON_SHUFFLABLE = ['CONTACTED', 'QUALIFIED', 'CLOSED'];

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private serialize(lead: any, actor: Actor) {
    const full = hasPermission(actor.role, 'fullPhone');
    return { ...lead, phone: full ? lead.phone : maskPhone(lead.phone) };
  }

  private scopeFilter(actor: Actor) {
    return hasPermission(actor.role, 'viewAll') ? {} : { assignedToId: actor.sub };
  }

  async list(actor: Actor, q: { search?: string; status?: string; take?: string; skip?: string }) {
    const status = toEnumName(q.status);
    const where: any = {
      ...this.scopeFilter(actor),
      ...(status ? { status } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: { assignedTo: { select: { id: true, name: true } }, comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(q.take) || 50, 200),
        skip: Number(q.skip) || 0,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items: items.map((l) => this.serialize(l, actor)), total };
  }

  /* Call-center queue: leads with no outcome yet, or marked Call Back */
  async queue(actor: Actor) {
    const items = await this.prisma.lead.findMany({
      where: { ...this.scopeFilter(actor), OR: [{ outcome: null }, { outcome: 'CALL_BACK' }] },
      include: { comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return { items: items.map((l) => this.serialize(l, actor)), total: items.length };
  }

  async update(actor: Actor, id: string, patch: { name?: string; email?: string; country?: string; source?: string; status?: string; assignedToId?: string }) {
    const data: any = {};
    for (const k of ['name', 'email', 'country', 'source', 'assignedToId'] as const) {
      if (patch[k] !== undefined) data[k] = patch[k];
    }
    if (patch.status !== undefined) data.status = toEnumName(patch.status);
    const lead = await this.prisma.lead.update({ where: { id }, data }).catch(() => null);
    if (!lead) throw new NotFoundException('Lead not found');
    void this.audit.log({ action: `Updated lead ${lead.name}`, actorId: actor.sub, actorName: actor.name, entity: 'lead', entityId: id });
    return this.serialize(lead, actor);
  }

  async addComment(actor: Actor, id: string, text: string) {
    if (!text?.trim()) throw new BadRequestException('Comment text required');
    const comment = await this.prisma.leadComment.create({ data: { leadId: id, authorId: actor.sub, text: text.trim() } }).catch(() => null);
    if (!comment) throw new NotFoundException('Lead not found');
    return comment;
  }

  async logCall(actor: Actor, id: string, body: { outcome: string; comment?: string }) {
    const outcome = toEnumName(body.outcome);
    if (!outcome) throw new BadRequestException('Outcome required');
    const status = OUTCOME_TO_STATUS[outcome] ?? 'CONTACTED';
    const lead = await this.prisma.lead
      .update({ where: { id }, data: { outcome: outcome as any, status: status as any, lastContact: new Date() } })
      .catch(() => null);
    if (!lead) throw new NotFoundException('Lead not found');
    if (body.comment?.trim()) {
      await this.prisma.leadComment.create({ data: { leadId: id, authorId: actor.sub, text: body.comment.trim() } });
    }
    void this.audit.log({ action: `Call logged (${outcome}) for ${lead.name}`, actorId: actor.sub, actorName: actor.name, entity: 'lead', entityId: id });
    return this.serialize(lead, actor);
  }

  async bulkImport(actor: Actor, rows: Array<{ name: string; phone?: string; email?: string; country?: string; source?: string }>) {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('rows must be a non-empty array');
    if (rows.length > 5000) throw new BadRequestException('Max 5000 rows per import');
    const users = await this.prisma.user.findMany({ where: { active: true }, select: { id: true } });
    const data = rows
      .filter((r) => r?.name)
      .map((r, i) => ({
        name: String(r.name).slice(0, 120),
        phone: String(r.phone ?? '').slice(0, 32),
        email: String(r.email ?? '').slice(0, 160),
        country: String(r.country ?? '').slice(0, 80),
        source: String(r.source ?? 'Upload').slice(0, 60),
        assignedToId: users[i % users.length]?.id,
      }));
    const result = await this.prisma.lead.createMany({ data });
    void this.audit.log({ action: `Imported ${result.count} leads`, actorId: actor.sub, actorName: actor.name, entity: 'lead' });
    return { count: result.count };
  }

  async convertToClient(actor: Actor, id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.status !== 'QUALIFIED') throw new ForbiddenException('Only Qualified leads can be converted');
    const [client] = await this.prisma.$transaction([
      this.prisma.client.create({
        data: { name: lead.name, email: lead.email, phone: lead.phone, country: lead.country, assignedToId: lead.assignedToId },
      }),
      this.prisma.lead.delete({ where: { id } }),
    ]);
    void this.audit.log({ action: `Converted lead ${lead.name} to client`, actorId: actor.sub, actorName: actor.name, entity: 'client', entityId: client.id });
    return client;
  }

  async shuffle(actor: Actor, body: { mode: 'random' | 'move'; fromUserId?: string; toUserId?: string }) {
    const movable = { status: { notIn: NON_SHUFFLABLE as any } };
    let moved = 0;
    if (body.mode === 'move') {
      if (!body.fromUserId || !body.toUserId || body.fromUserId === body.toUserId) {
        throw new BadRequestException('fromUserId and toUserId must differ');
      }
      const res = await this.prisma.lead.updateMany({ where: { ...movable, assignedToId: body.fromUserId }, data: { assignedToId: body.toUserId } });
      moved = res.count;
    } else {
      const agents = await this.prisma.user.findMany({ where: { active: true, role: { in: ['RA', 'CA', 'CM'] } }, select: { id: true } });
      if (agents.length === 0) throw new BadRequestException('No active agents to shuffle to');
      const leads = await this.prisma.lead.findMany({ where: movable, select: { id: true } });
      const shuffled = [...leads].sort(() => Math.random() - 0.5);
      await this.prisma.$transaction(
        shuffled.map((l, i) => this.prisma.lead.update({ where: { id: l.id }, data: { assignedToId: agents[i % agents.length].id } })),
      );
      moved = shuffled.length;
    }
    void this.audit.log({ action: `Shuffled ${moved} leads (${body.mode})`, actorId: actor.sub, actorName: actor.name, entity: 'lead' });
    return { moved };
  }
}
