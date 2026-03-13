// src/accounting/entities/ledger.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index, Unique,
} from 'typeorm';

@Entity('ledgers')
@Unique(['subscriptionId', 'ledgerName', 'tallyCompanyId'])
export class Ledger {
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

  @Column({ name: 'ledger_name' })
  ledgerName: string;

  @Column({ name: 'group_name', nullable: true })
  groupName: string;

  @Column({ name: 'closing_balance', type: 'numeric', precision: 18, scale: 2, default: 0 })
  closingBalance: number;

  /** Dr / Cr */
  @Column({ name: 'balance_type', length: 2, nullable: true })
  balanceType: string;

  @Column({ name: 'gstin', nullable: true, length: 15 })
  gstin: string;

  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData: Record<string, any>;

  @CreateDateColumn({ name: 'first_synced_at' })
  firstSyncedAt: Date;

  @UpdateDateColumn({ name: 'last_synced_at' })
  @Index()
  lastSyncedAt: Date;
}
