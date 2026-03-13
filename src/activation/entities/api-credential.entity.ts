// src/activation/entities/api-credential.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Subscription } from './subscription.entity';

@Entity('api_credentials')
export class ApiCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subscription, (sub) => sub.credentials, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ name: 'subscription_id' })
  subscriptionId: string;

  /**
   * Publicly visible key — sent in X-API-Key header by TDL plugin.
   * Stored as plain UUID (not sensitive on its own).
   */
  @Column({ name: 'api_key', unique: true })
  @Index()
  apiKey: string;

  /**
   * bcrypt hash of the api_secret.
   * The raw secret is shown ONCE at activation time and never stored.
   */
  @Column({ name: 'api_secret_hash' })
  apiSecretHash: string;

  /**
   * First 8 chars of the raw secret — stored for display purposes
   * (e.g. "sk_live_ab12****") so users can identify which key is which.
   */
  @Column({ name: 'api_secret_prefix', length: 8 })
  apiSecretPrefix: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Mirrors the parent subscription expiry — denormalised for fast guard checks */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
