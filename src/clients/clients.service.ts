import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { hasPermission } from '../auth/permissions';
import { maskPhone, toEnumName, toNum } from '../common/util';

type Actor = { sub: string; role: string; name?: string };

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private serializeKycDoc(d: any) {
    return {
      id: d.id,
      type: d.type,
      originalName: d.originalName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  private serialize(c: any, actor: Actor) {
    const full = hasPermission(actor.role, 'fullPhone');
    const { password: _pw, kycDocuments, ...rest } = c;
    return {
      ...rest,
      phone: full ? c.phone : maskPhone(c.phone),
      balance: toNum(c.balance),
      equity: toNum(c.equity),
      hasPortalLogin: !!c.password,
      platformName: c.platform?.name ?? null,
      platformHost: c.platform?.host ?? c.registeredHost ?? '',
      kycDocuments: Array.isArray(kycDocuments) ? kycDocuments.map((d) => this.serializeKycDoc(d)) : [],
    };
  }

  private async assertClientAccess(actor: Actor, id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      select: { id: true, assignedToId: true, name: true, kyc: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    if (!hasPermission(actor.role, 'viewAll') && client.assignedToId !== actor.sub) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  async create(
    actor: Actor,
    body: { name?: string; email?: string; phone?: string; country?: string; kyc?: string; accountType?: string; assignedToId?: string },
  ) {
    if (!body?.name?.trim()) throw new BadRequestException('name required');
    const client = await this.prisma.client.create({
      data: {
        name: body.name.trim(),
        email: (body.email ?? '').trim(),
        phone: (body.phone ?? '').trim(),
        country: (body.country ?? '').trim(),
        kyc: (toEnumName(body.kyc) as any) || 'PENDING',
        accountType: (toEnumName(body.accountType) as any) || 'STANDARD',
        assignedToId: body.assignedToId || actor.sub,
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
        platform: { select: { id: true, name: true, host: true } },
        notes: true,
        kycDocuments: {
          select: { id: true, type: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    void this.audit.log({
      action: `Created client ${client.name}`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'client',
      entityId: client.id,
    });
    return this.serialize(client, actor);
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
        platform: { select: { id: true, name: true, host: true } },
        notes: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
        kycDocuments: {
          select: { id: true, type: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items: items.map((c) => this.serialize(c, actor)), total: items.length };
  }

  async update(actor: Actor, id: string, patch: { kyc?: string; accountType?: string; name?: string; email?: string; country?: string; assignedToId?: string }) {
    await this.assertClientAccess(actor, id);
    const data: any = {};
    for (const k of ['name', 'email', 'country', 'assignedToId'] as const) {
      if (patch[k] !== undefined) data[k] = patch[k];
    }
    if (patch.kyc !== undefined) data.kyc = toEnumName(patch.kyc);
    if (patch.accountType !== undefined) data.accountType = toEnumName(patch.accountType);
    /* balance & equity deliberately NOT patchable here - only transactions move money */
    const client = await this.prisma.client
      .update({
        where: { id },
        data,
        include: {
          assignedTo: { select: { id: true, name: true } },
          platform: { select: { id: true, name: true, host: true } },
          notes: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
          kycDocuments: {
            select: { id: true, type: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
      .catch(() => null);
    if (!client) throw new NotFoundException('Client not found');
    void this.audit.log({ action: `Updated client ${client.name}`, actorId: actor.sub, actorName: actor.name, entity: 'client', entityId: id });
    return this.serialize(client, actor);
  }

  async addNote(actor: Actor, id: string, text: string) {
    if (!text?.trim()) throw new BadRequestException('Note text required');
    await this.assertClientAccess(actor, id);
    const note = await this.prisma.clientNote.create({ data: { clientId: id, authorId: actor.sub, text: text.trim() } }).catch(() => null);
    if (!note) throw new NotFoundException('Client not found');
    return note;
  }

  async listKycDocuments(actor: Actor, id: string) {
    await this.assertClientAccess(actor, id);
    const items = await this.prisma.kycDocument.findMany({
      where: { clientId: id },
      select: { id: true, type: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return { items: items.map((d) => this.serializeKycDoc(d)) };
  }

  async getKycDocumentFile(actor: Actor, clientId: string, docId: string) {
    await this.assertClientAccess(actor, clientId);
    const doc = await this.prisma.kycDocument.findFirst({
      where: { id: docId, clientId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async decideKyc(actor: Actor, id: string, approve: boolean) {
    const existing = await this.assertClientAccess(actor, id);
    const kyc = approve ? 'VERIFIED' : 'REJECTED';
    const client = await this.prisma.client.update({
      where: { id },
      data: { kyc },
      include: {
        assignedTo: { select: { id: true, name: true } },
        platform: { select: { id: true, name: true, host: true } },
        notes: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
        kycDocuments: {
          select: { id: true, type: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    void this.audit.log({
      action: `${approve ? 'Approved' : 'Rejected'} KYC for ${existing.name}`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'client',
      entityId: id,
      meta: { type: 'kyc_decide', approve },
    });
    return this.serialize(client, actor);
  }
}
