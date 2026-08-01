import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import { RequirePermission } from './decorators';
import { PermissionsService } from './permissions.service';

@Controller('permissions')
@RequirePermission('manageUsers')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  getMatrix() {
    return this.permissions.matrix();
  }

  @Put()
  save(@Req() req: any, @Body() body: { matrix?: Record<string, Record<string, boolean>> }) {
    return this.permissions.saveMatrix(req.user, body);
  }

  @Post('reset')
  reset(@Req() req: any) {
    return this.permissions.resetToDefaults(req.user);
  }
}
