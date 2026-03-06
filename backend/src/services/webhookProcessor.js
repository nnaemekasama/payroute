/**
 * Shared webhook processing logic. Used by both the HTTP webhook route
 * and the simulated webhook scheduler after POST /payments.
 * Runs the exact same state machine, ledger entries, and idempotency.
 */
const webhookEventModel = require('../models/webhookEvent');
const transactionModel = require('../models/transaction');
const paymentService = require('../services/paymentService');
const { withTransaction } = require('../db/transaction');

async function processWebhookPayload(payload, eventId, signature) {
  if (!eventId) {
    return;
  }

  await withTransaction(async (client) => {
    const event = await webhookEventModel.insertIfNew(client, {
      eventId,
      eventType: payload.event_type || 'unknown',
      providerReference: payload.reference || 'unknown',
      rawPayload: payload,
      signature,
    });

    if (!event) {
      return;
    }

    const transaction = await transactionModel.findByProviderReference(payload.reference, client);

    if (!transaction) {
      await webhookEventModel.markProcessed(client, event.id);
      return;
    }

    await paymentService.processWebhookEvent(transaction, payload.status, client);
    await webhookEventModel.markProcessed(client, event.id);
  });
}

module.exports = { processWebhookPayload };
