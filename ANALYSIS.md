# PayRoute Take-Home — Technical Analysis

This document reviews the provided webhook handler, maps failure scenarios to our implementation, and outlines production readiness. All references are to code in this repository.

---

# PART 4A: CODE REVIEW

The following handler has multiple critical flaws. For each: the problem, why it matters in payments, the fix, and how we handle it in `backend/src/routes/webhooks.js` and related code.

## 1. Signature checked for presence but never verified

**Problem:** The code only checks that `x-webhook-signature` exists. It never computes HMAC-SHA256 over the request body and compares it to the header. Any caller can forge a webhook by sending a valid-looking JSON body and any string in the header.

**Why it matters in payments:** An attacker could POST `status: 'completed'` and a fake `reference` that matches a real transaction (or brute-force references), and your system would credit the recipient. That is unauthorized settlement and direct financial loss.

**Fix:**

```javascript
const crypto = require('crypto');
const rawBody = req.rawBody || JSON.stringify(req.body); // must be exact body used for signing
const expected = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(rawBody).digest('hex');
if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
  return res.status(401).json({ error: 'Invalid webhook signature' });
}
```

**Our implementation:** `backend/src/middleware/webhookSignature.js` computes HMAC-SHA256 over `req.rawBody` (or fallback `JSON.stringify(req.body)`), then compares with `crypto.timingSafeEqual`. The route in `webhooks.js` is protected by this middleware before the handler runs.

---

## 2. Returns 404 for unknown transaction

**Problem:** When no row is found for `payload.reference`, the handler returns `404 Not Found`.

**Why it matters in payments (not just style):** Providers retry on non-2xx. If you return 404 because the transaction isn’t committed yet (webhook arrived first) or the reference is wrong, the provider will keep retrying. When the transaction finally exists, the same webhook may be processed again. You’ve turned a “not found” into a retry loop that can cause double-processing. In payments, webhook endpoints must accept the event and return 200 so the provider stops retrying; idempotency and idempotent processing handle duplicates.

**Fix:** Always return 200 after receiving the webhook. Log the event. If the transaction isn’t found, store the event for later reconciliation and respond 200.

```javascript
if (!transaction.rows[0]) {
  await db.query('INSERT INTO webhook_events (event_id, reference, raw_payload) VALUES ($1, $2, $3)', [eventId, payload.reference, payload]);
  return res.status(200).json({ received: true });
}
```

**Our implementation:** In `backend/src/services/webhookProcessor.js`, when `findByProviderReference` returns null we still call `webhookEventModel.markProcessed(client, event.id)` and return — we do not surface an error to the client. The HTTP handler in `webhooks.js` always responds with `200` and `{ received: true }`. The event is already stored with the raw payload in `webhook_events` before we look up the transaction (`insertIfNew` then `findByProviderReference`), so we have an audit trail even when the transaction is missing.

---

## 3. No database transaction around UPDATEs

**Problem:** The handler runs several queries in sequence with no `BEGIN`/`COMMIT`. If the process crashes after updating the transaction to `completed` but before crediting the account (or vice versa), the system is left inconsistent: status says completed but balance wasn’t updated, or balance was updated but status wasn’t.

**Why it matters in payments:** Partial application of a webhook creates unreconcilable ledger/status mismatches and potential double-credit if the webhook is retried.

**Fix:** Wrap all reads and writes for a single webhook in one database transaction; commit only after every step succeeds.

```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // ... all SELECTs and UPDATEs using client ...
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

**Our implementation:** `webhookProcessor.js` runs the entire webhook flow inside `withTransaction(client => { ... })` (see `backend/src/db/transaction.js`). Insert event, find transaction, call `processWebhookEvent` (which does ledger and status updates), mark event processed — all use the same `client`. Commit only on success; rollback on any error.

---

## 4. No idempotency check

**Problem:** The same webhook can be delivered more than once (retries, duplicates). Each time, the code runs the same UPDATEs again. A second “completed” webhook would credit the recipient again; a second “failed” would credit the sender again. That’s double-credit or double-reversal.

**Why it matters in payments:** Double-credit is direct loss; double-reversal can over-credit the sender. Idempotency is mandatory for any webhook that changes money or status.

**Fix:** Before applying any business logic, record the webhook event by a unique provider event id. If the insert fails (unique violation), treat as already processed and return 200 without applying changes.

```javascript
const eventId = req.headers['x-webhook-event-id'];
const inserted = await client.query(
  'INSERT INTO webhook_events (event_id, ...) VALUES ($1, ...) ON CONFLICT (event_id) DO NOTHING RETURNING id',
  [eventId, ...]
);
if (inserted.rows.length === 0) return res.status(200).json({ received: true });
```

**Our implementation:** `webhookEventModel.insertIfNew` in `backend/src/models/webhookEvent.js` does `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING *`. If the row already exists, we get no row back and `processWebhookPayload` returns early without updating the transaction or ledger. Every webhook is keyed by `event_id`; duplicates are ignored.

---

## 5. Uses payload.amount for credit instead of locked transaction amount

**Problem:** On completion, the code credits `payload.amount` to the recipient. The provider could send a different amount than the one you locked at initiation. You’d be crediting whatever the provider says, not the amount you agreed with the user and locked.

**Why it matters in payments:** You must settle for the amount you locked (and possibly the amount the user agreed to), not the amount in the webhook. Otherwise a compromised or buggy provider could inflate payouts.

**Fix:** Load the transaction by `payload.reference` and use the transaction’s stored amounts (e.g. `transaction.destination_amount`) for all balance and ledger updates.

**Our implementation:** In `paymentService.processWebhookEvent` (`backend/src/services/paymentService.js`), we pass the loaded `transaction` and use `transaction.destination_amount` and `transaction.destination_currency` for settlement (and `transaction.source_amount` / `transaction.source_currency` for reversal). `ledgerService.settlePayment` and `reverseFunds` receive these from the transaction row, not from the payload.

---

## 6. Direct balance update instead of ledger entries

**Problem:** The handler does `UPDATE accounts SET balance = balance + $1 WHERE id = $2`. There is no corresponding row in a ledger. Balance changes are invisible and unauditable.

**Why it matters in payments:** Regulators and auditors require an immutable record of every movement of money. Double-entry ledger entries (debit/credit pairs per event) provide that. Direct balance updates create “invisible” money and break reconciliation.

**Fix:** Never update `accounts.balance` without inserting a matched debit/credit pair in a `ledger_entries` table, and keep balance and ledger in sync inside the same transaction.

**Our implementation:** All balance changes go through `ledgerService` (`backend/src/services/ledgerService.js`). `lockFunds`, `settlePayment`, and `reverseFunds` call `ledgerEntryModel.insertPair` to create debit and credit rows, and use `accountModel.debit` / `creditForUpdate` / `debitForUpdate` so that `accounts.balance` and `ledger_balance` are updated only in tandem with those inserts. There is no direct `UPDATE accounts SET balance = ...` outside this path.

---

## 7. No state machine enforcement

**Problem:** The code sets `status = 'completed'` or `status = 'failed'` without checking the current status. You could “complete” an already completed transaction again (see idempotency) or move from `failed` back to `completed`, etc.

**Why it matters in payments:** Invalid status transitions can leave the system in an inconsistent or ambiguous state and make dispute resolution and auditing impossible.

**Fix:** Enforce allowed transitions in code or DB. Only allow e.g. `processing` → `completed` or `processing` → `failed`. Reject or no-op invalid transitions and still return 200.

**Our implementation:** `backend/src/db/migrations/001_initial_schema.sql` defines a trigger `enforce_transaction_state_machine()` on `transactions`. The trigger allows only specific transitions (e.g. `processing` → `completed` or `failed`). Any invalid transition raises an exception and the transaction is rolled back. Status updates go through `transactionModel.updateStatus`, so every update is validated by the trigger.

---

## 8. No raw webhook logging before processing

**Problem:** If processing fails after you’ve started applying changes, or before you’ve looked up the transaction, you have no record of the original webhook body. You can’t replay or debug.

**Why it matters in payments:** You need an immutable record of every event the provider sent, for reconciliation, dispute resolution, and compliance.

**Fix:** Before any business logic, persist the raw body (and event id, signature, timestamp) to a `webhook_events` (or similar) table. Then process. If processing fails, the event is still stored for retry or manual review.

**Our implementation:** In `webhookProcessor.js`, the first step inside the transaction is `webhookEventModel.insertIfNew` with `rawPayload: payload` and the signature. So we always persist the full payload (and event id, type, reference) before we look up the transaction or change any balances. The table is `webhook_events` with `raw_payload` JSONB and `signature` (see `backend/src/db/migrations/001_initial_schema.sql`).

---

## 9. SELECT * exposes all columns unnecessarily

**Problem:** `SELECT * FROM transactions WHERE provider_reference = $1` returns every column. It’s a minor information-leak and maintenance risk (new columns are always exposed to the handler).

**Why it matters in payments:** Handlers should depend only on the fields they need. Extra columns can accidentally be logged or forwarded and can make the code brittle when the schema evolves.

**Fix:** Select only the columns needed for the webhook logic, e.g. `id, sender_account_id, recipient_account_id, source_amount, source_currency, destination_amount, destination_currency, status`.

**Our implementation:** We do use `SELECT *` in `transactionModel.findByProviderReference` (`backend/src/models/transaction.js`). The returned row is passed into `processWebhookEvent`, which only uses specific fields (ids, amounts, currencies). So we don’t over-expose in the API, but we could tighten the model to an explicit column list for clarity and future safety.

---

## 10. No input validation on payload fields

**Problem:** The code uses `payload.reference`, `payload.status`, `payload.amount` without checking type, presence, or allowed values. Malformed or malicious payloads can cause crashes, SQL issues, or unexpected behavior (e.g. undefined amount).

**Why it matters in payments:** Invalid input can lead to exceptions (and 500s that trigger retries), or worse, to misinterpreted data (e.g. wrong account or amount) if the payload is partially valid.

**Fix:** Validate before use: require `payload.reference` (string), `payload.status` in `['completed', 'failed']`, and optionally validate amount/currency format. Return 200 with no side effects for invalid payloads so the provider doesn’t retry forever.

**Our implementation:** We don’t have strict validation on the webhook payload in the handler. We rely on `payload.reference` and `payload.status`; `processWebhookEvent` only acts on `completed` and `failed` and ignores unknown statuses. For production we would add explicit validation (and possibly schema validation) and still return 200 for invalid payloads after logging.

---

# PART 4B: FAILURE SCENARIOS

## Scenario 1: Double-spend

Two concurrent POST /payments with different idempotency keys, same sender account, balance sufficient for only one.

**What happens in our system:** Each request gets its own idempotency key row (`backend/src/middleware/idempotency.js`: `INSERT INTO idempotency_keys ... ON CONFLICT (key) DO NOTHING`), so both proceed to `paymentService.initiatePayment`. Inside `withTransaction`, we load the sender with `accountModel.findById`, then call `ledgerService.lockFunds`. In `lockFunds` (`backend/src/services/ledgerService.js`) we call `accountModel.debit(senderAccountId, amount, sender.version, client)`. The debit uses optimistic concurrency: `UPDATE accounts SET balance = balance - $1, ... WHERE id = $2 AND version = $3 AND balance >= $1`. The first request commits; the second’s UPDATE no longer matches (version or balance already changed), so it returns no row. We retry (up to `MAX_RETRIES`); on the next attempt we refetch the sender — balance is now lower — and the balance check fails. We throw `InsufficientFundsError` and the transaction rolls back.

**Outcome:** One payment succeeds; the other fails with a 422-style error (insufficient funds). No overdraft.

**Gap:** We use optimistic locking (version) rather than `SELECT FOR UPDATE` on the account. Under high contention the second request may retry several times before failing. With `FOR UPDATE` we could block the second request until the first releases the lock, reducing retries. For a take-home the current approach is correct and avoids double-spend.

---

## Scenario 2: Webhook arrives before POST /payments commits

The provider sends the webhook before our handler has committed the transaction (and thus before `provider_reference` exists in the DB).

**What happens:** The webhook hits `POST /webhooks/provider`. Signature is verified in `webhookSignature.js`. The handler calls `processWebhookPayload`. Inside the transaction we insert the event into `webhook_events` (so we have the raw payload and event_id). Then we call `transactionModel.findByProviderReference(payload.reference, client)` — no row is found because the payment transaction isn’t committed yet. We call `webhookEventModel.markProcessed(client, event.id)` and return without updating any transaction or balance. The HTTP response is 200.

**Why 200 is correct:** If we returned 4xx or 5xx, the provider would retry. Once our payment commits, a retry would find the transaction and process the same event again. By returning 200 we tell the provider “accepted”; they won’t retry, and we avoid double-processing. Idempotency is still required for the rare case where they do retry.

**Gap:** The event is marked `processed = true` even though we didn’t apply it to a transaction. So we never automatically reprocess it. In production we would either: (1) not mark it processed when the transaction is missing and run a reconciliation job that finds `webhook_events` with `processed = false` and retries by reference, or (2) mark it processed but have a separate job that matches unprocessed references to transactions created after the event and applies them once.

---

## Scenario 3: FX rate stale

User gets a quote, waits 10 minutes, then submits. Quote has a 5-minute expiry; market moved 3%.

**What happens:** In `paymentService.initiatePayment` we call `fxService.fetchQuote` (new quote) then `fxService.lockQuote(client, quote.id, txn.id)`. In `backend/src/models/fxQuote.js`, `lockForTransaction` does `UPDATE fx_quotes SET is_locked = TRUE, locked_by_transaction_id = $1 WHERE id = $2 AND expires_at > NOW() AND is_locked = FALSE`. If the quote is older than 5 minutes, `expires_at > NOW()` is false, the UPDATE affects 0 rows, and we get `null`. We then throw `UnprocessableError('FX quote expired or already used')` and the client receives 422. The user must request a new quote and resubmit.

**Why not silently using the old rate:** Using an expired rate would mean settling at a rate different from what we locked and possibly from what the user saw. The business could systematically lose money on FX and face regulatory and fairness issues. Rejecting stale quotes forces a fresh rate and explicit user action.

---

## Scenario 4: Partial settlement (provider says completed, recipient bank rejects later)

**What happens today:** Our transaction is already `completed` and we’ve written settlement ledger entries (debit transit, credit recipient). We don’t model post-settlement bank rejections.

**How to model it:** Treat the rejection as a new event, not an edit of the original transaction. Add a reversal transaction of type `reversal` (or similar) with e.g. `parent_transaction_id` pointing to the original. Create compensating ledger entries: debit recipient, credit transit (or escrow). The original transaction stays `completed` so the audit trail is unchanged. The reversal has its own lifecycle (e.g. initiated → processing → reversed) and its own ledger rows. We never mutate a completed transaction’s status or ledger — that keeps the history immutable and auditable.

---

## Scenario 5: Provider timeout

HTTP call to submit payment times out after 30s; we don’t know if the provider received it.

**What happens today:** In `paymentService.initiatePayment`, we call `providerService.submitPayment`. If it throws (e.g. timeout), we catch, reverse the fund lock, set status to `failed` then `reversed`, and return. So we treat any provider error as definite failure and don’t leave the transaction in `processing`. That’s safe but can be wrong: if the provider actually received the request and will send a “completed” webhook, we’ve already reversed and the later webhook will hit a transaction that’s already `reversed`; the state machine will reject a transition to `completed`, and we’d need manual reconciliation.

**Production approach:** When the outcome is unknown (e.g. timeout), leave the transaction in `processing` instead of reversing immediately. (1) Send an idempotency key (or correlation id) to the provider on every submission so retries are deduplicated. (2) Run a background job that finds transactions stuck in `processing` for more than N minutes and calls the provider’s GET /payments/:reference (or equivalent) to reconcile status. (3) Retry with exponential backoff; after max retries, move to a dead-letter state for manual review. We have `resolveStuckTransactions` on startup that simulates webhooks for stuck processing transactions; in production that would be replaced or supplemented by a real reconciliation call to the provider.

---

# PART 4C: PRODUCTION READINESS

## 1. Distributed idempotency under horizontal scaling

**Why it matters:** With multiple instances, two requests with the same idempotency key can pass the “have we seen this key?” check at the same time before either commits. Without a single source of truth, both could create the payment and double-debit the sender.

**Implementation:** Use the database as the single source of truth. Our idempotency middleware (`backend/src/middleware/idempotency.js`) does `INSERT INTO idempotency_keys (key, method, path, request_hash, expires_at) ... ON CONFLICT (key) DO NOTHING RETURNING id`. Only one instance can insert a given key; the others get 0 rows. For existing keys we do `SELECT ... FROM idempotency_keys WHERE key = $1 FOR UPDATE` so we block until the first request commits and then return the cached response. The unique constraint on `key` plus the transaction guarantees exactly-once processing per key across instances.

**What breaks without it:** Under a load balancer, duplicate keys can be processed twice, leading to double charges or double credits.

---

## 2. Webhook signature verification with timing-safe comparison

**Why it matters:** A naive `signature === expected` comparison can short-circuit as soon as the first differing character is found. An attacker can measure response time to infer the correct signature byte-by-byte and eventually forge webhooks.

**Implementation:** In `backend/src/middleware/webhookSignature.js` we compute the expected HMAC and then compare with `crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))` after ensuring equal length. Comparison time is independent of where the strings differ.

**What breaks without it:** Forged webhooks could be accepted, leading to unauthorized settlements.

---

## 3. Database connection pool exhaustion and query timeouts

**Why it matters:** A slow or stuck query holds a connection. If many requests hit slow queries, the pool is exhausted and new requests wait or fail. The whole service can appear down.

**Implementation:** Configure the pg pool with a bounded `max` and `idleTimeoutMillis`. Set `statement_timeout` (or pass it per query) so no query runs indefinitely. Use a single isolation level (e.g. READ COMMITTED) consistently. Optionally add middleware that sets a query timeout or aborts the request after a deadline.

**What breaks without it:** One bad query or a burst of slow ones can exhaust the pool and cause cascading timeouts across the app.

---

## 4. Audit log immutability

**Why it matters:** If ledger rows or status history can be updated or deleted, the financial trail can be altered. That fails regulatory audits and makes disputes unresolvable.

**Implementation:** Treat ledger_entries (and any status_history table) as append-only. No UPDATE or DELETE. Enforce via PostgreSQL triggers that RAISE on UPDATE/DELETE of those tables, or via row-level security. Our code only inserts into `ledger_entries` and never updates or deletes; we don’t yet have DB-level enforcement.

**What breaks without it:** Accidental or malicious changes to past entries invalidate the audit trail and compliance posture.

---

## 5. Structured logging and transaction tracing

**Why it matters:** In production, support and ops need to trace a single payment across services and logs. Ad-hoc `console.log` without correlation ids or structured fields makes that impossible.

**Implementation:** Use a structured logger (e.g. pino or winston) with JSON output. Add middleware that generates a request-scoped ID (e.g. UUID) per request and attaches it to the logger context. Every log line should include that ID plus relevant identifiers (transaction_id, idempotency_key, account_id) when available. In distributed setups, propagate the same request_id to outbound calls.

**What breaks without it:** Incidents and customer complaints can’t be traced end-to-end; debugging is guesswork.
