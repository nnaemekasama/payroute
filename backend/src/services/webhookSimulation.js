/**
 * Simulated provider webhook: builds payload, signs with HMAC, and runs the
 * same webhook path (signature verification + handler) via mock req/res.
 */
const crypto = require('crypto');
const config = require('../config');
const webhookSignature = require('../middleware/webhookSignature');
const { webhookProviderHandler } = require('../routes/webhooks');

async function simulateProviderWebhook(providerReference, destinationAmount, destinationCurrency) {
  const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const status = Math.random() < 0.8 ? 'completed' : 'failed';
  const payload = {
    event_id: eventId,
    reference: providerReference,
    status,
    amount: parseFloat(destinationAmount),
    currency: destinationCurrency,
    timestamp: new Date().toISOString(),
    event_type: status === 'completed' ? 'payment.completed' : 'payment.failed',
  };

  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(rawBody)
    .digest('hex');

  const mockReq = {
    body: payload,
    rawBody,
    headers: {
      'x-webhook-signature': signature,
      'x-webhook-event-id': eventId,
    },
  };

  return new Promise((resolve, reject) => {
    const mockRes = {
      status(code) {
        return {
          json(data) {
            if (code >= 400) reject(new Error(data?.error || `Webhook responded ${code}`));
            else resolve();
          },
          send(data) {
            if (code >= 400) reject(new Error(`Webhook responded ${code}`));
            else resolve();
          },
        };
      },
      json(data) {
        resolve();
      },
      sendStatus(code) {
        if (code >= 400) reject(new Error(`Webhook sendStatus ${code}`));
        else resolve();
      },
    };

    const next = () => {
      webhookProviderHandler(mockReq, mockRes).then(resolve).catch(reject);
    };

    webhookSignature(mockReq, mockRes, next);
  });
}

module.exports = { simulateProviderWebhook };
