// src/monitoring/entities/sync-session.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index,
} from 'typeorm';

export enum SyncSessionStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  PARTIAL = 'partial',
  FAILED = 'failed',
}

export enum SyncType {
  FULL = 'full',
  INCREMENTAL = 'incremental',
}

@Entity('sync_sessions')
export class SyncSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscription_id' })
  @Index()
  subscriptionId: string;

  @Column({ name: 'connection_id' })
  @Index()
  connectionId: string;

  @Column({ name: 'agency_id' })
  agencyId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ type: 'enum', enum: SyncType, default: SyncType.INCREMENTAL })
  syncType: SyncType;

  @Column({ type: 'enum', enum: SyncSessionStatus, default: SyncSessionStatus.RUNNING })
  status: SyncSessionStatus;

  @Column({ name: 'records_processed', type: 'int', default: 0 })
  recordsProcessed: number;

  @Column({ name: 'records_failed', type: 'int', default: 0 })
  recordsFailed: number;

  @Column({ name: 'started_at', type: 'timestamptz' })
  @Index()
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;
}

// ── Sync Error Entity ─────────────────────────────────────────────────────────

// src/monitoring/entities/sync-error.entity.ts
@Entity('sync_errors')
export class SyncError {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id', nullable: true })
  @Index()
  sessionId: string;

  @Column({ name: 'subscription_id' })
  @Index()
  subscriptionId: string;

  @Column({ name: 'agency_id' })
  agencyId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'tally_company_id' })
  tallyCompanyId: string;

  /** ledger | voucher | inventory | company */
  @Column({ name: 'sync_type' })
  syncType: string;

  @Column({ name: 'job_id', nullable: true })
  jobId: string;

  /** Full raw payload that failed — stored as JSONB for post-mortem analysis */
  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ name: 'error_message', type: 'text' })
  errorMessage: string;

  @Column({ name: 'stack_trace', type: 'text', nullable: true })
  stackTrace: string;

  @Column({ name: 'attempts', type: 'int', default: 1 })
  attempts: number;

  @CreateDateColumn({ name: 'failed_at' })
  failedAt: Date;
}
