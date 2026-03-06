const express = require('express');
const router = express.Router();
const idempotency = require('../middleware/idempotency');
const paymentService = require('../services/paymentService');
const { simulateProviderWebhook } = require('../services/webhookSimulation');
const transactionModel = require('../models/transaction');
const { NotFoundError } = require('../utils/errors');
const { parsePagination, buildPaginationResponse } = require('../utils/pagination');

// POST /payments — initiate a new payment
router.post('/', idempotency, async (req, res, next) => {
  try {
    const result = await paymentService.initiatePayment({
      idempotencyKeyId: req.idempotencyKeyId,
      senderAccountId: req.body.sender_account_id,
      recipientAccountId: req.body.recipient_account_id,
      amount: req.body.amount,
      sourceCurrency: req.body.source_currency,
      destinationCurrency: req.body.destination_currency,
    });

    res.status(201).json({
      id: result.id,
      status: result.status,
      source_amount: result.source_amount,
      source_currency: result.source_currency,
      destination_amount: result.destination_amount,
      destination_currency: result.destination_currency,
      fx_rate: result.fx_rate,
      fx_quote_id: result.fx_quote_id,
      provider_reference: result.provider_reference,
      sender_account_id: result.sender_account_id,
      recipient_account_id: result.recipient_account_id,
      created_at: result.created_at,
    });

    // Schedule simulated webhook after response is sent (outside DB transaction)
    if (result.status === 'processing' && result.provider_reference) {
      const providerReference = result.provider_reference;
      const destinationAmount = result.destination_amount;
      const destinationCurrency = result.destination_currency;
      const simulationDelay = 5000 + Math.random() * 5000; // 5–10 seconds

      console.error('DEBUG: Scheduling webhook simulation for', providerReference);

      setTimeout(async () => {
        try {
          console.error('Triggering simulated webhook for:', providerReference);
          await simulateProviderWebhook(providerReference, destinationAmount, destinationCurrency);
        } catch (err) {
          console.error('Webhook simulation failed:', err.message);
        }
      }, simulationDelay);
    }
  } catch (err) {
    next(err);
  }
});

// GET /payments/:id — get payment details with ledger entries
router.get('/:id', async (req, res, next) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.id);
    if (!payment) throw new NotFoundError('Payment not found');

    res.json({
      id: payment.id,
      status: payment.status,
      source_amount: payment.source_amount,
      source_currency: payment.source_currency,
      destination_amount: payment.destination_amount,
      destination_currency: payment.destination_currency,
      fx_rate: payment.fx_rate,
      provider_reference: payment.provider_reference,
      sender_account_id: payment.sender_account_id,
      sender_account_name: payment.sender_account_name,
      sender_account_currency: payment.sender_account_currency,
      recipient_account_id: payment.recipient_account_id,
      recipient_account_name: payment.recipient_account_name,
      recipient_account_currency: payment.recipient_account_currency,
      failure_reason: payment.failure_reason,
      created_at: payment.created_at,
      updated_at: payment.updated_at,
      completed_at: payment.completed_at,
      ledger_entries: payment.ledger_entries.map((e) => ({
        id: e.id,
        account_id: e.account_id,
        account_name: e.account_name,
        entry_type: e.entry_type,
        amount: e.amount,
        currency: e.currency,
        description: e.description,
        created_at: e.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /payments — paginated list with filters
router.get('/', async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const filters = {
      status: req.query.status || null,
      senderAccountId: req.query.sender_account_id || null,
      fromDate: req.query.from_date || null,
      toDate: req.query.to_date || null,
    };

    const { rows, total } = await transactionModel.findPaginated(filters, pagination);

    res.json({
      data: rows.map((txn) => ({
        id: txn.id,
        status: txn.status,
        source_amount: txn.source_amount,
        source_currency: txn.source_currency,
        destination_amount: txn.destination_amount,
        destination_currency: txn.destination_currency,
        provider_reference: txn.provider_reference,
        sender_account_id: txn.sender_account_id,
        recipient_account_id: txn.recipient_account_id,
        failure_reason: txn.failure_reason,
        created_at: txn.created_at,
        updated_at: txn.updated_at,
        completed_at: txn.completed_at,
      })),
      pagination: buildPaginationResponse(pagination.page, pagination.limit, total),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
