# Schema Design

## 1. Why this structure over alternatives

**Separate `ledger_entries`:** Every balance change is recorded as debit/credit pairs in `ledger_entries`, giving an immutable audit trail. We never update `accounts.balance` without a corresponding ledger insert (`ledgerService.js`: `insertPair` plus account model debit/credit).

**Transactions vs ledger_entries:** A transaction is the business event; ledger_entries are the accounting records. One payment can have multiple pairs (e.g. lock in source currency, settlement in destination). Separate tables keep queries simple and let us enforce “sum of entries = 0” per transaction.

**`webhook_events` stores raw payload first:** In `webhookProcessor.js` we insert (event_id, raw_payload, signature) before processing. If we crash or the transaction isn’t found, we still have the exact payload for replay and reconciliation.

**`idempotency_keys` as its own table:** Idempotency is request-scoped (key, request_hash, cached response). A separate table keeps that concern out of `transactions` and lets us expire keys and cache responses without touching payment rows.

## 2. How we ensure no money is created or destroyed

**All balance changes go through ledger_entries.** The account model’s debit/credit helpers are only called from `ledgerService` in the same flow as `ledgerEntryModel.insertPair`. No bare `UPDATE accounts SET balance = ...` exists outside that path.

**Double-entry:** We insert matched debit/credit pairs (same amount, same currency). The sum of entries per transaction is zero. Seed data in `001_initial_schema.sql` shows this (e.g. transaction 1: NGN lock pair, USD settlement pair).

**Database transactions:** `withTransaction` in `db/transaction.js` wraps webhook and payment flows in BEGIN/COMMIT/ROLLBACK. A failed step rolls back the whole unit; no partial application.

## 3. Adding a new currency pair in production

No schema change: currencies are `CHAR(3)` in `accounts` and `ledger_entries`. Steps: add the pair to the FX provider config; create accounts in the new currency; add to compliance/allow-lists; run a test payment; monitor for ledger imbalances (sum of entries per currency = 0) in the first 24 hours.

## 4. One thing I would do differently

**Reconciliation job for ledger integrity.** I’d add a periodic check that sums `ledger_entries` by currency (debits negative, credits positive); any non-zero total would alert. That would catch bugs or partial writes that leave the ledger out of balance despite correct application logic.
