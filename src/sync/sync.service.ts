// src/sync/sync.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Subscription } from '../activation/entities/subscription.entity';
import { ApiCredential } from '../activation/entities/api-credential.entity';
import { TallyConnectionService } from '../tally-connection/tally-connection.service';
import { VoucherSyncDto, BulkLedgerSyncDto } from './dto/sync.dto';

export const SYNC_QUEUE = 'tally_sync_queue';

export enum SyncJobType {
  VOUCHER = 'sync.voucher',
  LEDGERS = 'sync.ledgers',
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectQueue(SYNC_QUEUE) private readonly syncQueue: Queue,
    private readonly connectionService: TallyConnectionService,
    private readonly configService: ConfigService,
  ) {}

  async enqueueVoucher(
    dto: VoucherSyncDto,
    subscription: Subscription,
    credential: ApiCredential,
  ): Promise<string> {
    await this.validateConnection(subscription, dto.tallyCompanyId, dto.deviceId);

    const attempts = this.configService.get<number>('queue.jobAttempts', 3);
    const job = await this.syncQueue.add(
      SyncJobType.VOUCHER,
      {
        payload: dto,
        subscriptionId: subscription.id,
        agencyId: subscription.agencyId,
        clientId: subscription.clientId,
      },
      {
        attempts,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    );

    return job.id as string;
  }

  async enqueueLedgers(
    dto: BulkLedgerSyncDto,
    subscription: Subscription,
    credential: ApiCredential,
  ): Promise<string> {
    await this.validateConnection(subscription, dto.tallyCompanyId, dto.deviceId);

    const attempts = this.configService.get<number>('queue.jobAttempts', 3);
    const job = await this.syncQueue.add(
      SyncJobType.LEDGERS,
      {
        payload: dto,
        subscriptionId: subscription.id,
        agencyId: subscription.agencyId,
        clientId: subscription.clientId,
      },
      {
        attempts,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: false,
      },
    );

    return job.id as string;
  }

  async registerConnection(
    body: { tallyCompanyId: string; tallyCompanyName: string; deviceId: string; deviceLabel?: string },
    subscription: Subscription,
    credential: ApiCredential,
  ) {
    return this.connectionService.register(body, subscription, credential);
  }

  private async validateConnection(
    subscription: Subscription,
    tallyCompanyId: string,
    deviceId: string,
  ) {
    const connection = await this.connectionService.findActive(
      subscription.id,
      tallyCompanyId,
      deviceId,
    );
    if (!connection) {
      throw new BadRequestException(
        'No active Tally connection found for this company + device. ' +
        'Call POST /tally/sync/connect first.',
      );
    }
    return connection;
  }
}
