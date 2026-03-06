async function create(client, data) {
  const result = await client.query(
    `INSERT INTO fx_quotes
       (source_currency, destination_currency, rate, source_amount, destination_amount, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)
     RETURNING *`,
    [
      data.sourceCurrency,
      data.destinationCurrency,
      data.rate,
      data.sourceAmount,
      data.destinationAmount,
      data.ttlSeconds,
    ]
  );
  return result.rows[0];
}

/**
 * Lock a quote for a transaction. Uses FOR UPDATE to prevent
 * two concurrent payments from consuming the same quote.
 * Returns null if the quote is already locked or expired.
 */
async function lockForTransaction(client, quoteId, transactionId) {
  const result = await client.query(
    `UPDATE fx_quotes
     SET is_locked = TRUE, locked_by_transaction_id = $1
     WHERE id = $2 AND expires_at > NOW() AND is_locked = FALSE
     RETURNING *`,
    [transactionId, quoteId]
  );
  return result.rows[0] || null;
}

async function findById(id, client) {
  const result = await client.query(
    'SELECT * FROM fx_quotes WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

module.exports = { create, lockForTransaction, findById };
