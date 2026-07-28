import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';

/** Ensures demo users exist (upsert) so production login works after first deploy. */
@Injectable()
export class SeedOnBootService implements OnModuleInit {
  private readonly log = new Logger(SeedOnBootService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (process.env.AUTO_SEED === 'false') return;

    const users = [
      { username: 'admin', password: 'admin123', name: 'Sarah Chen', role: 'RM' as const },
      { username: 'ragent', password: 'pass123', name: 'Marcus Webb', role: 'RA' as const },
      { username: 'cmgr', password: 'pass123', name: 'Diana Kovac', role: 'CM' as const },
      { username: 'cagent', password: 'pass123', name: 'Leo Tanaka', role: 'CA' as const },
    ];

    this.log.log('Ensuring demo users exist');
    for (const u of users) {
      const password = await bcrypt.hash(u.password, 10);
      await this.prisma.user.upsert({
        where: { username: u.username },
        update: { password, active: true, name: u.name, role: u.role },
        create: { username: u.username, password, name: u.name, role: u.role },
      });
    }
    this.log.log('Demo users ready (admin / admin123)');
  }
}
