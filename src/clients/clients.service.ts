import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { hasPermission } from '../auth/permissions';
import { maskPhone, toEnumName, toNum } from '../common/util';

type Actor = { sub: string; role: string; name?: string };

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private serialize(c: any, actor: Actor) {
    const full = hasPermission(actor.role, 'fullPhone');
    return { ...c, phone: full ? c.phone : maskPhone(c.phone), balance: toNum(c.balance), equity: toNum(c.equity) };
  }

  async list(actor: Actor, q: { search?: string; kyc?: string }) {
    const kyc = toEnumName(q.kyc);
    const where: any = {
      ...(hasPermission(actor.role, 'viewAll') ? {} : { assignedToId: actor.sub }),
      ...(kyc ? { kyc } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const items = await this.prisma.client.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true } },
        notes: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items: items.map((c) => this.serialize(c, actor)), total: items.length };
  }

  async update(actor: Actor, id: string, patch: { kyc?: string; accountType?: string; name?: string; email?: string; country?: string; assignedToId?: string }) {
    const data: any = {};
    for (const k of ['name', 'email', 'country', 'assignedToId'] as const) {
      if (patch[k] !== undefined) data[k] = patch[k];
    }
    if (patch.kyc !== undefined) data.kyc = toEnumName(patch.kyc);
    if (patch.accountType !== undefined) data.accountType = toEnumName(patch.accountType);
    /* balance & equity deliberately NOT patchable here - only transactions move money */
    const client = await this.prisma.client.update({ where: { id }, data }).catch(() => null);
    if (!client) throw new NotFoundException('Client not found');
    void this.audit.log({ action: `Updated client ${client.name}`, actorId: actor.sub, actorName: actor.name, entity: 'client', entityId: id });
    return this.serialize(client, actor);
  }

  async addNote(actor: Actor, id: string, text: string) {
    if (!text?.trim()) throw new BadRequestException('Note text required');
    const note = await this.prisma.clientNote.create({ data: { clientId: id, authorId: actor.sub, text: text.trim() } }).catch(() => null);
    if (!note) throw new NotFoundException('Client not found');
    return note;
  }
}
