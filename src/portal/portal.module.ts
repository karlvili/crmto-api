import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { PortalAuthGuard } from './portal-auth.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [PortalController],
  providers: [PortalService, PortalAuthGuard],
})
export class PortalModule {}
