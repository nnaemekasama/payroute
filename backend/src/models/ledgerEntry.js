const pool = require('../db/pool');

async function findByTransactionId(transactionId, client = pool) {
  const result = await client.query(
    'SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY created_at',
    [transactionId]
  );
  return result.rows;
}

/**
 * Ledger entries for a transaction with account name joined (for display).
 */
async function findByTransactionIdWithAccountNames(transactionId, client = pool) {
  const result = await client.query(
    `SELECT le.id, le.transaction_id, le.account_id, le.entry_type, le.amount, le.currency, le.description, le.created_at,
            a.name AS account_name
       FROM ledger_entries le
       JOIN accounts a ON a.id = le.account_id
       WHERE le.transaction_id = $1
       ORDER BY le.created_at`,
    [transactionId]
  );
  return result.rows;
}

/**
 * Insert a matched debit/credit pair atomically.
 * debitDescription and creditDescription override description when set.
 */
async function insertPair(client, {
  transactionId,
  debitAccountId,
  creditAccountId,
  amount,
  currency,
  description,
  debitDescription,
  creditDescription,
}) {
  const debitDesc = debitDescription ?? description ?? '';
  const creditDesc = creditDescription ?? description ?? '';

  const debitResult = await client.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
     VALUES ($1, $2, 'debit', $3, $4, $5)
     RETURNING *`,
    [transactionId, debitAccountId, amount, currency, debitDesc]
  );

  const creditResult = await client.query(
    `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, currency, description)
     VALUES ($1, $2, 'credit', $3, $4, $5)
     RETURNING *`,
    [transactionId, creditAccountId, amount, currency, creditDesc]
  );

  return {
    debit: debitResult.rows[0],
    credit: creditResult.rows[0],
  };
}

module.exports = { findByTransactionId, findByTransactionIdWithAccountNames, insertPair };
