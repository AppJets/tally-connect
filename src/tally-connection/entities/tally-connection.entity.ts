// src/tally-connection/entities/tally-connection.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { ApiCredential } from '../../activation/entities/api-credential.entity';
import { Subscription } from '../../activation/entities/subscription.entity';

@Entity('tally_connections')
@Index(['subscriptionId', 'tallyCompanyId'], { unique: true })
export class TallyConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ name: 'subscription_id' })
  @Index()
  subscriptionId: string;

  @ManyToOne(() => ApiCredential, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'credential_id' })
  credential: ApiCredential;

  @Column({ name: 'credential_id' })
  credentialId: string;

  /** Tally's internal company GUID */
  @Column({ name: 'tally_company_id' })
  tallyCompanyId: string;

  @Column({ name: 'tally_company_name' })
  tallyCompanyName: string;

  /** Deterministic hardware fingerprint set by the TDL installer */
  @Column({ name: 'device_id' })
  deviceId: string;

  /** Human-readable device label (hostname, optional) */
  @Column({ name: 'device_label', nullable: true })
  deviceLabel: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_sync_at', type: 'timestamptz', nullable: true })
  lastSyncAt: Date;

  @CreateDateColumn({ name: 'registered_at' })
  registeredAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
