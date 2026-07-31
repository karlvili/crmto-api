import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { ClientsModule } from './clients/clients.module';
import { TransactionsModule } from './transactions/transactions.module';
import { AffiliatesModule } from './affiliates/affiliates.module';
import { CommissionsModule } from './commissions/commissions.module';
import { PortalModule } from './portal/portal.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    LeadsModule,
    ClientsModule,
    TransactionsModule,
    AffiliatesModule,
    CommissionsModule,
    PortalModule,
    HealthModule,
  ],
})
export class AppModule {}
