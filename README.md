# lex-tally-sync-service

NestJS microservice bridging TallyPrime with the Lex SaaS platform.

---

## Architecture Overview

```
Lex App (existing)                    lex-tally-sync-service (this)
──────────────────                    ──────────────────────────────
User pays for plugin
        │
        ▼
POST /internal/activation/activate   ← HMAC-signed server-to-server call
        │                               (X-Lex-Signature header)
        ▼
  Create Subscription row             PostgreSQL
  Generate api_key + api_secret       (own DB, no shared schema)
        │
        ▼
Return { apiKey, apiSecret, expiresAt }
        │
        ▼
Existing app shows credentials to user once


TDL Plugin (on customer's machine)
───────────────────────────────────
POST /tally/sync/connect              ← Register Tally company + device
POST /tally/sync/voucher              ← Push single voucher
POST /tally/sync/ledgers              ← Push ledger batch
    All requests: X-API-Key + X-API-Secret
        │
        ▼
ApiKeyGuard validates key+secret → checks subscription is active + not expired
        │
        ▼
SyncService enqueues BullMQ job       Redis
        │
        ▼
SyncProcessor consumes job
  → NormalizationService maps Tally fields → Lex schema
  → Upsert Voucher / Ledger in PostgreSQL (dedup key: sub+voucherNo+company)
  → Record SyncError on failure (with full payload for replay)
```

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Activation endpoint | HMAC-SHA256 (`X-Lex-Signature`) — internal Lex app only |
| TDL plugin endpoints | `X-API-Key` + `X-API-Secret` (bcrypt-hashed secret) |
| Secret storage | Raw secret shown **once** at activation; only bcrypt hash stored |
| Multi-tenancy | Every DB row scoped to `subscription_id` + `agency_id` + `client_id` |
| Expiry | Credential TTL mirrors subscription `expires_at`; guard checks on every request |

---

## Subscription Lifecycle

```
Payment confirmed in Lex app
        │
        ▼
POST /internal/activation/activate
        │
        ├─ New customer    → Create Subscription + ApiCredential
        └─ Renewal         → Extend expiry + rotate credentials (old ones revoked)
        │
        ▼
Credentials returned: { apiKey, apiSecret, expiresAt }
        │
Stored in Lex app → shown to customer once
        │
        ▼
Customer configures TDL plugin with apiKey + apiSecret
        │
        ▼
Plugin syncs data until expiresAt
        │
        ▼
POST /internal/activation/deactivate  (on refund / cancellation)
→ Subscription status = revoked
→ All credentials isActive = false
→ Next sync request returns 401
```

---

## PostgreSQL Schema (key tables)

```
subscriptions          api_credentials         tally_connections
─────────────          ───────────────         ─────────────────
id (uuid PK)           id (uuid PK)            id (uuid PK)
customer_id  ◄────────  subscription_id (FK)   subscription_id (FK)
agency_id               api_key (unique)        credential_id (FK)
client_id               api_secret_hash         tally_company_id
status                  api_secret_prefix       tally_company_name
plan_duration_days      is_active               device_id
activated_at            expires_at              is_active
expires_at              last_used_at            last_sync_at
payment_reference

vouchers               ledgers                 sync_errors
────────               ───────                 ───────────
id (uuid)              id (uuid)               id (uuid)
subscription_id        subscription_id         subscription_id
agency_id              agency_id               sync_type
client_id              client_id               payload (jsonb)
voucher_number         ledger_name             error_message
voucher_type           group_name              stack_trace
voucher_date           closing_balance         attempts
amount                 balance_type            failed_at
raw_data (jsonb)       raw_data (jsonb)
```

---

## Getting Started

```bash
# 1. Start local dependencies
docker-compose up -d

# 2. Copy env
cp .env.example .env.local
# → Edit DB_PASSWORD, ACTIVATION_WEBHOOK_SECRET

# 3. Install dependencies
npm install

# 4. Run migrations
npm run build && npm run migration:run

# 5. Start dev server
npm run start:dev
```

**Swagger docs**: http://localhost:3100/docs (dev only)
**Bull dashboard**: http://localhost:3001

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DB_*` | PostgreSQL connection |
| `REDIS_*` | Redis for BullMQ |
| `ACTIVATION_WEBHOOK_SECRET` | HMAC secret shared with Lex app |
| `API_SECRET_SALT_ROUNDS` | bcrypt cost factor (default: 12) |
| `SYNC_QUEUE_CONCURRENCY` | Workers per job type (default: 10) |
| `SYNC_JOB_ATTEMPTS` | BullMQ retry count (default: 3) |

---

## Key Design Decisions

**Why its own PostgreSQL (not shared DB)?**
Shared DB creates tight coupling and deployment risk between services. This service owns its schema and scales independently. The only shared identifier is `customer_id` from the Auth Service — no foreign keys across service boundaries.

**Why api_key + api_secret (not JWT forwarding)?**
The TDL plugin is a desktop app running on-premise. Long-lived key+secret pairs are simpler to configure, rotate, and audit than JWTs. The existing Auth Service already validated the user when they paid — this service doesn't need to re-do that on every voucher sync.

**Why bcrypt for api_secret?**
If the DB is compromised, raw secrets aren't exposed. bcrypt's deliberate slowness is acceptable at activation time; the guard path uses the fast `api_key` index lookup first, then bcrypt.compare only on a matching active credential.

**Why JSONB `raw_data` column?**
Tally's schema evolves. Storing the full raw payload means we can re-normalize historical data without re-syncing from Tally when our mapping changes.
