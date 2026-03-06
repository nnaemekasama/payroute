const pool = require('../src/db/pool');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  // Drop all tables and recreate
  await pool.query(`
    DROP TABLE IF EXISTS webhook_events CASCADE;
    DROP TABLE IF EXISTS ledger_entries CASCADE;
    DROP TABLE IF EXISTS transactions CASCADE;
    DROP TABLE IF EXISTS fx_quotes CASCADE;
    DROP TABLE IF EXISTS idempotency_keys CASCADE;
    DROP TABLE IF EXISTS accounts CASCADE;
    DROP FUNCTION IF EXISTS enforce_transaction_state_machine CASCADE;
  `);

  const migrationPath = path.join(__dirname, '..', 'src', 'db', 'migrations', '001_initial_schema.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  await pool.query(sql);
}

async function teardownDatabase() {
  await pool.end();
}

async function cleanTables() {
  await pool.query(`
    DELETE FROM webhook_events;
    DELETE FROM ledger_entries;
    DELETE FROM transactions;
    DELETE FROM fx_quotes;
    DELETE FROM idempotency_keys;
    DELETE FROM accounts;
  `);

  // Re-seed accounts
  await pool.query(`
    INSERT INTO accounts (id, name, currency, balance, ledger_balance) VALUES
      ('a0000000-0000-0000-0000-000000000001', 'Acme Nigeria Ltd',   'NGN', 10000000.0000, 10000000.0000),
      ('a0000000-0000-0000-0000-000000000002', 'Acme Nigeria Ltd',   'USD', 0.0000, 0.0000),
      ('a0000000-0000-0000-0000-000000000003', 'Global Supplies Co', 'USD', 0.0000, 0.0000),
      ('a0000000-0000-0000-0000-000000000004', 'Euro Parts GmbH',   'EUR', 0.0000, 0.0000),
      ('a0000000-0000-0000-0000-000000000005', 'UK Materials Ltd',   'GBP', 0.0000, 0.0000);
  `);
}

module.exports = { setupDatabase, teardownDatabase, cleanTables, pool };
