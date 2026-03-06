const pool = require('./pool');

/**
 * Executes a callback within a database transaction.
 * The callback receives a client with BEGIN already issued.
 * Automatically COMMITs on success or ROLLBACKs on error.
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
