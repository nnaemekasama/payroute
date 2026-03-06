const pool = require('../db/pool');

async function create(data, client) {
  const result = await client.query(
    `INSERT INTO transactions
       (idempotency_key_id, sender_account_id, recipient_account_id,
        source_amount, source_currency, destination_amount, destination_currency,
        fx_quote_id, status, provider_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.idempotencyKeyId,
      data.senderAccountId,
      data.recipientAccountId,
      data.sourceAmount,
      data.sourceCurrency,
      data.destinationAmount,
      data.destinationCurrency,
      data.fxQuoteId,
      data.status || 'initiated',
      data.providerReference || null,
    ]
  );
  return result.rows[0];
}

async function findById(id, client = pool) {
  const result = await client.query(
    'SELECT * FROM transactions WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function findByProviderReference(providerReference, client = pool) {
  const result = await client.query(
    'SELECT * FROM transactions WHERE provider_reference = $1',
    [providerReference]
  );
  return result.rows[0] || null;
}

async function updateStatus(id, newStatus, client, extra = {}) {
  const setClauses = ['status = $1'];
  const values = [newStatus];
  let paramIdx = 2;

  if (extra.providerReference) {
    setClauses.push(`provider_reference = $${paramIdx}`);
    values.push(extra.providerReference);
    paramIdx++;
  }
  if (extra.failureReason) {
    setClauses.push(`failure_reason = $${paramIdx}`);
    values.push(extra.failureReason);
    paramIdx++;
  }
  if (newStatus === 'completed') {
    setClauses.push(`completed_at = NOW()`);
  }

  values.push(id);
  const result = await client.query(
    `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    values
  );
  return result.rows[0];
}

async function findPaginated(filters, pagination, client = pool) {
  const conditions = [];
  const values = [];
  let paramIdx = 1;

  if (filters.status) {
    conditions.push(`status = $${paramIdx}`);
    values.push(filters.status);
    paramIdx++;
  }
  if (filters.senderAccountId) {
    conditions.push(`sender_account_id = $${paramIdx}`);
    values.push(filters.senderAccountId);
    paramIdx++;
  }
  if (filters.fromDate) {
    conditions.push(`created_at >= $${paramIdx}`);
    values.push(filters.fromDate);
    paramIdx++;
  }
  if (filters.toDate) {
    conditions.push(`created_at <= $${paramIdx}`);
    values.push(filters.toDate);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await client.query(
    `SELECT COUNT(*) as total FROM transactions ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].total, 10);

  const dataResult = await client.query(
    `SELECT * FROM transactions ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...values, pagination.limit, pagination.offset]
  );

  return { rows: dataResult.rows, total };
}

module.exports = { create, findById, findByProviderReference, updateStatus, findPaginated };
