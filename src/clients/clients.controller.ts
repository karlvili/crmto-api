import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
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

  @Get(':id/kyc-documents')
  listKyc(@Req() req: any, @Param('id') id: string) {
    return this.clients.listKycDocuments(req.user, id);
  }

  @Get(':id/kyc-documents/:docId/file')
  async downloadKyc(
    @Req() req: any,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Res() res: Response,
  ) {
    const doc = await this.clients.getKycDocumentFile(req.user, id, docId);
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${String(doc.originalName || 'document').replace(/"/g, '')}"`,
    );
    res.send(Buffer.from(doc.data));
  }

  @Post(':id/kyc/decide')
  @RequirePermission('editLeads')
  decideKyc(@Req() req: any, @Param('id') id: string, @Body() body: { approve?: boolean }) {
    return this.clients.decideKyc(req.user, id, !!body?.approve);
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
