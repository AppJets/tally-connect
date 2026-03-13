// migrations/1700000000000-InitSchema.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Enums ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "subscription_status_enum" AS ENUM ('active', 'expired', 'revoked')
    `);
    await queryRunner.query(`
      CREATE TYPE "sync_session_status_enum" AS ENUM ('running', 'completed', 'partial', 'failed')
    `);
    await queryRunner.query(`
      CREATE TYPE "sync_type_enum" AS ENUM ('full', 'incremental')
    `);

    // ── subscriptions ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "customer_id"       VARCHAR NOT NULL,
        "agency_id"         VARCHAR NOT NULL,
        "client_id"         VARCHAR NOT NULL,
        "status"            "subscription_status_enum" NOT NULL DEFAULT 'active',
        "plan_duration_days" INTEGER NOT NULL,
        "activated_at"      TIMESTAMPTZ NOT NULL,
        "expires_at"        TIMESTAMPTZ NOT NULL,
        "payment_reference" VARCHAR,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_subscriptions_customer_client" UNIQUE ("customer_id", "client_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_subs_customer" ON "subscriptions" ("customer_id")`);
    await queryRunner.query(`CREATE INDEX "idx_subs_agency" ON "subscriptions" ("agency_id")`);
    await queryRunner.query(`CREATE INDEX "idx_subs_client" ON "subscriptions" ("client_id")`);

    // ── api_credentials ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "api_credentials" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id"   UUID NOT NULL REFERENCES "subscriptions"("id") ON DELETE CASCADE,
        "api_key"           VARCHAR NOT NULL UNIQUE,
        "api_secret_hash"   VARCHAR NOT NULL,
        "api_secret_prefix" VARCHAR(8) NOT NULL,
        "is_active"         BOOLEAN NOT NULL DEFAULT true,
        "expires_at"        TIMESTAMPTZ NOT NULL,
        "last_used_at"      TIMESTAMPTZ,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_creds_api_key" ON "api_credentials" ("api_key")`);
    await queryRunner.query(`CREATE INDEX "idx_creds_sub" ON "api_credentials" ("subscription_id")`);

    // ── tally_connections ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "tally_connections" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id"     UUID NOT NULL REFERENCES "subscriptions"("id") ON DELETE CASCADE,
        "credential_id"       UUID NOT NULL REFERENCES "api_credentials"("id") ON DELETE CASCADE,
        "tally_company_id"    VARCHAR NOT NULL,
        "tally_company_name"  VARCHAR NOT NULL,
        "device_id"           VARCHAR NOT NULL,
        "device_label"        VARCHAR,
        "is_active"           BOOLEAN NOT NULL DEFAULT true,
        "last_sync_at"        TIMESTAMPTZ,
        "registered_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_conn_sub_company" UNIQUE ("subscription_id", "tally_company_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_conn_sub" ON "tally_connections" ("subscription_id")`);

    // ── vouchers ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "vouchers" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id"  VARCHAR NOT NULL,
        "agency_id"        VARCHAR NOT NULL,
        "client_id"        VARCHAR NOT NULL,
        "connection_id"    VARCHAR,
        "tally_company_id" VARCHAR NOT NULL,
        "voucher_number"   VARCHAR NOT NULL,
        "voucher_type"     VARCHAR NOT NULL,
        "voucher_date"     DATE NOT NULL,
        "party_name"       VARCHAR,
        "narration"        TEXT,
        "amount"           NUMERIC(18,2) NOT NULL DEFAULT 0,
        "gstin"            VARCHAR(15),
        "place_of_supply"  VARCHAR,
        "gst_amount"       NUMERIC(18,2),
        "raw_data"         JSONB NOT NULL DEFAULT '{}',
        "synced_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_voucher_dedup" UNIQUE ("subscription_id", "voucher_number", "tally_company_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_voucher_sub_date" ON "vouchers" ("subscription_id", "voucher_date")`);
    await queryRunner.query(`CREATE INDEX "idx_voucher_client" ON "vouchers" ("client_id")`);
    await queryRunner.query(`CREATE INDEX "idx_voucher_synced" ON "vouchers" ("synced_at")`);

    // ── ledgers ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "ledgers" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id"  VARCHAR NOT NULL,
        "agency_id"        VARCHAR NOT NULL,
        "client_id"        VARCHAR NOT NULL,
        "connection_id"    VARCHAR,
        "tally_company_id" VARCHAR NOT NULL,
        "ledger_name"      VARCHAR NOT NULL,
        "group_name"       VARCHAR,
        "closing_balance"  NUMERIC(18,2) NOT NULL DEFAULT 0,
        "balance_type"     VARCHAR(2),
        "gstin"            VARCHAR(15),
        "raw_data"         JSONB NOT NULL DEFAULT '{}',
        "first_synced_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "last_synced_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_ledger_dedup" UNIQUE ("subscription_id", "ledger_name", "tally_company_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_ledger_sub" ON "ledgers" ("subscription_id")`);
    await queryRunner.query(`CREATE INDEX "idx_ledger_client" ON "ledgers" ("client_id")`);

    // ── sync_sessions ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "sync_sessions" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id"   VARCHAR NOT NULL,
        "connection_id"     VARCHAR NOT NULL,
        "agency_id"         VARCHAR NOT NULL,
        "client_id"         VARCHAR NOT NULL,
        "sync_type"         "sync_type_enum" NOT NULL DEFAULT 'incremental',
        "status"            "sync_session_status_enum" NOT NULL DEFAULT 'running',
        "records_processed" INTEGER NOT NULL DEFAULT 0,
        "records_failed"    INTEGER NOT NULL DEFAULT 0,
        "started_at"        TIMESTAMPTZ NOT NULL,
        "completed_at"      TIMESTAMPTZ
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_session_sub" ON "sync_sessions" ("subscription_id")`);
    await queryRunner.query(`CREATE INDEX "idx_session_conn" ON "sync_sessions" ("connection_id")`);
    await queryRunner.query(`CREATE INDEX "idx_session_started" ON "sync_sessions" ("started_at")`);

    // ── sync_errors ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "sync_errors" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "session_id"        UUID,
        "subscription_id"   VARCHAR NOT NULL,
        "agency_id"         VARCHAR NOT NULL,
        "client_id"         VARCHAR NOT NULL,
        "tally_company_id"  VARCHAR NOT NULL,
        "sync_type"         VARCHAR NOT NULL,
        "job_id"            VARCHAR,
        "payload"           JSONB NOT NULL,
        "error_message"     TEXT NOT NULL,
        "stack_trace"       TEXT,
        "attempts"          INTEGER NOT NULL DEFAULT 1,
        "failed_at"         TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_err_sub" ON "sync_errors" ("subscription_id")`);
    await queryRunner.query(`CREATE INDEX "idx_err_session" ON "sync_errors" ("session_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_errors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ledgers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vouchers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tally_connections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_credentials"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "sync_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "sync_session_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_status_enum"`);
  }
}
