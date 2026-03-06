const { withTransaction } = require('../db/transaction');
const transactionModel = require('../models/transaction');
const accountModel = require('../models/account');
const ledgerEntryModel = require('../models/ledgerEntry');
const fxService = require('./fxService');
const ledgerService = require('./ledgerService');
const providerService = require('./providerService');
const { ValidationError, UnprocessableError } = require('../utils/errors');

/**
 * Full payment initiation flow:
 * 1. Validate accounts and currencies
 * 2. Fetch and lock FX quote
 * 3. Create transaction record
 * 4. Lock sender funds (debit via ledger pair)
 * 5. Submit to downstream provider
 * 6. Return transaction in 'processing' state
 */
async function initiatePayment({
  idempotencyKeyId,
  senderAccountId,
  recipientAccountId,
  amount,
  sourceCurrency,
  destinationCurrency,
}) {
  if (!senderAccountId || !recipientAccountId || !amount || !sourceCurrency || !destinationCurrency) {
    throw new ValidationError('Missing required fields: sender_account_id, recipient_account_id, amount, source_currency, destination_currency');
  }

  if (parseFloat(amount) <= 0) {
    throw new ValidationError('Amount must be greater than zero');
  }

  if (senderAccountId === recipientAccountId) {
    throw new UnprocessableError('Sender and recipient accounts must be different');
  }

  return withTransaction(async (client) => {
    // 1. Validate accounts
    const sender = await accountModel.findById(senderAccountId, client);
    if (!sender) throw new ValidationError('Sender account not found');
    if (sender.currency !== sourceCurrency) {
      throw new ValidationError(`Sender account currency (${sender.currency}) does not match source_currency (${sourceCurrency})`);
    }

    const recipient = await accountModel.findById(recipientAccountId, client);
    if (!recipient) throw new ValidationError('Recipient account not found');
    if (recipient.currency !== destinationCurrency) {
      throw new ValidationError(`Recipient account currency (${recipient.currency}) does not match destination_currency (${destinationCurrency})`);
    }

    if (sourceCurrency === destinationCurrency) {
      throw new UnprocessableError('Source and destination currencies must differ for cross-border payments');
    }

    // 2. Fetch FX quote
    const quote = await fxService.fetchQuote(client, sourceCurrency, destinationCurrency, parseFloat(amount));
    if (!quote) {
      throw new UnprocessableError(`No FX rate available for ${sourceCurrency} -> ${destinationCurrency}`);
    }

    // 3. Create transaction in 'initiated' state
    const txn = await transactionModel.create({
      idempotencyKeyId,
      senderAccountId,
      recipientAccountId,
      sourceAmount: parseFloat(amount),
      sourceCurrency,
      destinationAmount: parseFloat(quote.destination_amount),
      destinationCurrency,
      fxQuoteId: quote.id,
      status: 'initiated',
    }, client);

    // 4. Lock the FX quote for this transaction
    const lockedQuote = await fxService.lockQuote(client, quote.id, txn.id);
    if (!lockedQuote) {
      throw new UnprocessableError('FX quote expired or already used');
    }

    // 5. Lock funds (debit sender, create ledger pair)
    await ledgerService.lockFunds(
      client,
      txn.id,
      senderAccountId,
      recipientAccountId,
      parseFloat(amount),
      sourceCurrency
    );

    // 6. Update status to funds_locked
    await transactionModel.updateStatus(txn.id, 'funds_locked', client);

    // 7. Submit to downstream provider
    let providerResult;
    try {
      providerResult = await providerService.submitPayment({
        transactionId: txn.id,
        amount: parseFloat(quote.destination_amount),
        currency: destinationCurrency,
        recipientAccountId,
      });
    } catch (providerError) {
      // Provider failed — reverse the fund lock
      await ledgerService.reverseFunds(
        client,
        txn.id,
        senderAccountId,
        recipientAccountId,
        parseFloat(amount),
        sourceCurrency
      );
      const failed = await transactionModel.updateStatus(txn.id, 'failed', client, {
        failureReason: providerError.message,
      });
      await transactionModel.updateStatus(txn.id, 'reversed', client);
      return { ...failed, status: 'reversed', fx_rate: quote.rate };
    }

    // 8. Update to processing with provider reference
    const processing = await transactionModel.updateStatus(txn.id, 'processing', client, {
      providerReference: providerResult.providerReference,
    });

    return {
      ...processing,
      fx_rate: quote.rate,
    };
  });
}

/**
 * Get payment details with ledger entries and account names.
 */
async function getPaymentById(id) {
  const txn = await transactionModel.findById(id);
  if (!txn) return null;

  const [entries, quote, senderAccount, recipientAccount] = await Promise.all([
    ledgerEntryModel.findByTransactionIdWithAccountNames(id),
    txn.fx_quote_id
      ? require('../models/fxQuote').findById(txn.fx_quote_id, require('../db/pool'))
      : Promise.resolve(null),
    accountModel.findById(txn.sender_account_id),
    accountModel.findById(txn.recipient_account_id),
  ]);

  return {
    ...txn,
    fx_rate: quote ? quote.rate : null,
    sender_account_name: senderAccount ? senderAccount.name : null,
    sender_account_currency: senderAccount ? senderAccount.currency : null,
    recipient_account_name: recipientAccount ? recipientAccount.name : null,
    recipient_account_currency: recipientAccount ? recipientAccount.currency : null,
    ledger_entries: entries,
  };
}

/**
 * Process a webhook event from the payment provider.
 * Handles completed and failed statuses with appropriate ledger entries.
 */
async function processWebhookEvent(transaction, eventStatus, client) {
  if (eventStatus === 'completed') {
    await ledgerService.settlePayment(
      client,
      transaction.id,
      transaction.sender_account_id,
      transaction.recipient_account_id,
      parseFloat(transaction.destination_amount),
      transaction.destination_currency
    );

    return transactionModel.updateStatus(transaction.id, 'completed', client);
  }

  if (eventStatus === 'failed') {
    await ledgerService.reverseFunds(
      client,
      transaction.id,
      transaction.sender_account_id,
      transaction.recipient_account_id,
      parseFloat(transaction.source_amount),
      transaction.source_currency
    );

    await transactionModel.updateStatus(transaction.id, 'failed', client, {
      failureReason: 'Payment provider reported failure',
    });

    return transactionModel.updateStatus(transaction.id, 'reversed', client);
  }

  console.warn(`Unknown webhook event status: ${eventStatus}`);
  return null;
}

module.exports = { initiatePayment, getPaymentById, processWebhookEvent };
