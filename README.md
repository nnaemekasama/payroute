# PayRoute — Cross-Border Payment Processing Service

PayRoute enables Nigerian businesses to send payments to international suppliers. It implements the full payment lifecycle with double-entry bookkeeping, idempotent operations, and FX quote management.

## Architecture

```
Client Request → Validate → Lock Funds → Quote FX → Submit to Provider → Await Webhook → Settle or Reverse
```

### Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: React (Vite)
- **Database**: PostgreSQL 16
- **Infrastructure**: Docker + docker-compose
- **Testing**: Jest

## Quick Start

### Prerequisites

- Docker and docker-compose installed
- Node.js 20+ (for local development without Docker)

### Running with Docker

```bash
# Copy environment file
cp .env.example .env

# Start all services
docker-compose up --build
```

Services will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **PostgreSQL**: localhost:5432

### Running Locally (without Docker)

You need PostgreSQL running and a `.env` file in the `backend` folder before starting the backend. **Never commit `.env`** — it is gitignored. Use strong, unique values for production.

#### 1. Create backend environment file

```bash
cd backend
cp .env.example .env
# Edit .env if your Postgres user/password differ (default: postgres/postgres)
```

#### 2. Start PostgreSQL

**Option A — Use Docker just for Postgres (easiest on Windows):**

```bash
docker run --name payroute-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=payroute \
  -p 5432:5432 \
  -d postgres:15
```

Then run the backend with `npm run dev` (see step 3). Your `backend/.env` should use:

`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/payroute`

**Option B — Full stack with docker-compose:**

```bash
# From project root
docker-compose up
```

This starts Postgres, backend, and frontend. No need to run the backend manually.

**Option C — Local PostgreSQL installed on Windows:**

- Start the PostgreSQL service (e.g. from Services or pgAdmin).
- Create a database named `payroute` (e.g. `createdb -U postgres payroute` or via pgAdmin).
- Set `DATABASE_URL` in `backend/.env` to match your user/password and host/port.

#### 3. Backend

```bash
cd backend
npm install
npm start
# or, with auto-reload: npm run dev
```

#### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

### Running Tests

Tests require a running PostgreSQL instance and `backend/.env` (or set `DATABASE_URL`):

```bash
cd backend
npm test
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /payments | Create a new payment (requires `Idempotency-Key` header) |
| GET | /payments/:id | Get payment details with ledger entries |
| GET | /payments | List payments (paginated, filterable) |
| POST | /webhooks/provider | Receive webhook from payment provider |
| GET | /accounts | List all accounts |
| GET | /health | Health check |

### Example: Create a Payment

```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "sender_account_id": "a0000000-0000-0000-0000-000000000001",
    "recipient_account_id": "a0000000-0000-0000-0000-000000000003",
    "amount": 1600000,
    "source_currency": "NGN",
    "destination_currency": "USD"
  }'
```

### Example: Simulate a Webhook

```bash
BODY='{"event_type":"payment.completed","reference":"PRV-XXXXX","status":"completed","amount":1000,"currency":"USD"}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "whsec_test_secret_key_for_hmac" | awk '{print $2}')

curl -X POST http://localhost:3000/webhooks/provider \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIGNATURE" \
  -H "X-Webhook-Event-Id: evt-001" \
  -d "$BODY"
```

## Seed Data

The migration seeds five demo accounts:

| Name | Currency | Initial Balance |
|------|----------|----------------|
| Acme Nigeria Ltd | NGN | 50,000,000 |
| Acme Nigeria Ltd | USD | 0 |
| Global Supplies Co | USD | 0 |
| Euro Parts GmbH | EUR | 0 |
| UK Materials Ltd | GBP | 0 |

## Key Design Decisions

- **Double-entry bookkeeping**: Every balance change goes through matched ledger entries. No direct balance updates.
- **Optimistic concurrency**: Account balance updates use a `version` column to prevent overdrafts under concurrent payments.
- **DB-level state machine**: A PostgreSQL trigger enforces valid transaction status transitions.
- **Idempotency**: POST /payments uses DB-level unique constraints + SELECT FOR UPDATE to serialize concurrent duplicate requests.
- **Webhook idempotency**: Events are deduplicated by `event_id` using INSERT ON CONFLICT within the same transaction as ledger writes.
- **HMAC-SHA256 verification**: Webhook signatures are verified using timing-safe comparison on the raw request body.
