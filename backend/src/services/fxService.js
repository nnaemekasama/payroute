const fxQuoteModel = require('../models/fxQuote');
const config = require('../config');

/**
 * Simulated FX rates. In production this would call a real FX provider API.
 */
const SIMULATED_RATES = {
  'NGN:USD': 0.000625,   // 1 NGN = 0.000625 USD  (1600 NGN/USD)
  'NGN:EUR': 0.000575,   // 1 NGN = 0.000575 EUR  (~1739 NGN/EUR)
  'NGN:GBP': 0.000500,   // 1 NGN = 0.000500 GBP  (2000 NGN/GBP)
};

function getRate(sourceCurrency, destinationCurrency) {
  const key = `${sourceCurrency}:${destinationCurrency}`;
  const rate = SIMULATED_RATES[key];
  if (!rate) return null;

  // Add slight random spread (+/- 2%) to simulate real market conditions
  const spread = 1 + (Math.random() * 0.04 - 0.02);
  return parseFloat((rate * spread).toFixed(8));
}

/**
 * Fetch a fresh FX quote and store it in the database.
 */
async function fetchQuote(client, sourceCurrency, destinationCurrency, sourceAmount) {
  const rate = getRate(sourceCurrency, destinationCurrency);
  if (!rate) return null;

  const destinationAmount = parseFloat((sourceAmount * rate).toFixed(4));

  const quote = await fxQuoteModel.create(client, {
    sourceCurrency,
    destinationCurrency,
    rate,
    sourceAmount,
    destinationAmount,
    ttlSeconds: config.fxQuoteTtlSeconds,
  });

  return quote;
}

/**
 * Lock a quote for a specific transaction.
 * Returns null if the quote has expired or is already locked.
 */
async function lockQuote(client, quoteId, transactionId) {
  return fxQuoteModel.lockForTransaction(client, quoteId, transactionId);
}

module.exports = { fetchQuote, lockQuote, getRate };
