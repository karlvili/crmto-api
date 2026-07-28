import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SeedOnBootService } from './seed-on-boot.service';

@Global()
@Module({
  providers: [PrismaService, SeedOnBootService],
  exports: [PrismaService],
})
export class PrismaModule {}
