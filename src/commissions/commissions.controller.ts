import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { CommissionsService } from './commissions.service';
import { RequirePermission } from '../auth/decorators';

@Controller('commissions')
@RequirePermission('manageUsers')
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get()
  list() {
    return this.commissions.list();
  }

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.commissions.create(req.user, body);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.commissions.update(req.user, id, body);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.commissions.remove(req.user, id);
  }
}
