// src/activation/entities/subscription.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany, Index,
} from 'typeorm';
import { ApiCredential } from './api-credential.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity('subscriptions')
@Index(['customerId', 'clientId'], { unique: true })
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * customer_id from the external Lex Auth Service.
   * This is the authoritative user identity anchor — we never store
   * user PII here; we only reference the Auth Service's UUID.
   */
  @Column({ name: 'customer_id' })
  @Index()
  customerId: string;

  /** Agency that purchased the plugin */
  @Column({ name: 'agency_id' })
  @Index()
  agencyId: string;

  /**
   * The specific Lex client this activation is scoped to.
   * Per-client billing model: one paid activation per client.
   */
  @Column({ name: 'client_id' })
  @Index()
  clientId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  /** Duration in days granted by the payment (e.g. 30, 365) */
  @Column({ name: 'plan_duration_days', type: 'int' })
  planDurationDays: number;

  @Column({ name: 'activated_at', type: 'timestamptz' })
  activatedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /**
   * Opaque reference to the payment transaction in the Lex billing system.
   * Stored for audit trail only — never queried here.
   */
  @Column({ name: 'payment_reference', nullable: true })
  paymentReference: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => ApiCredential, (cred) => cred.subscription, { cascade: true })
  credentials: ApiCredential[];
}
