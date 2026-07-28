import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';

/** Creates demo users once if the DB is empty (production first boot). */
@Injectable()
export class SeedOnBootService implements OnModuleInit {
  private readonly log = new Logger(SeedOnBootService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.AUTO_SEED === 'false') return;
    const count = await this.prisma.user.count();
    if (count > 0) return;

    this.log.warn('No users found — seeding demo accounts');
    const users = [
      { username: 'admin', password: 'admin123', name: 'Sarah Chen', role: 'RM' as const },
      { username: 'ragent', password: 'pass123', name: 'Marcus Webb', role: 'RA' as const },
      { username: 'cmgr', password: 'pass123', name: 'Diana Kovac', role: 'CM' as const },
      { username: 'cagent', password: 'pass123', name: 'Leo Tanaka', role: 'CA' as const },
    ];
    for (const u of users) {
      await this.prisma.user.create({
        data: { ...u, password: await bcrypt.hash(u.password, 10) },
      });
    }
    this.log.log('Demo users ready (admin / admin123)');
  }
}
