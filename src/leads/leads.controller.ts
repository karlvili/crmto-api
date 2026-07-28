import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { RequirePermission } from '../auth/decorators';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermission('leadsList')
  list(@Req() req: any, @Query() q: any) {
    return this.leads.list(req.user, q);
  }

  /* Call-center queue - any authenticated role, scoped to own leads unless viewAll */
  @Get('queue')
  queue(@Req() req: any) {
    return this.leads.queue(req.user);
  }

  /* Static paths BEFORE :id routes so "import"/"shuffle" are never treated as ids */
  @Post('import')
  @RequirePermission('upload')
  import(@Req() req: any, @Body() body: { rows: any[] }) {
    return this.leads.bulkImport(req.user, body?.rows);
  }

  @Post('shuffle')
  @RequirePermission('shuffle')
  shuffle(@Req() req: any, @Body() body: any) {
    return this.leads.shuffle(req.user, body);
  }

  @Post('bulk-delete')
  @RequirePermission('editLeads')
  bulkDelete(@Req() req: any, @Body() body: { ids?: string[] }) {
    return this.leads.bulkDelete(req.user, body?.ids);
  }

  @Patch(':id')
  @RequirePermission('editLeads')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.leads.update(req.user, id, body);
  }

  @Delete(':id')
  @RequirePermission('editLeads')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.leads.remove(req.user, id);
  }

  @Post(':id/comments')
  addComment(@Req() req: any, @Param('id') id: string, @Body() body: { text: string }) {
    return this.leads.addComment(req.user, id, body?.text);
  }

  @Post(':id/call-log')
  logCall(@Req() req: any, @Param('id') id: string, @Body() body: { outcome: string; comment?: string }) {
    return this.leads.logCall(req.user, id, body);
  }

  @Post(':id/convert')
  @RequirePermission('clients')
  convert(@Req() req: any, @Param('id') id: string) {
    return this.leads.convertToClient(req.user, id);
  }
}
