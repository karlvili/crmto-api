import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /* Fire-and-forget append-only audit entry; never throws into the request path */
  log(opts: { action: string; actorId?: string; actorName?: string; entity?: string; entityId?: string; meta?: object }) {
    return this.prisma.auditLog
      .create({
        data: {
          action: opts.action,
          actorId: opts.actorId ?? null,
          actorName: opts.actorName ?? '',
          entity: opts.entity ?? '',
          entityId: opts.entityId ?? '',
          meta: opts.meta as any,
        },
      })
      .catch(() => undefined);
  }
}
