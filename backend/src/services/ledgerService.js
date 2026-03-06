const accountModel = require('../models/account');
const ledgerEntryModel = require('../models/ledgerEntry');
const { InsufficientFundsError } = require('../utils/errors');

const MAX_RETRIES = 3;

/**
 * Lock funds: debit sender account, create ledger pair.
 * Uses optimistic concurrency with retries.
 */
async function lockFunds(client, transactionId, senderAccountId, recipientAccountId, amount, currency) {
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const sender = await accountModel.findById(senderAccountId, client);
    if (!sender) throw new Error('Sender account not found');

    if (parseFloat(sender.balance) < parseFloat(amount)) {
      throw new InsufficientFundsError(
        `Insufficient balance: ${sender.balance} ${sender.currency} available, ${amount} required`
      );
    }

    const recipient = await accountModel.findById(recipientAccountId, client);
    if (!recipient) throw new Error('Recipient account not found');

    const updated = await accountModel.debit(
      senderAccountId,
      amount,
      sender.version,
      client
    );

    if (updated) {
      await ledgerEntryModel.insertPair(client, {
        transactionId,
        debitAccountId: senderAccountId,
        creditAccountId: recipientAccountId,
        amount,
        currency,
        debitDescription: `Debit from ${sender.name}`,
        creditDescription: `Credit to ${recipient.name}`,
      });
      return updated;
    }

    lastError = new Error('Concurrent modification detected, retrying');
  }

  throw lastError || new InsufficientFundsError('Failed to lock funds after retries');
}

const TRANSIT_ACCOUNT_NAME = 'PayRoute Transit';

/**
 * Settle payment: debit transit/escrow account, credit recipient, create settlement ledger pair.
 * Called when webhook confirms completion. Money leaves escrow (Transit) and arrives at recipient.
 */
async function settlePayment(client, transactionId, senderAccountId, recipientAccountId, amount, currency) {
  const [transit, recipient] = await Promise.all([
    accountModel.findByNameAndCurrency(TRANSIT_ACCOUNT_NAME, currency, client),
    accountModel.findById(recipientAccountId, client),
  ]);
  if (!transit) throw new Error(`Transit account not found for currency ${currency}`);
  if (!recipient) throw new Error('Recipient account not found');

  const debited = await accountModel.debitForUpdate(transit.id, amount, client);
  if (!debited) throw new Error('Insufficient transit balance or transit account not found');

  const updated = await accountModel.creditForUpdate(recipientAccountId, amount, client);
  if (!updated) throw new Error('Recipient account not found');

  await ledgerEntryModel.insertPair(client, {
    transactionId,
    debitAccountId: transit.id,
    creditAccountId: recipientAccountId,
    amount,
    currency,
    debitDescription: 'Debit from PayRoute Transit',
    creditDescription: `Credit to ${recipient.name}`,
  });

  return updated;
}

/**
 * Reverse payment: credit back the sender account, create reversal ledger pair.
 * Called on failure after funds were locked.
 */
async function reverseFunds(client, transactionId, senderAccountId, recipientAccountId, amount, currency) {
  const [sender, recipient] = await Promise.all([
    accountModel.findById(senderAccountId, client),
    accountModel.findById(recipientAccountId, client),
  ]);
  if (!sender) throw new Error('Sender account not found for reversal');
  if (!recipient) throw new Error('Recipient account not found');

  const updated = await accountModel.creditForUpdate(senderAccountId, amount, client);
  if (!updated) throw new Error('Sender account not found for reversal');

  await ledgerEntryModel.insertPair(client, {
    transactionId,
    debitAccountId: recipientAccountId,
    creditAccountId: senderAccountId,
    amount,
    currency,
    debitDescription: `Debit from ${recipient.name}`,
    creditDescription: `Credit to ${sender.name}`,
  });

  return updated;
}

module.exports = { lockFunds, settlePayment, reverseFunds };
