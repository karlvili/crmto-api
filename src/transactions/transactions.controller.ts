import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { RequirePermission } from '../auth/decorators';

@Controller('transactions')
@RequirePermission('finance')
export class TransactionsController {
  constructor(private readonly txs: TransactionsService) {}

  @Get()
  list(@Query() q: any) {
    return this.txs.list(q);
  }

  @Post()
  request(@Req() req: any, @Body() body: any) {
    return this.txs.request(req.user, body);
  }

  @Post(':id/decide')
  @RequirePermission('financeApprove')
  decide(@Req() req: any, @Param('id') id: string, @Body() body: { approve: boolean }) {
    return this.txs.decide(req.user, id, !!body?.approve);
  }
}
