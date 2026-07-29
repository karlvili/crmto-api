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

const OUTCOME_LABEL: Record<string, string> = {
  NO_ANSWER: 'No Answer',
  VOICEMAIL: 'VoiceMail',
  CALL_BACK: 'Call Back',
  NOT_INTERESTED: 'Not Interested',
  WRONG_NUMBER: 'Wrong Number',
  NOT_REACHABLE: 'Not Reachable',
  TRANSFERRED: 'Transferred',
  LANGUAGE_BARRIER: 'Language Barrier',
};

const STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  CLOSED: 'Closed',
};

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

  private leadInclude = {
    assignedTo: { select: { id: true, name: true } },
    comments: { orderBy: { createdAt: 'asc' as const }, include: { author: { select: { name: true } } } },
    convertedClient: { select: { id: true, name: true, balance: true } },
  };

  private async getScopedLead(actor: Actor, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, ...this.scopeFilter(actor) },
      include: this.leadInclude,
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
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
        include: this.leadInclude,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(Number(q.take) || 50, 1), 2000),
        skip: Math.max(Number(q.skip) || 0, 0),
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items: items.map((l) => this.serialize(l, actor)), total };
  }

  async getOne(actor: Actor, id: string) {
    const lead = await this.getScopedLead(actor, id);
    return this.serialize(lead, actor);
  }

  /* Legacy queue endpoint kept for compatibility */
  async queue(actor: Actor) {
    const items = await this.prisma.lead.findMany({
      where: { ...this.scopeFilter(actor), OR: [{ outcome: null }, { outcome: 'CALL_BACK' }] },
      include: this.leadInclude,
      orderBy: { createdAt: 'asc' },
    });
    return { items: items.map((l) => this.serialize(l, actor)), total: items.length };
  }

  async activity(actor: Actor, id: string) {
    const lead = await this.getScopedLead(actor, id);
    const events: Array<{
      id: string;
      type: string;
      title: string;
      detail?: string;
      by?: string;
      at: string;
      meta?: Record<string, unknown>;
    }> = [];

    events.push({
      id: `created-${lead.id}`,
      type: 'created',
      title: 'Lead created',
      detail: lead.source ? `Source: ${lead.source}` : undefined,
      at: lead.createdAt.toISOString(),
    });

    const [audits, comments, txs] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entity: 'lead', entityId: id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      this.prisma.leadComment.findMany({
        where: { leadId: id },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      lead.convertedClientId
        ? this.prisma.transaction.findMany({
            where: { clientId: lead.convertedClientId },
            include: {
              broughtBy: { select: { name: true } },
              requestedBy: { select: { name: true } },
              decidedBy: { select: { name: true } },
            },
            orderBy: { requestedAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    for (const a of audits) {
      const meta = (a.meta || {}) as Record<string, any>;
      const type = typeof meta.type === 'string' ? meta.type : 'audit';
      if (type === 'comment') continue; // comments rendered from LeadComment
      let title = a.action;
      let detail: string | undefined;
      if (type === 'call' && meta.outcome) {
        title = `Call · ${OUTCOME_LABEL[meta.outcome] || meta.outcome}`;
        detail = meta.status ? `Status set to ${STATUS_LABEL[meta.status] || meta.status}` : undefined;
      } else if (type === 'assign') {
        title = meta.toName ? `Assigned to ${meta.toName}` : 'Lead reassigned';
        detail = meta.fromName ? `Previously: ${meta.fromName}` : undefined;
      } else if (type === 'status') {
        title = `Status → ${STATUS_LABEL[meta.to] || meta.to || 'updated'}`;
      } else if (type === 'convert') {
        title = 'Converted to client';
      } else if (type === 'deposit' || type === 'withdrawal') {
        title = a.action;
      }
      events.push({
        id: `audit-${a.id}`,
        type,
        title,
        detail,
        by: a.actorName || undefined,
        at: a.createdAt.toISOString(),
        meta,
      });
    }

    for (const c of comments) {
      events.push({
        id: `comment-${c.id}`,
        type: 'comment',
        title: 'Comment',
        detail: c.text,
        by: c.author?.name || undefined,
        at: c.createdAt.toISOString(),
      });
    }

    for (const t of txs) {
      const amount = Number(t.amount);
      const kind = t.kind === 'DEPOSIT' ? 'deposit' : 'withdrawal';
      const status = t.status === 'APPROVED' ? 'Approved' : t.status === 'REJECTED' ? 'Rejected' : 'Pending';
      events.push({
        id: `tx-${t.id}`,
        type: kind,
        title: `${t.kind === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'} · $${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
        detail: `${status}${t.broughtBy?.name ? ` · by ${t.broughtBy.name}` : ''}${t.method ? ` · ${String(t.method).replace(/_/g, ' ')}` : ''}`,
        by: t.requestedBy?.name || t.decidedBy?.name || undefined,
        at: (t.decidedAt || t.requestedAt).toISOString(),
        meta: { status: t.status, amount, method: t.method, kind: t.kind },
      });
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { items: events };
  }

  async update(
    actor: Actor,
    id: string,
    patch: { name?: string; email?: string; country?: string; source?: string; status?: string; assignedToId?: string },
  ) {
    const existing = await this.getScopedLead(actor, id);
    const data: any = {};
    for (const k of ['name', 'email', 'country', 'source', 'assignedToId'] as const) {
      if (patch[k] !== undefined) data[k] = patch[k];
    }
    if (patch.status !== undefined) data.status = toEnumName(patch.status);

    let assigneeName: string | undefined;
    if (data.assignedToId) {
      const u = await this.prisma.user.findUnique({ where: { id: data.assignedToId }, select: { name: true } });
      assigneeName = u?.name;
    }

    const lead = await this.prisma.lead.update({
      where: { id },
      data,
      include: this.leadInclude,
    });

    if (data.assignedToId !== undefined && data.assignedToId !== existing.assignedToId) {
      void this.audit.log({
        action: `Assigned lead ${lead.name} to ${assigneeName || 'agent'}`,
        actorId: actor.sub,
        actorName: actor.name,
        entity: 'lead',
        entityId: id,
        meta: {
          type: 'assign',
          from: existing.assignedToId,
          fromName: existing.assignedTo?.name ?? undefined,
          to: data.assignedToId,
          toName: assigneeName,
        },
      });
    } else if (data.status && data.status !== existing.status) {
      void this.audit.log({
        action: `Updated status of ${lead.name} to ${STATUS_LABEL[data.status] || data.status}`,
        actorId: actor.sub,
        actorName: actor.name,
        entity: 'lead',
        entityId: id,
        meta: { type: 'status', from: existing.status, to: data.status },
      });
    } else {
      void this.audit.log({
        action: `Updated lead ${lead.name}`,
        actorId: actor.sub,
        actorName: actor.name,
        entity: 'lead',
        entityId: id,
        meta: { type: 'update' },
      });
    }

    return this.serialize(lead, actor);
  }

  async bulkAssign(actor: Actor, ids: string[] | undefined, assignedToId: string | undefined) {
    if (!hasPermission(actor.role, 'viewAll')) throw new ForbiddenException('Not allowed');
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('ids required');
    if (!assignedToId) throw new BadRequestException('assignedToId required');
    if (ids.length > 500) throw new BadRequestException('Max 500 leads per assign');

    const agent = await this.prisma.user.findFirst({ where: { id: assignedToId, active: true } });
    if (!agent) throw new BadRequestException('Assignee not found or inactive');

    const unique = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
    const result = await this.prisma.lead.updateMany({
      where: { id: { in: unique } },
      data: { assignedToId: agent.id },
    });

    await this.prisma.auditLog.createMany({
      data: unique.map((entityId) => ({
        action: `Assigned lead to ${agent.name}`,
        actorId: actor.sub,
        actorName: actor.name || '',
        entity: 'lead',
        entityId,
        meta: { type: 'assign', to: agent.id, toName: agent.name },
      })),
    }).catch(() => undefined);

    void this.audit.log({
      action: `Bulk assigned ${result.count} leads to ${agent.name}`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'lead',
      meta: { type: 'bulk_assign', count: result.count, to: agent.id, toName: agent.name },
    });

    return { count: result.count, assignedToId: agent.id, assignedToName: agent.name };
  }

  async addComment(actor: Actor, id: string, text: string) {
    if (!text?.trim()) throw new BadRequestException('Comment text required');
    await this.getScopedLead(actor, id);
    const comment = await this.prisma.leadComment.create({
      data: { leadId: id, authorId: actor.sub, text: text.trim() },
      include: { author: { select: { name: true } } },
    });
    return comment;
  }

  async logCall(actor: Actor, id: string, body: { outcome: string; comment?: string }) {
    await this.getScopedLead(actor, id);
    const outcome = toEnumName(body.outcome);
    if (!outcome) throw new BadRequestException('Outcome required');
    const status = OUTCOME_TO_STATUS[outcome] ?? 'CONTACTED';
    const lead = await this.prisma.lead.update({
      where: { id },
      data: { outcome: outcome as any, status: status as any, lastContact: new Date() },
      include: this.leadInclude,
    });
    if (body.comment?.trim()) {
      await this.prisma.leadComment.create({ data: { leadId: id, authorId: actor.sub, text: body.comment.trim() } });
    }
    void this.audit.log({
      action: `Call logged (${OUTCOME_LABEL[outcome] || outcome}) for ${lead.name}`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'lead',
      entityId: id,
      meta: { type: 'call', outcome, status },
    });
    return this.serialize(lead, actor);
  }

  async bulkImport(
    actor: Actor,
    rows: Array<{ name: string; phone?: string; email?: string; country?: string; source?: string; comment?: string }>,
  ) {
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('rows must be a non-empty array');
    if (rows.length > 5000) throw new BadRequestException('Max 5000 rows per import');

    const clean = (v: unknown, max: number) => {
      if (v == null) return '';
      const s = String(v).replace(/\u0000/g, '').trim();
      return s.slice(0, max);
    };

    const users = await this.prisma.user.findMany({ where: { active: true }, select: { id: true } });
    const assigneeIds = users.map((u) => u.id);
    const fallbackAssignee = actor.sub;

    const prepared = rows
      .map((r, i) => {
        const name = clean(r?.name, 120);
        if (!name) return null;
        return {
          lead: {
            name,
            phone: clean(r?.phone, 32),
            email: clean(r?.email, 160),
            country: clean(r?.country, 80),
            source: clean(r?.source, 60) || 'Upload',
            assignedToId: assigneeIds.length ? assigneeIds[i % assigneeIds.length] : fallbackAssignee,
          },
          comment: clean(r?.comment, 2000),
        };
      })
      .filter(Boolean) as Array<{
      lead: {
        name: string;
        phone: string;
        email: string;
        country: string;
        source: string;
        assignedToId: string;
      };
      comment: string;
    }>;

    if (prepared.length === 0) throw new BadRequestException('No valid rows with a name to import');

    let count = 0;
    const chunkSize = 250;
    try {
      for (let i = 0; i < prepared.length; i += chunkSize) {
        const chunk = prepared.slice(i, i + chunkSize);
        const created = await this.prisma.lead.createManyAndReturn({
          data: chunk.map((c) => c.lead),
        });
        count += created.length;
        const commentRows = created
          .map((lead, j) => {
            const text = chunk[j]?.comment;
            if (!text) return null;
            return { leadId: lead.id, authorId: actor.sub, text };
          })
          .filter(Boolean) as Array<{ leadId: string; authorId: string; text: string }>;
        if (commentRows.length) {
          await this.prisma.leadComment.createMany({ data: commentRows });
        }
      }
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'Import failed while saving leads');
    }

    void this.audit.log({
      action: `Imported ${count} leads`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'lead',
    });
    return { count };
  }

  async remove(actor: Actor, id: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, ...this.scopeFilter(actor) } });
    if (!lead) throw new NotFoundException('Lead not found');
    await this.prisma.lead.delete({ where: { id } });
    void this.audit.log({
      action: `Deleted lead ${lead.name}`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'lead',
      entityId: id,
    });
    return { id, deleted: true };
  }

  async bulkDelete(actor: Actor, ids: string[] | undefined) {
    if (!Array.isArray(ids) || ids.length === 0) throw new BadRequestException('ids required');
    if (ids.length > 500) throw new BadRequestException('Max 500 leads per delete');
    const unique = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
    const result = await this.prisma.lead.deleteMany({
      where: { id: { in: unique }, ...this.scopeFilter(actor) },
    });
    void this.audit.log({
      action: `Deleted ${result.count} leads`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'lead',
    });
    return { count: result.count };
  }

  async convertToClient(actor: Actor, id: string) {
    const lead = await this.getScopedLead(actor, id);
    if (lead.convertedClientId) throw new BadRequestException('Lead already converted');
    if (lead.status !== 'QUALIFIED') throw new ForbiddenException('Only Qualified leads can be converted');

    const client = await this.prisma.client.create({
      data: {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        country: lead.country,
        assignedToId: lead.assignedToId,
      },
    });
    const updated = await this.prisma.lead.update({
      where: { id },
      data: { convertedClientId: client.id, status: 'CLOSED' },
      include: this.leadInclude,
    });

    void this.audit.log({
      action: `Converted lead ${lead.name} to client`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'lead',
      entityId: id,
      meta: { type: 'convert', clientId: client.id },
    });
    void this.audit.log({
      action: `Converted lead ${lead.name} to client`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'client',
      entityId: client.id,
      meta: { type: 'convert', leadId: id },
    });
    return { client, lead: this.serialize(updated, actor) };
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
