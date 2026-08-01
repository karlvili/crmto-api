import { Body, Controller, Get, Put, Req } from '@nestjs/common';
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
  save(
    @Req() req: any,
    @Body() body: { matrix?: Record<string, Record<string, boolean>>; reset?: boolean },
  ) {
    if (body?.reset) return this.permissions.resetToDefaults(req.user);
    return this.permissions.saveMatrix(req.user, body);
  }
}
