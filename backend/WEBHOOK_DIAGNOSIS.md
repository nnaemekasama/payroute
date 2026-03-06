# Webhook simulation – diagnosis report

## 1. POST /payments – setTimeout for simulated webhook

**Location:** `backend/src/routes/payments.js` lines 38–57

**Code:**
```js
// Schedule simulated webhook so transactions don't stay stuck in 'processing'
if (result.status === 'processing' && result.provider_reference) {
  const delayMs = 5000 + Math.random() * 5000; // 5–10 seconds
  const status = Math.random() < 0.8 ? 'completed' : 'failed';
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const payload = {
    event_type: status === 'completed' ? 'payment.completed' : 'payment.failed',
    reference: result.provider_reference,
    status,
    amount: parseFloat(result.destination_amount),
    currency: result.destination_currency,
    timestamp: new Date(Date.now() + delayMs).toISOString(),
  };
  setTimeout(() => {
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(config.webhookSecret, rawBody);
    processWebhookPayload(payload, eventId, signature).catch((err) =>
      console.error('Simulated webhook failed:', err.message)
    );
  }, delayMs);
}
```

**Finding:** A `setTimeout` is present and only runs when `result.status === 'processing'` and `result.provider_reference` is truthy. There is no debug log before it, so it’s unclear if this block is reached.

---

## 2. Is setTimeout being reached?

**Finding:** No `console.error('DEBUG: Scheduling webhook simulation for', providerReference)` (or similar) exists before the `setTimeout`. Without that, we can’t confirm the block runs. Adding that log is part of the fix.

---

## 3. Internal vs HTTP for simulation

**Finding:** The simulation does **not** call the HTTP webhook route. It calls **`processWebhookPayload(payload, eventId, signature)`** from `webhookProcessor.js` directly (no HTTP, no mock req/res). So:

- Signature middleware is **not** run for the simulation.
- The webhook route and its error handling are **not** used for the simulation.

---

## 4. HMAC signature

**Location:** `backend/src/utils/hmac.js`

**Code:**
```js
function signPayload(secret, payload) {
  return crypto
    .createHmac('sha256', secret)
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest('hex');
}
```

**Finding:** HMAC-SHA256 is computed correctly. The simulation passes `rawBody = JSON.stringify(payload)`, so the signed input is the raw JSON string. The HTTP route never sees this body, so verification is only relevant when we switch to calling the handler with a mock req (see Fix B/C/D).

---

## 5. POST /webhooks/provider – early returns and errors

**Location:** `backend/src/routes/webhooks.js`

- **Duplicate event_id:** The route does **not** check for duplicates; `processWebhookPayload` does that via `webhookEventModel.insertIfNew`. If the event_id already exists, `insertIfNew` returns `null` and the processor returns early without updating the transaction. So duplicates are handled inside the processor, not in the route.
- **State machine:** The DB trigger `enforce_transaction_state_machine()` allows `"processing": ["completed", "failed"]`. So `processing` → `completed` and `processing` → `failed` are valid. No rejection from the state machine for the simulated case.
- **Try/catch:** The route has `try { ... } catch (err) { console.error('Webhook processing error:', err.message); res.status(200).json({ received: true }); }`. So any error in `processWebhookPayload` is logged but the response is still 200. The client sees success even when processing failed.

**Finding:** The route does not do an early return for duplicates (that’s in the processor). The state machine allows the transitions we need. Errors are swallowed and responded to with 200, so failures are easy to miss.

---

## 6. webhook_events table and query

**Schema:** `backend/src/db/migrations/001_initial_schema.sql` defines `webhook_events` with:

- `id`, `event_id`, `event_type`, `provider_reference`, `raw_payload`, `signature`, `processed`, `processed_at`, `created_at`

There are **no** columns `transaction_id` or `status`.

**Query that will work** (schema has no `transaction_id` or `status`):
```sql
SELECT event_id, event_type, provider_reference, processed, processed_at, created_at
FROM webhook_events
ORDER BY created_at DESC
LIMIT 5;
```

---

## STEP 4 — Verify (after fixes)

1. Create a new payment via POST /payments.
2. Within ~10 seconds the transaction status should change to `completed` or `failed`.
3. GET /payments/:id should show the full timeline: initiated → processing → completed (or failed).
4. Ledger entries should show the settlement credit to recipient (and debit from PayRoute Transit when completed).
5. Previously stuck transactions should be resolved after server restart (resolveStuckTransactions runs on startup).
6. Run the query above: `webhook_events` should have a row for each simulated webhook (`processed = true` after success).

---

## Summary of likely causes

1. **Unclear if scheduling runs:** No log before `setTimeout`, so we don’t know if `result.status === 'processing'` and `result.provider_reference` are set when the 201 is sent.
2. **Simulation bypasses HTTP:** Simulation calls `processWebhookPayload` directly, so the webhook route and signature middleware are not exercised for simulations.
3. **Errors only in logs:** Any failure in `processWebhookPayload` is caught and answered with 200, so the only sign of failure is the console.error from the `.catch` in payments or the route’s catch block.
4. **Possible processor failures:** e.g. missing Transit account for `settlePayment`, or other DB/constraint errors inside the processor, would leave the transaction in `processing` and only show up in logs.
