const express = require('express');
const router = express.Router();
const webhookSignature = require('../middleware/webhookSignature');
const { processWebhookPayload } = require('../services/webhookProcessor');

// POST /webhooks/provider — receive settlement notifications
// Exported for use by webhook simulation (mock req/res).
async function webhookProviderHandler(req, res) {
  try {
    const payload = req.body;
    const eventId = req.headers['x-webhook-event-id'];
    const signature = req.headers['x-webhook-signature'];

    if (!eventId) {
      return res.status(200).json({ received: true });
    }

    await processWebhookPayload(payload, eventId, signature);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    res.status(200).json({ received: true });
  }
}

router.post('/provider', webhookSignature, webhookProviderHandler);

module.exports = router;
module.exports.webhookProviderHandler = webhookProviderHandler;
