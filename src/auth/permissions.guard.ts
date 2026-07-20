import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './decorators';
import { hasPermission, Permission } from './permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true; // route needs auth only, no specific permission

    const { user } = ctx.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('No authenticated user');
    if (!hasPermission(user.role, required)) {
      throw new ForbiddenException(`Role ${user.role} lacks permission: ${required}`);
    }
    return true;
  }
}
