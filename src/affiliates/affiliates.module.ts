import { Module } from '@nestjs/common';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatesService } from './affiliates.service';

@Module({ controllers: [AffiliatesController], providers: [AffiliatesService] })
export class AffiliatesModule {}
