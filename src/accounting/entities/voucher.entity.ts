// src/accounting/entities/voucher.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index, ManyToOne, JoinColumn, Unique,
} from 'typeorm';
import { Subscription } from '../../activation/entities/subscription.entity';
import { TallyConnection } from '../../tally-connection/entities/tally-connection.entity';

@Entity('vouchers')
@Unique(['subscriptionId', 'voucherNumber', 'tallyCompanyId']) // deduplication key
export class Voucher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id' })
  @Index()
  subscriptionId: string;

  @Column({ name: 'agency_id' })
  @Index()
  agencyId: string;

  @Column({ name: 'client_id' })
  @Index()
  clientId: string;

  @Column({ name: 'connection_id' })
  connectionId: string;

  @Column({ name: 'tally_company_id' })
  tallyCompanyId: string;

  @Column({ name: 'voucher_number' })
  voucherNumber: string;

  /** Sales | Purchase | Receipt | Payment | Journal | Contra */
  @Column({ name: 'voucher_type' })
  voucherType: string;

  @Column({ name: 'voucher_date', type: 'date' })
  @Index()
  voucherDate: Date;

  @Column({ name: 'party_name', nullable: true })
  partyName: string;

  @Column({ nullable: true })
  narration: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: number;

  /** GST-specific fields */
  @Column({ name: 'gstin', nullable: true, length: 15 })
  gstin: string;

  @Column({ name: 'place_of_supply', nullable: true })
  placeOfSupply: string;

  @Column({ name: 'gst_amount', type: 'numeric', precision: 18, scale: 2, nullable: true })
  gstAmount: number;

  /**
   * Full raw Tally payload stored as JSONB.
   * This acts as the audit trail — the normalized fields above are
   * derived from this. On schema changes, we can re-normalize without re-sync.
   */
  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData: Record<string, any>;

  @CreateDateColumn({ name: 'synced_at' })
  @Index()
  syncedAt: Date;
}
