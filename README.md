# tally-connect

**lex-tally-sync-service** — NestJS microservice that bridges TallyPrime (on-premise desktop accounting) with the Lex SaaS platform. Enables automated, real-time ingestion of vouchers, ledgers, and accounting masters as a **paid plugin** — customers activate it through the Lex app after payment, and the TDL plugin on their machine syncs data automatically.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Database Setup](#database-setup)
- [Running the Service](#running-the-service)
- [API Reference](#api-reference)
- [Authentication & Security](#authentication--security)
- [Subscription & Activation Flow](#subscription--activation-flow)
- [Integration Guide — Lex App](#integration-guide--lex-app-existing-service)
- [Integration Guide — TDL Plugin](#integration-guide--tdl-plugin-on-premise)
- [Queue & Background Processing](#queue--background-processing)
- [Data Models](#data-models)
- [Error Handling & Retry Strategy](#error-handling--retry-strategy)
- [Migrations](#migrations)
- [Dependencies](#dependencies)
- [Development Scripts](#development-scripts)
- [Deployment](#deployment)
- [Security Checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Overview

Most small and mid-size Indian businesses run accounting on TallyPrime — an on-premise desktop application. Lex clients who use TallyPrime previously had no automated way to get their data into Lex, requiring manual exports that were error-prone and unsustainable.

**tally-connect** solves this by:

- Providing a **paid plugin** model — agencies activate it per-client after payment in the Lex app
- Generating **scoped API credentials** (`api_key` + `api_secret`) per activation, tied to the customer's identity from the Lex Auth Service
- Exposing **secure inbound REST endpoints** that the TDL plugin calls to push data
- Processing all sync jobs **asynchronously via BullMQ**, with retry logic and full error recording
- Storing all accounting data in its **own isolated PostgreSQL database** — no shared schema with other Lex services

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Lex Platform (Existing)                       │
│                                                                       │
│   User pays for Tally plugin  ──►  POST /internal/activation/activate│
│   (HMAC-signed, server-to-server)                                    │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │ Returns { apiKey, apiSecret }
                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     lex-tally-sync-service (this)                    │
│                                                                       │
│  ┌──────────────┐   ┌─────────────────┐   ┌───────────────────────┐ │
│  │  Activation  │   │   Sync API      │   │   Queue Processor     │ │
│  │  Module      │   │   (TDL Plugin)  │   │   (BullMQ Workers)    │ │
│  │              │   │                 │   │                        │ │
│  │ - Subscribe  │   │ POST /connect   │   │ - Normalize fields    │ │
│  │ - Generate   │   │ POST /voucher   │   │ - Upsert records      │ │
│  │   api_key    │   │ POST /ledgers   │   │ - Record errors       │ │
│  │ - Revoke     │   │                 │   │ - Retry w/ backoff    │ │
│  └──────┬───────┘   └────────┬────────┘   └───────────┬───────────┘ │
│         │                    │                         │             │
│         ▼                    ▼                         ▼             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    PostgreSQL (Own DB)                        │   │
│  │  subscriptions │ api_credentials │ tally_connections         │   │
│  │  vouchers      │ ledgers         │ sync_sessions             │   │
│  │  sync_errors                                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                       Redis (BullMQ)                          │   │
│  │  tally_sync_queue  →  voucher jobs  │  ledger jobs            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                       ▲
                                       │ X-API-Key + X-API-Secret
┌─────────────────────────────────────────────────────────────────────┐
│              TDL Plugin (installed on customer's machine)            │
│                                                                       │
│  TallyPrime events  ──►  TDL intercepts  ──►  HTTPS push to this    │
│                           (on create/alter     service               │
│                            voucher/ledger)                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

**Why its own PostgreSQL?**
Shared databases create tight coupling and deployment risk between microservices. This service owns its schema entirely. The only cross-service identifier is `customer_id` from the Auth Service — no foreign keys across service boundaries.

**Why api_key + api_secret (not JWT forwarding)?**
The TDL plugin is a desktop application running on-premise on the customer's Windows machine. Long-lived key+secret pairs are simpler to configure, rotate, and audit than JWTs. The Lex app already validated the user during payment — this service does not need to re-do that on every sync request.

**Why bcrypt for api_secret?**
If the database is ever compromised, raw secrets are not exposed. bcrypt's deliberate slowness is acceptable at activation time (once). The guard lookup uses the fast `api_key` index first, then `bcrypt.compare` only on a matched active credential.

**Why JSONB `raw_data` on vouchers and ledgers?**
Tally's XML schema evolves across versions. Storing the full raw payload means historical data can be re-normalized without re-syncing from Tally when mapping logic changes.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+ |
| Framework | NestJS 10 |
| Language | TypeScript 5 |
| Database | PostgreSQL 16 |
| ORM | TypeORM 0.3 |
| Queue | BullMQ 4 + Redis 7 |
| Validation | class-validator + class-transformer |
| Security | helmet, bcrypt, HMAC-SHA256 |
| API Docs | Swagger / OpenAPI (dev only) |
| Rate Limiting | @nestjs/throttler |

---

## Project Structure

```
tally-connect/
├── migrations/
│   └── 1700000000000-InitSchema.ts      # Initial schema (all tables + indexes)
│
├── src/
│   ├── main.ts                          # Bootstrap, Swagger, global pipes
│   ├── app.module.ts                    # Root module
│   ├── modules.ts                       # Feature module declarations
│   │
│   ├── config/
│   │   └── configuration.ts            # Typed config from env variables
│   │
│   ├── database/
│   │   ├── database.module.ts          # TypeORM async config
│   │   └── data-source.ts              # TypeORM CLI data source (migrations)
│   │
│   ├── activation/                      # Paid plugin lifecycle
│   │   ├── activation.controller.ts    # Internal webhook endpoints
│   │   ├── activation.service.ts       # Credential generation, renewal, revocation
│   │   ├── activation.module.ts
│   │   ├── dto/activate.dto.ts
│   │   └── entities/
│   │       ├── subscription.entity.ts
│   │       └── api-credential.entity.ts
│   │
│   ├── tally-connection/
│   │   ├── tally-connection.service.ts
│   │   └── entities/tally-connection.entity.ts
│   │
│   ├── sync/
│   │   ├── sync.controller.ts          # POST /tally/sync/* (ApiKeyGuard)
│   │   ├── sync.service.ts             # Validation + BullMQ enqueueing
│   │   ├── dto/sync.dto.ts
│   │   └── processors/sync.processor.ts  # BullMQ worker
│   │
│   ├── normalization/
│   │   └── normalization.service.ts    # Tally fields → Lex schema
│   │
│   ├── accounting/entities/
│   │   ├── voucher.entity.ts
│   │   └── ledger.entity.ts
│   │
│   ├── monitoring/entities/
│   │   └── sync-session.entity.ts      # SyncSession + SyncError
│   │
│   └── common/
│       ├── guards/api-key.guard.ts     # Validates X-API-Key + X-API-Secret
│       └── decorators/subscription.decorator.ts
│
├── .env.example
├── .gitignore
├── docker-compose.yml                   # Local Postgres + Redis + Bull dashboard
├── nest-cli.json
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

---

## Prerequisites

- **Node.js** v20+ — [nodejs.org](https://nodejs.org)
- **npm** v9+
- **PostgreSQL** 14+
- **Redis** 6+

```bash
node --version   # v20.x.x
npm --version    # 9.x.x
psql --version   # 14.x+
redis-cli ping   # PONG
```

---

## Local Setup

### Option A — Docker (Recommended)

```bash
git clone https://github.com/AppJets/tally-connect.git
cd tally-connect
docker-compose up -d
```

| Service | Port | Notes |
|---------|------|-------|
| PostgreSQL | `5433` | Avoids conflict with local postgres |
| Redis | `6380` | Avoids conflict with local redis |
| Bull Dashboard | `3001` | http://localhost:3001 |

### Option B — Local Postgres + Redis

Configure `.env.local` to point at your local instances (see below).

### Install dependencies

```bash
npm install
```

---

## Environment Variables

```bash
cp .env.example .env.local
# Fill in your values — this file is gitignored
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3100` | HTTP port |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `DB_HOST` | Yes | `localhost` | PostgreSQL host |
| `DB_PORT` | No | `5432` | Use `5433` if using docker-compose |
| `DB_USERNAME` | Yes | — | PostgreSQL user |
| `DB_PASSWORD` | Yes | — | PostgreSQL password |
| `DB_NAME` | Yes | `lex_tally_db` | Database name |
| `DB_SYNCHRONIZE` | No | `false` | **Never `true` in prod** |
| `DB_LOGGING` | No | `false` | Logs all SQL |
| `REDIS_HOST` | Yes | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Use `6380` if using docker-compose |
| `REDIS_PASSWORD` | No | — | Leave empty if none |
| `ACTIVATION_WEBHOOK_SECRET` | Yes | — | HMAC secret shared with Lex app |
| `API_SECRET_SALT_ROUNDS` | No | `12` | bcrypt cost factor |
| `SYNC_QUEUE_CONCURRENCY` | No | `10` | BullMQ workers per job type |
| `SYNC_JOB_ATTEMPTS` | No | `3` | Retry attempts per job |

**Generate a strong webhook secret:**
```bash
openssl rand -hex 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Database Setup

### Create DB (skip if using docker-compose)

```sql
CREATE USER lex_tally WITH PASSWORD 'your_strong_password';
CREATE DATABASE lex_tally_db OWNER lex_tally;
GRANT ALL PRIVILEGES ON DATABASE lex_tally_db TO lex_tally;
```

### Run migrations

```bash
npm run build
npm run migration:run
```

### Verify

```bash
psql -U lex_tally -d lex_tally_db -c "\dt"
# Expected: subscriptions, api_credentials, tally_connections,
#           vouchers, ledgers, sync_sessions, sync_errors
```

---

## Running the Service

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run build && npm run start:prod
```

- API base: `http://localhost:3100/api/v1`
- Swagger docs: `http://localhost:3100/docs` (dev only)
- Bull dashboard: `http://localhost:3001`

---

## API Reference

All routes prefixed with `/api/v1`.

### Internal Endpoints — Lex App → This Service

Requires `X-Lex-Signature: sha256=<HMAC-SHA256 of raw body>` on every request.

#### `POST /api/v1/internal/activation/activate`

Activates the plugin for a client after confirmed payment. Idempotent — calling again renews the subscription and rotates credentials.

```json
// Request body
{
  "customerId": "uuid-from-lex-auth-service",
  "agencyId": "uuid-of-agency",
  "clientId": "uuid-of-client",
  "planDurationDays": 365,
  "paymentReference": "PAY-12345"
}

// Response 201
{
  "subscriptionId": "uuid",
  "apiKey": "ltk_abc123...",
  "apiSecret": "lts_xyz789...",
  "apiSecretPrefix": "lts_xyz7",
  "expiresAt": "2026-03-13T00:00:00.000Z",
  "message": "Plugin activated. Store your api_secret securely — it will not be shown again."
}
```

> The `apiSecret` is returned **once only** and never stored in plaintext. The Lex app must securely display it to the customer.

---

#### `POST /api/v1/internal/activation/deactivate`

Revokes all credentials for a customer+client pair immediately.

```json
// Request body
{ "customerId": "uuid", "clientId": "uuid" }

// Response 200
{ "message": "Plugin deactivated. All credentials revoked." }
```

---

#### `GET /api/v1/internal/activation/status/:customerId/:clientId`

```json
// Response 200
{
  "subscriptionId": "uuid",
  "status": "active",
  "active": true,
  "expiresAt": "2026-03-13T00:00:00.000Z",
  "clientId": "uuid"
}
```

---

### Sync Endpoints — TDL Plugin → This Service

All require `X-API-Key` and `X-API-Secret` headers.

#### `POST /api/v1/tally/sync/connect`

Register or refresh a TallyPrime company + device. Call on every plugin startup.

```json
// Request body
{
  "tallyCompanyId": "TALLY-COMPANY-GUID",
  "tallyCompanyName": "ABC Traders Pvt Ltd",
  "deviceId": "hw-fingerprint-from-installer",
  "deviceLabel": "ACCOUNTING-PC-01"
}
```

---

#### `POST /api/v1/tally/sync/voucher`

Push a single voucher. Rate limit: **100 req/min** per api_key.

```json
{
  "tallyCompanyId": "TALLY-COMPANY-GUID",
  "deviceId": "hw-fingerprint",
  "voucherNumber": "SAL/2024-25/001",
  "voucherType": "Sales",
  "voucherDate": "2024-04-01",
  "partyName": "XYZ Enterprises",
  "narration": "Against invoice INV-001",
  "amount": 118000.00,
  "gstin": "27AABCU9603R1ZX",
  "placeOfSupply": "Maharashtra",
  "gstAmount": 18000.00,
  "ledgerEntries": [
    { "ledgerName": "XYZ Enterprises", "amount": 118000.00, "type": "Dr" },
    { "ledgerName": "Sales Account", "amount": 100000.00, "type": "Cr" },
    { "ledgerName": "Output GST 18%", "amount": 18000.00, "type": "Cr" }
  ]
}

// Response 202
{ "accepted": true, "jobId": "bullmq-job-id", "message": "Voucher queued for processing." }
```

---

#### `POST /api/v1/tally/sync/ledgers`

Push a batch of ledger masters. Rate limit: **20 req/min** per api_key.

```json
{
  "tallyCompanyId": "TALLY-COMPANY-GUID",
  "deviceId": "hw-fingerprint",
  "ledgers": [
    {
      "ledgerName": "XYZ Enterprises",
      "groupName": "Sundry Debtors",
      "closingBalance": 250000.00,
      "balanceType": "Dr",
      "gstin": "27AABCU9603R1ZX"
    }
  ]
}

// Response 202
{ "accepted": true, "jobId": "bullmq-job-id", "message": "1 ledgers queued for processing." }
```

---

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created (activation) |
| `202` | Accepted — job queued |
| `400` | Validation error or missing Tally connection |
| `401` | Invalid credentials or HMAC signature |
| `404` | Subscription not found |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

## Authentication & Security

### Internal endpoints — HMAC-SHA256

The Lex app and this service share `ACTIVATION_WEBHOOK_SECRET`. Every internal request must include:

```
X-Lex-Signature: sha256=<HMAC-SHA256 of raw JSON body>
```

Verification uses `timingSafeEqual` to prevent timing attacks.

### Sync endpoints — api_key + api_secret

```
X-API-Key:    ltk_abc123...    (public identifier)
X-API-Secret: lts_xyz789...    (sensitive — HTTPS only)
```

`ApiKeyGuard` checks on every request:
1. Look up `api_key` in `api_credentials` (indexed)
2. `is_active = true`
3. `expires_at > now()`
4. Parent `subscription.status = 'active'`
5. `bcrypt.compare(apiSecret, api_secret_hash)`

All 5 must pass. On success, `subscription` + `credential` are attached to the request.

### General

- **Helmet** security headers on all responses
- **Rate limiting** via `@nestjs/throttler`
- `ValidationPipe` with `whitelist: true` strips unknown fields
- Every DB row scoped to `subscription_id` + `agency_id` + `client_id`
- Serve over HTTPS only (enforce at reverse proxy / load balancer)

---

## Subscription & Activation Flow

```
1. Customer buys Tally plugin in Lex app
2. Lex app → POST /internal/activation/activate (HMAC-signed)
3. This service creates subscription + generates api_key / api_secret
4. Returns { apiKey, apiSecret } — shown ONCE to customer
5. Customer configures TDL plugin with apiKey + apiSecret
6. Plugin → POST /tally/sync/connect (register company + device)
7. Plugin pushes vouchers/ledgers automatically on TallyPrime events
8. On expiry: plugin returns 401 → customer renews in Lex app → new credentials
9. On cancellation: POST /internal/activation/deactivate → immediate revocation
```

---

## Integration Guide — Lex App (Existing Service)

### 1. Share the webhook secret

Both services must have the same `ACTIVATION_WEBHOOK_SECRET`.

### 2. Call activate after payment

```typescript
import { createHmac } from 'crypto';
import axios from 'axios';

const TALLY_SERVICE_URL = process.env.TALLY_SERVICE_URL;
const WEBHOOK_SECRET   = process.env.ACTIVATION_WEBHOOK_SECRET;

async function activateTallyPlugin(payload: {
  customerId: string;
  agencyId: string;
  clientId: string;
  planDurationDays: number;
  paymentReference: string;
}) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET)
    .update(body).digest('hex')}`;

  const { data } = await axios.post(
    `${TALLY_SERVICE_URL}/api/v1/internal/activation/activate`,
    payload,
    { headers: { 'Content-Type': 'application/json', 'X-Lex-Signature': signature } }
  );

  return data; // { subscriptionId, apiKey, apiSecret, expiresAt }
  // Show apiKey + apiSecret to customer ONCE in the UI
}
```

### 3. Deactivate on cancellation / refund

```typescript
async function deactivateTallyPlugin(customerId: string, clientId: string) {
  const body = JSON.stringify({ customerId, clientId });
  const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET)
    .update(body).digest('hex')}`;

  await axios.post(
    `${TALLY_SERVICE_URL}/api/v1/internal/activation/deactivate`,
    { customerId, clientId },
    { headers: { 'Content-Type': 'application/json', 'X-Lex-Signature': signature } }
  );
}
```

---

## Integration Guide — TDL Plugin (On-Premise)

### Configuration (customer sets these once)

```ini
LEX_API_KEY    = ltk_abc123...
LEX_API_SECRET = lts_xyz789...
LEX_SYNC_URL   = https://tally.lex.app/api/v1
```

### Startup sequence

```
1. POST /tally/sync/connect       → register TallyCompany + deviceId
2. On voucher save/alter event    → POST /tally/sync/voucher
3. On ledger save/alter event     → POST /tally/sync/ledgers
4. On 401 response                → alert user to renew in Lex app
```

### Plugin-side retry schedule

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 30 seconds |
| 3 | 2 minutes |
| 4 | 10 minutes |
| 5 | 1 hour |
| After 5 failures | Log to file, alert user |

---

## Queue & Background Processing

All sync endpoints return `202 Accepted` immediately. Heavy work is processed asynchronously.

**Queue:** `tally_sync_queue`

| Job | Trigger | Concurrency |
|-----|---------|-------------|
| `sync.voucher` | POST /tally/sync/voucher | 10 workers |
| `sync.ledgers` | POST /tally/sync/ledgers | 10 workers |

**Job options:** 3 attempts, exponential backoff from 5s, failed jobs retained in BullMQ + written to `sync_errors` table with full payload.

**Bull Dashboard** (dev): `http://localhost:3001`

---

## Data Models

### `subscriptions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `customer_id` | VARCHAR | From Lex Auth Service |
| `agency_id` | VARCHAR | |
| `client_id` | VARCHAR | Unique per subscription (per-client billing) |
| `status` | ENUM | `active` / `expired` / `revoked` |
| `plan_duration_days` | INT | |
| `expires_at` | TIMESTAMPTZ | |
| `payment_reference` | VARCHAR | Audit trail only |

### `api_credentials`
| Column | Type | Notes |
|--------|------|-------|
| `api_key` | VARCHAR | Public, unique — `ltk_...` format |
| `api_secret_hash` | VARCHAR | bcrypt hash only |
| `api_secret_prefix` | VARCHAR(8) | First 8 chars for UI display |
| `is_active` | BOOLEAN | False on revocation or renewal |
| `expires_at` | TIMESTAMPTZ | Denormalized from subscription |

### `vouchers` / `ledgers`
Both include `raw_data JSONB` (full original Tally payload) alongside normalized columns. Unique constraints on `(subscription_id, voucher_number, tally_company_id)` and `(subscription_id, ledger_name, tally_company_id)` ensure idempotent upserts.

---

## Error Handling & Retry Strategy

| Error | Behavior |
|-------|----------|
| `400` Validation | Returned immediately — plugin should not retry without fixing payload |
| `401` Auth | Plugin should alert user — do not retry automatically |
| `5xx` / Network | Plugin retries per schedule above |
| Queue job failure | BullMQ retries up to `SYNC_JOB_ATTEMPTS` with exponential backoff |
| Exhausted retries | Written to `sync_errors` with full payload + stack trace |

---

## Migrations

```bash
npm run build                                         # Required before CLI commands
npm run migration:run                                 # Apply pending
npm run migration:revert                              # Roll back last
npm run migration:generate -- -n DescriptiveName     # Generate from entity changes
```

Always review generated migration files before running in production.

---

## Dependencies

### Production

| Package | Purpose |
|---------|---------|
| `@nestjs/common`, `@nestjs/core` | NestJS framework |
| `@nestjs/config` | Typed environment config |
| `@nestjs/typeorm` | TypeORM integration |
| `@nestjs/bullmq` | BullMQ queue integration |
| `@nestjs/swagger` | OpenAPI / Swagger docs |
| `@nestjs/throttler` | Rate limiting |
| `typeorm` + `pg` | PostgreSQL ORM + driver |
| `bullmq` + `ioredis` | Redis-backed job queue |
| `bcrypt` | Secret hashing |
| `uuid` | UUID generation |
| `class-validator` + `class-transformer` | DTO validation |
| `helmet` | Security headers |

### Dev

| Package | Purpose |
|---------|---------|
| `@nestjs/cli` | Build tooling |
| `@nestjs/testing` | Unit/e2e test helpers |
| `typescript` | Compiler |

---

## Development Scripts

```bash
npm run start:dev                        # Watch mode (recommended)
npm run start:prod                       # Run compiled dist/
npm run build                            # Compile TypeScript → dist/
npm run lint                             # ESLint
npm run test                             # Jest unit tests
npm run migration:run                    # Apply pending migrations
npm run migration:revert                 # Revert last migration
npm run migration:generate -- -n Name   # Generate from entity changes
```

---

## Deployment

### Critical production env settings

```bash
NODE_ENV=production
DB_SYNCHRONIZE=false
DB_LOGGING=false
ACTIVATION_WEBHOOK_SECRET=<32-byte-hex-from-openssl>
```

### Build & start

```bash
npm run build
npm run migration:run
npm run start:prod
```

### Infrastructure

- Run behind a **reverse proxy** (nginx / AWS ALB) for TLS termination
- `/api/v1/internal/*` must be **network-restricted** — not reachable from the public internet, only from the Lex app's internal VPC
- `/api/v1/tally/sync/*` is public-facing (TDL plugin on customer machines)
- Production Redis: Sentinel or Cluster for HA
- Production PostgreSQL: SSL enabled, PgBouncer for connection pooling

---

## Security Checklist

- [x] API secrets stored as bcrypt hashes only
- [x] Raw secret shown once at activation, never retrievable
- [x] HMAC-SHA256 with timing-safe comparison on internal endpoints
- [x] `ValidationPipe` with `whitelist: true`
- [x] Helmet security headers
- [x] Rate limiting on all sync endpoints
- [x] Multi-tenant row isolation (`subscription_id` + `agency_id` + `client_id`)
- [x] Credential expiry enforced on every request
- [x] Old credentials auto-revoked on renewal
- [ ] `/internal/*` network-restricted (infrastructure level)
- [ ] HTTPS enforced at reverse proxy
- [ ] `npm audit` before each release

---

## Troubleshooting

**Migration fails with "relation already exists"**
Roll back with `migration:revert` then re-run, or drop + recreate the dev database.

**BullMQ jobs not processing**
Verify Redis is running. Check `REDIS_HOST` / `REDIS_PORT`. Check Bull dashboard at `http://localhost:3001`.

**`401 Invalid or expired API credentials`**
Check `is_active = true`, `expires_at > now()` in `api_credentials`, and `status = 'active'` in `subscriptions`. Also verify no trailing whitespace in the secret.

**`400 No active Tally connection found`**
Call `POST /tally/sync/connect` before any sync. Must be called once per plugin startup.

**`ACTIVATION_WEBHOOK_SECRET is not configured`**
The env variable is missing. Check `.env.local` is loaded and the variable is set.

---

## Roadmap

- [ ] Monitoring controller — sync history + error dashboard endpoints
- [ ] `/health` endpoint (DB + Redis liveness)
- [ ] Inventory masters sync
- [ ] Company masters sync
- [ ] Full sync mode (initial onboarding / historical data)
- [ ] Webhook back to Lex app on sync completion
- [ ] Future ERP connectors (Busy, Marg, Zoho Books, QuickBooks)

---

*This document is confidential and intended for internal use within the Lex platform team only.*
