import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [JwtModule.register({}), CommonModule],
  controllers: [AuthController, PermissionsController],
  providers: [
    AuthService,
    PermissionsService,
    // Order matters: authenticate first, then check permissions
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PermissionsService],
})
export class AuthModule {}
