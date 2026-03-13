// src/tally-connection/tally-connection.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TallyConnection } from './entities/tally-connection.entity';
import { TallyConnectionService } from './tally-connection.service';

@Module({
  imports: [TypeOrmModule.forFeature([TallyConnection])],
  providers: [TallyConnectionService],
  exports: [TallyConnectionService],
})
export class TallyConnectionModule {}

// ─────────────────────────────────────────────────────────────────────────────

// src/normalization/normalization.module.ts
import { Module as NestModule } from '@nestjs/common';
import { NormalizationService } from './normalization.service';

@NestModule({
  providers: [NormalizationService],
  exports: [NormalizationService],
})
export class NormalizationModule {}

// ─────────────────────────────────────────────────────────────────────────────

// src/sync/sync.module.ts
import { Module as SyncNestModule } from '@nestjs/common';
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

@SyncNestModule({
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
