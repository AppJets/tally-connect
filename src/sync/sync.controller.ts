// src/sync/sync.controller.ts
import {
  Controller, Post, Body, UseGuards,
  HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import {
  ActiveSubscription,
  ActiveCredential,
} from '../common/decorators/subscription.decorator';
import { Subscription } from '../activation/entities/subscription.entity';
import { ApiCredential } from '../activation/entities/api-credential.entity';
import { SyncService } from './sync.service';
import { VoucherSyncDto, BulkLedgerSyncDto } from './dto/sync.dto';

/**
 * These endpoints are called by the TDL plugin installed on the client's machine.
 * Auth: X-API-Key + X-API-Secret (validated by ApiKeyGuard).
 * All heavy lifting is queued via BullMQ — responses are always 202 Accepted.
 */
@ApiTags('Sync (TDL Plugin)')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('tally/sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(private readonly syncService: SyncService) {}

  @Post('voucher')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 100, ttl: 60_000 } }) // 100 req/min per key
  @ApiOperation({ summary: 'Push a single voucher from TallyPrime' })
  async syncVoucher(
    @Body() dto: VoucherSyncDto,
    @ActiveSubscription() subscription: Subscription,
    @ActiveCredential() credential: ApiCredential,
  ) {
    const jobId = await this.syncService.enqueueVoucher(dto, subscription, credential);
    return { accepted: true, jobId, message: 'Voucher queued for processing.' };
  }

  @Post('ledgers')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // bulk is heavier
  @ApiOperation({ summary: 'Push a batch of ledger masters from TallyPrime' })
  async syncLedgers(
    @Body() dto: BulkLedgerSyncDto,
    @ActiveSubscription() subscription: Subscription,
    @ActiveCredential() credential: ApiCredential,
  ) {
    const jobId = await this.syncService.enqueueLedgers(dto, subscription, credential);
    return { accepted: true, jobId, message: `${dto.ledgers.length} ledgers queued for processing.` };
  }

  @Post('connect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register or refresh a Tally company connection' })
  async connect(
    @Body() body: { tallyCompanyId: string; tallyCompanyName: string; deviceId: string; deviceLabel?: string },
    @ActiveSubscription() subscription: Subscription,
    @ActiveCredential() credential: ApiCredential,
  ) {
    return this.syncService.registerConnection(body, subscription, credential);
  }
}
