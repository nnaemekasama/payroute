-- PayRoute Initial Schema (idempotent — safe to re-run)
-- Enforces: double-entry bookkeeping, transaction state machine, idempotency

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255)    NOT NULL,
  currency        CHAR(3)         NOT NULL,
  balance         NUMERIC(18,4)   NOT NULL DEFAULT 0 CHECK (balance >= 0),
  ledger_balance  NUMERIC(18,4)   NOT NULL DEFAULT 0,
  version         INTEGER         NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE(name, currency)
);

-- ============================================================
-- IDEMPOTENCY KEYS
-- ============================================================
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  key             VARCHAR(255)    NOT NULL UNIQUE,
  method          VARCHAR(10)     NOT NULL,
  path            VARCHAR(255)    NOT NULL,
  request_hash    VARCHAR(64)     NOT NULL,
  response_status INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ     NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON idempotency_keys(expires_at);

-- ============================================================
-- FX QUOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS fx_quotes (
  id                        UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  source_currency           CHAR(3)         NOT NULL,
  destination_currency      CHAR(3)         NOT NULL,
  rate                      NUMERIC(18,8)   NOT NULL,
  source_amount             NUMERIC(18,4)   NOT NULL,
  destination_amount        NUMERIC(18,4)   NOT NULL,
  expires_at                TIMESTAMPTZ     NOT NULL,
  is_locked                 BOOLEAN         NOT NULL DEFAULT FALSE,
  locked_by_transaction_id  UUID,
  created_at                TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fx_quotes_expires_at ON fx_quotes(expires_at);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key_id    UUID            UNIQUE REFERENCES idempotency_keys(id),
  sender_account_id     UUID            NOT NULL REFERENCES accounts(id),
  recipient_account_id  UUID            NOT NULL REFERENCES accounts(id),
  source_amount         NUMERIC(18,4)   NOT NULL,
  source_currency       CHAR(3)         NOT NULL,
  destination_amount    NUMERIC(18,4)   NOT NULL,
  destination_currency  CHAR(3)         NOT NULL,
  fx_quote_id           UUID            REFERENCES fx_quotes(id),
  status                VARCHAR(20)     NOT NULL DEFAULT 'initiated'
                        CHECK (status IN ('initiated','funds_locked','processing','completed','failed','reversed')),
  provider_reference    VARCHAR(255)    UNIQUE,
  failure_reason        TEXT,
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);

-- Add FK from fx_quotes back to transactions (idempotent with DO NOTHING on conflict)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_fx_quotes_transaction'
  ) THEN
    ALTER TABLE fx_quotes
      ADD CONSTRAINT fk_fx_quotes_transaction
      FOREIGN KEY (locked_by_transaction_id) REFERENCES transactions(id);
  END IF;
END $$;

-- ============================================================
-- LEDGER ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID            NOT NULL REFERENCES transactions(id),
  account_id      UUID            NOT NULL REFERENCES accounts(id),
  entry_type      VARCHAR(10)     NOT NULL CHECK (entry_type IN ('debit','credit')),
  amount          NUMERIC(18,4)   NOT NULL CHECK (amount > 0),
  currency        CHAR(3)         NOT NULL,
  description     VARCHAR(255),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_transaction_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account_id ON ledger_entries(account_id);

-- ============================================================
-- WEBHOOK EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            VARCHAR(255)    NOT NULL UNIQUE,
  event_type          VARCHAR(50)     NOT NULL,
  provider_reference  VARCHAR(255)    NOT NULL,
  raw_payload         JSONB           NOT NULL,
  signature           TEXT            NOT NULL,
  processed           BOOLEAN         NOT NULL DEFAULT FALSE,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TRANSACTION STATE MACHINE TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_transaction_state_machine()
RETURNS TRIGGER AS $$
DECLARE
  valid_transitions JSONB := '{
    "initiated": ["funds_locked", "failed"],
    "funds_locked": ["processing", "failed"],
    "processing": ["completed", "failed"],
    "failed": ["reversed"],
    "completed": ["reversed"],
    "reversed": []
  }';
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (valid_transitions->OLD.status) @> to_jsonb(NEW.status) THEN
    RAISE EXCEPTION 'Invalid status transition from % to %', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotent trigger creation
DROP TRIGGER IF EXISTS trg_transaction_state_machine ON transactions;
CREATE TRIGGER trg_transaction_state_machine
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_transaction_state_machine();

-- ============================================================
-- SEED DATA (idempotent — only inserts if accounts table is empty)
-- ============================================================
-- Balances reflect state AFTER the seeded transactions below:
-- Sender NGN: 500000 - 160000 (completed) - 80000 (processing locked) = 260000
-- Global Supplies USD: 0 + 100 (completed settlement) = 100
INSERT INTO accounts (id, name, currency, balance, ledger_balance) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Acme Nigeria Ltd',   'NGN', 260000.0000, 260000.0000),
  ('a0000000-0000-0000-0000-000000000002', 'Acme Nigeria Ltd',   'USD', 0.0000, 0.0000),
  ('a0000000-0000-0000-0000-000000000003', 'Global Supplies Co', 'USD', 100.0000, 100.0000),
  ('a0000000-0000-0000-0000-000000000004', 'Euro Parts GmbH',   'EUR', 0.0000, 0.0000),
  ('a0000000-0000-0000-0000-000000000005', 'UK Materials Ltd',   'GBP', 0.0000, 0.0000)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED TRANSACTIONS (idempotent — ON CONFLICT DO NOTHING)
-- Provides realistic demo data: 1 completed, 1 processing, 1 failed+reversed
-- ============================================================

-- FX Quotes for seeded transactions
INSERT INTO fx_quotes (id, source_currency, destination_currency, rate, source_amount, destination_amount, expires_at, is_locked, locked_by_transaction_id) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'NGN', 'USD', 0.00062500, 160000.0000, 100.0000, NOW() + interval '5 minutes', TRUE, NULL),
  ('f0000000-0000-0000-0000-000000000002', 'NGN', 'USD', 0.00063100, 80000.0000, 50.4800, NOW() + interval '5 minutes', TRUE, NULL),
  ('f0000000-0000-0000-0000-000000000003', 'NGN', 'EUR', 0.00057500, 50000.0000, 28.7500, NOW() + interval '5 minutes', TRUE, NULL)
ON CONFLICT DO NOTHING;

-- Seeded transactions
INSERT INTO transactions (id, sender_account_id, recipient_account_id, source_amount, source_currency, destination_amount, destination_currency, fx_quote_id, status, provider_reference, failure_reason, created_at, updated_at, completed_at) VALUES
  (
    'b0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000003',
    160000.0000, 'NGN', 100.0000, 'USD',
    'f0000000-0000-0000-0000-000000000001',
    'completed', 'PRV-SEED-001', NULL,
    NOW() - interval '2 hours', NOW() - interval '1 hour 55 minutes', NOW() - interval '1 hour 55 minutes'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000003',
    80000.0000, 'NGN', 50.4800, 'USD',
    'f0000000-0000-0000-0000-000000000002',
    'processing', 'PRV-SEED-002', NULL,
    NOW() - interval '30 minutes', NOW() - interval '29 minutes', NULL
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000004',
    50000.0000, 'NGN', 28.7500, 'EUR',
    'f0000000-0000-0000-0000-000000000003',
    'reversed', NULL, 'Provider temporarily unavailable',
    NOW() - interval '1 hour', NOW() - interval '58 minutes', NULL
  )
ON CONFLICT DO NOTHING;

-- Back-link fx_quotes to their transactions
UPDATE fx_quotes SET locked_by_transaction_id = 'b0000000-0000-0000-0000-000000000001' WHERE id = 'f0000000-0000-0000-0000-000000000001' AND locked_by_transaction_id IS NULL;
UPDATE fx_quotes SET locked_by_transaction_id = 'b0000000-0000-0000-0000-000000000002' WHERE id = 'f0000000-0000-0000-0000-000000000002' AND locked_by_transaction_id IS NULL;
UPDATE fx_quotes SET locked_by_transaction_id = 'b0000000-0000-0000-0000-000000000003' WHERE id = 'f0000000-0000-0000-0000-000000000003' AND locked_by_transaction_id IS NULL;

-- Ledger entries for seeded transactions (double-entry pairs)

-- Transaction 1 (completed): fund lock debit/credit + settlement debit/credit
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, currency, description) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'debit',  160000.0000, 'NGN', 'Fund lock for payment'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'credit', 160000.0000, 'NGN', 'Fund lock for payment'),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'debit',  100.0000,    'USD', 'Settlement credit'),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'credit', 100.0000,    'USD', 'Settlement credit')
ON CONFLICT DO NOTHING;

-- Transaction 2 (processing): fund lock debit/credit only (not yet settled)
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, currency, description) VALUES
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'debit',  80000.0000, 'NGN', 'Fund lock for payment'),
  ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'credit', 80000.0000, 'NGN', 'Fund lock for payment')
ON CONFLICT DO NOTHING;

-- Transaction 3 (reversed): fund lock debit/credit + reversal debit/credit
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, currency, description) VALUES
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'debit',  50000.0000, 'NGN', 'Fund lock for payment'),
  ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'credit', 50000.0000, 'NGN', 'Fund lock for payment'),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'debit',  50000.0000, 'NGN', 'Reversal - funds returned to sender'),
  ('e0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'credit', 50000.0000, 'NGN', 'Reversal - funds returned to sender')
ON CONFLICT DO NOTHING;
