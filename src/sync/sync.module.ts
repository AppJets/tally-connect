import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncController } from './sync.controller';
import { SyncService, SYNC_QUEUE } from './sync.service';
import { SyncProcessor } from './processors/sync.processor';
import { Voucher } from '../accounting/entities/voucher.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { SyncSession, SyncError } from '../monitoring/entities/sync-session.entity';
import { ActivationModule } from '../activation/activation.module';
import { TallyConnectionModule } from '../tally-connection/tally-connection.module';
import { NormalizationModule } from '../normalization/normalization.module';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Module({
  imports: [
    BullModule.registerQueue({ name: SYNC_QUEUE }),
    TypeOrmModule.forFeature([Voucher, Ledger, SyncSession, SyncError]),
    ActivationModule,
    TallyConnectionModule,
    NormalizationModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncProcessor, ApiKeyGuard],
})
export class SyncModule {}
