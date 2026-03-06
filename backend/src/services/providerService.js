const { v4: uuidv4 } = require('uuid');

/**
 * Simulated downstream payment provider.
 * In production this would make an HTTP call to a real payment provider.
 * Returns a provider reference for tracking.
 */
async function submitPayment({ transactionId, amount, currency, recipientAccountId }) {
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));

  // Simulate occasional failures (10% of the time)
  if (Math.random() < 0.1) {
    throw new Error('Provider temporarily unavailable');
  }

  return {
    providerReference: `PRV-${uuidv4().split('-')[0].toUpperCase()}`,
    status: 'accepted',
  };
}

module.exports = { submitPayment };
