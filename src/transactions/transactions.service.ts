import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { toEnumName, toNum } from '../common/util';

type Actor = { sub: string; role: string; name?: string };

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private serialize(t: any) {
    return {
      ...t,
      amount: toNum(t.amount),
      clientName: t.client?.name,
      requestedByName: t.requestedBy?.name ?? null,
      decidedByName: t.decidedBy?.name ?? null,
      client: undefined,
      requestedBy: undefined,
      decidedBy: undefined,
    };
  }

  private include = {
    client: { select: { name: true } },
    requestedBy: { select: { name: true } },
    decidedBy: { select: { name: true } },
  };

  async list(q: { kind?: string; status?: string }) {
    const kind = toEnumName(q.kind);
    const status = toEnumName(q.status);
    const items = await this.prisma.transaction.findMany({
      where: { ...(kind ? { kind: kind as any } : {}), ...(status ? { status: status as any } : {}) },
      include: this.include,
      orderBy: { requestedAt: 'desc' },
    });
    return { items: items.map((t) => this.serialize(t)), total: items.length };
  }

  async request(actor: Actor, body: { kind: string; clientId: string; amount: number; method: string; idempotencyKey?: string }) {
    const kind = toEnumName(body.kind);
    const method = toEnumName(body.method);
    const amount = Number(body.amount);
    if (kind !== 'DEPOSIT' && kind !== 'WITHDRAWAL') throw new BadRequestException('kind must be DEPOSIT or WITHDRAWAL');
    if (!method) throw new BadRequestException('method required');
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be > 0');
    if (amount > 10_000_000) throw new BadRequestException('amount exceeds limit');

    /* Idempotency: same key returns the original transaction instead of double-creating */
    if (body.idempotencyKey) {
      const existing = await this.prisma.transaction.findUnique({ where: { idempotencyKey: body.idempotencyKey }, include: this.include });
      if (existing) return this.serialize(existing);
    }

    const client = await this.prisma.client.findUnique({ where: { id: body.clientId } });
    if (!client) throw new NotFoundException('Client not found');
    if (kind === 'WITHDRAWAL' && toNum(client.balance) < amount) throw new BadRequestException('Insufficient balance');

    const tx = await this.prisma.transaction.create({
      data: {
        kind: kind as any,
        clientId: client.id,
        amount,
        method: method as any,
        requestedById: actor.sub,
        idempotencyKey: body.idempotencyKey ?? null,
      },
      include: this.include,
    });
    void this.audit.log({ action: `${kind} requested: ${amount} for ${client.name}`, actorId: actor.sub, actorName: actor.name, entity: 'transaction', entityId: tx.id });
    return this.serialize(tx);
  }

  /* Approve/reject inside a single DB transaction:
     re-checks pending state and balance under lock, then moves money atomically. */
  async decide(actor: Actor, id: string, approve: boolean) {
    const result = await this.prisma.$transaction(async (db) => {
      const tx = await db.transaction.findUnique({ where: { id }, include: { client: true } });
      if (!tx) throw new NotFoundException('Transaction not found');
      if (tx.status !== 'PENDING') throw new ConflictException('Transaction already decided');

      const amount = toNum(tx.amount);
      let finalApprove = approve;
      let note = '';
      if (tx.kind === 'WITHDRAWAL' && approve && toNum(tx.client.balance) < amount) {
        finalApprove = false;
        note = 'Auto-rejected: insufficient balance';
      }

      if (finalApprove) {
        const delta = tx.kind === 'DEPOSIT' ? amount : -amount;
        await db.client.update({
          where: { id: tx.clientId },
          data: { balance: { increment: delta }, equity: { increment: delta } },
        });
      }

      return db.transaction.update({
        where: { id },
        data: { status: finalApprove ? 'APPROVED' : 'REJECTED', decidedById: actor.sub, decidedAt: new Date(), note },
        include: this.include,
      });
    });

    void this.audit.log({
      action: `${result.status} ${result.kind} ${toNum(result.amount)} (${(result as any).client?.name ?? result.clientId})`,
      actorId: actor.sub,
      actorName: actor.name,
      entity: 'transaction',
      entityId: id,
    });
    return this.serialize(result);
  }
}
