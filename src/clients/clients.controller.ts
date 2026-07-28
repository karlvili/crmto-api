import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { RequirePermission } from '../auth/decorators';

@Controller('clients')
@RequirePermission('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Req() req: any, @Query() q: any) {
    return this.clients.list(req.user, q);
  }

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.clients.create(req.user, body);
  }

  @Patch(':id')
  @RequirePermission('editLeads')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.clients.update(req.user, id, body);
  }

  @Post(':id/notes')
  addNote(@Req() req: any, @Param('id') id: string, @Body() body: { text: string }) {
    return this.clients.addNote(req.user, id, body?.text);
  }
}
