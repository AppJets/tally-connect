// src/sync/processors/sync.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SYNC_QUEUE, SyncJobType } from '../sync.service';
import { Voucher } from '../../accounting/entities/voucher.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';
import { SyncError } from '../../monitoring/entities/sync-session.entity';
import { NormalizationService } from '../../normalization/normalization.service';
import { TallyConnectionService } from '../../tally-connection/tally-connection.service';

@Processor(SYNC_QUEUE, {
  concurrency: 10, // overridden per worker type in module config
})
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(
    @InjectRepository(Voucher)
    private readonly voucherRepo: Repository<Voucher>,
    @InjectRepository(Ledger)
    private readonly ledgerRepo: Repository<Ledger>,
    @InjectRepository(SyncError)
    private readonly errorRepo: Repository<SyncError>,
    private readonly normalizationService: NormalizationService,
    private readonly connectionService: TallyConnectionService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case SyncJobType.VOUCHER:
        return this.processVoucher(job);
      case SyncJobType.LEDGERS:
        return this.processLedgers(job);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  // ── Voucher ───────────────────────────────────────────────────────────────

  private async processVoucher(job: Job) {
    const { payload, subscriptionId, agencyId, clientId } = job.data;
    this.logger.debug(`Processing voucher job ${job.id} sub=${subscriptionId}`);

    try {
      const normalized = this.normalizationService.normalizeVoucher(payload);

      // Upsert by the deduplication key: subscriptionId + voucherNumber + tallyCompanyId
      await this.voucherRepo
        .createQueryBuilder()
        .insert()
        .into(Voucher)
        .values({
          subscriptionId,
          agencyId,
          clientId,
          connectionId: normalized.connectionId,
          tallyCompanyId: payload.tallyCompanyId,
          voucherNumber: payload.voucherNumber,
          voucherType: normalized.voucherType ?? undefined,
          voucherDate: new Date(payload.voucherDate),
          partyName: normalized.partyName ?? undefined,
          narration: normalized.narration,
          amount: normalized.amount,
          gstin: normalized.gstin ?? undefined,
          placeOfSupply: normalized.placeOfSupply,
          gstAmount: normalized.gstAmount ?? undefined,
          rawData: payload.rawData ?? payload,
        })
        .orUpdate(
          ['voucher_type', 'party_name', 'narration', 'amount', 'gstin', 'gst_amount', 'raw_data'],
          ['subscription_id', 'voucher_number', 'tally_company_id'],
        )
        .execute();

      // Update last_sync_at on the connection
      const conn = await this.connectionService.findActive(
        subscriptionId, payload.tallyCompanyId, payload.deviceId,
      );
      if (conn) await this.connectionService.updateLastSync(conn.id);

      return { processed: 1 };
    } catch (err) {
      await this.recordError(job, subscriptionId, agencyId, clientId, payload, err);
      throw err; // re-throw so BullMQ triggers the retry
    }
  }

  // ── Ledgers (bulk) ────────────────────────────────────────────────────────

  private async processLedgers(job: Job) {
    const { payload, subscriptionId, agencyId, clientId } = job.data;
    const { ledgers, tallyCompanyId, deviceId } = payload;
    this.logger.debug(`Processing ${ledgers.length} ledgers job ${job.id} sub=${subscriptionId}`);

    let processed = 0;
    let failed = 0;

    for (const ledger of ledgers) {
      try {
        const normalized = this.normalizationService.normalizeLedger(ledger);

        await this.ledgerRepo
          .createQueryBuilder()
          .insert()
          .into(Ledger)
          .values({
            subscriptionId,
            agencyId,
            clientId,
            connectionId: normalized.connectionId,
            tallyCompanyId,
            ledgerName: ledger.ledgerName,
            groupName: normalized.groupName ?? undefined,
            closingBalance: normalized.closingBalance,
            balanceType: normalized.balanceType,
            gstin: normalized.gstin ?? undefined,
            rawData: ledger.rawData ?? ledger,
          })
          .orUpdate(
            ['group_name', 'closing_balance', 'balance_type', 'gstin', 'raw_data'],
            ['subscription_id', 'ledger_name', 'tally_company_id'],
          )
          .execute();

        processed++;
      } catch (err) {
        failed++;
        await this.recordError(job, subscriptionId, agencyId, clientId, ledger, err);
        // Continue processing remaining ledgers even if one fails
      }
    }

    this.logger.log(`Ledger batch done: ${processed} ok, ${failed} failed (job ${job.id})`);
    return { processed, failed };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async recordError(
    job: Job,
    subscriptionId: string,
    agencyId: string,
    clientId: string,
    payload: any,
    err: any,
  ) {
    try {
      await this.errorRepo.save(
        this.errorRepo.create({
          jobId: job.id as string,
          subscriptionId,
          agencyId,
          clientId,
          tallyCompanyId: payload?.tallyCompanyId ?? 'unknown',
          syncType: job.name,
          payload,
          errorMessage: err?.message ?? String(err),
          stackTrace: err?.stack,
          attempts: (job.attemptsMade ?? 0) + 1,
        }),
      );
    } catch (logErr) {
      this.logger.error('Failed to record sync error', logErr);
    }
  }
}
