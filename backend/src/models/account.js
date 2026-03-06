const pool = require('../db/pool');

async function findById(id, client = pool) {
  const result = await client.query(
    'SELECT * FROM accounts WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function findAll(client = pool) {
  const result = await client.query(
    'SELECT * FROM accounts ORDER BY name, currency'
  );
  return result.rows;
}

/**
 * Debit an account using optimistic concurrency control.
 * Returns updated row or null if version conflict / insufficient funds.
 */
async function debit(id, amount, expectedVersion, client) {
  const result = await client.query(
    `UPDATE accounts
     SET balance = balance - $1,
         ledger_balance = ledger_balance - $1,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $2 AND version = $3 AND balance >= $1
     RETURNING *`,
    [amount, id, expectedVersion]
  );
  return result.rows[0] || null;
}

/**
 * Credit an account using optimistic concurrency control.
 */
async function credit(id, amount, expectedVersion, client) {
  const result = await client.query(
    `UPDATE accounts
     SET balance = balance + $1,
         ledger_balance = ledger_balance + $1,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $2 AND version = $3
     RETURNING *`,
    [amount, id, expectedVersion]
  );
  return result.rows[0] || null;
}

/**
 * Lock-free credit — used in webhook processing where we don't
 * have a prior version. Uses FOR UPDATE to serialize.
 */
async function creditForUpdate(id, amount, client) {
  const row = await client.query(
    'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!row.rows[0]) return null;

  const result = await client.query(
    `UPDATE accounts
     SET balance = balance + $1,
         ledger_balance = ledger_balance + $1,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [amount, id]
  );
  return result.rows[0] || null;
}

/**
 * Lock-free debit — used when debiting transit/escrow on settlement.
 * Uses FOR UPDATE to serialize.
 */
async function debitForUpdate(id, amount, client) {
  const row = await client.query(
    'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!row.rows[0]) return null;
  const balance = parseFloat(row.rows[0].balance);
  if (balance < parseFloat(amount)) return null;

  const result = await client.query(
    `UPDATE accounts
     SET balance = balance - $1,
         ledger_balance = ledger_balance - $1,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [amount, id]
  );
  return result.rows[0] || null;
}

/**
 * Find account by name and currency (e.g. PayRoute Transit + USD).
 */
async function findByNameAndCurrency(name, currency, client = pool) {
  const result = await client.query(
    'SELECT * FROM accounts WHERE name = $1 AND currency = $2',
    [name, currency]
  );
  return result.rows[0] || null;
}

module.exports = { findById, findAll, debit, credit, creditForUpdate, debitForUpdate, findByNameAndCurrency };
