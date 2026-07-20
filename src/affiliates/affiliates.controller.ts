import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { AffiliatesService } from './affiliates.service';
import { Public, RequirePermission } from '../auth/decorators';

@Controller('affiliates')
export class AffiliatesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get()
  @RequirePermission('affiliates')
  list() {
    return this.affiliates.list();
  }

  @Post()
  @RequirePermission('affiliates')
  create(@Req() req: any, @Body() body: any) {
    return this.affiliates.create(req.user, body);
  }

  @Patch(':id')
  @RequirePermission('affiliates')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.affiliates.update(req.user, id, body);
  }

  @Post(':id/rotate-key')
  @RequirePermission('affiliates')
  rotateKey(@Req() req: any, @Param('id') id: string) {
    return this.affiliates.rotateKey(req.user, id);
  }

  @Get('leads')
  @RequirePermission('affiliates')
  listLeads(@Req() req: any, @Query() q: any) {
    return this.affiliates.listLeads(req.user, q);
  }

  /* Public - affiliates post leads here with their API key */
  @Public()
  @Post('inbound')
  @HttpCode(200)
  ingest(@Headers('x-api-key') apiKey: string, @Body() body: any) {
    return this.affiliates.ingest(apiKey, body);
  }
}
