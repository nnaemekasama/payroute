require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const required = ['DATABASE_URL', 'WEBHOOK_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  console.error('Copy .env.example to .env and fill in the values');
  process.exit(1);
}

const createApp = require('./app');
const config = require('./config');
const pool = require('./db/pool');
const { simulateProviderWebhook } = require('./services/webhookSimulation');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'db', 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`Running migration: ${file}`);
    await pool.query(sql);
    console.log(`Migration complete: ${file}`);
  }
}

async function resolveStuckTransactions() {
  const stuck = await pool.query(`
    SELECT id, provider_reference, destination_amount, destination_currency
    FROM transactions
    WHERE status = 'processing'
    AND provider_reference IS NOT NULL
    AND created_at < NOW() - INTERVAL '1 minute'
  `);

  if (stuck.rows.length === 0) return;
  console.error(`Found ${stuck.rows.length} stuck transaction(s), resolving...`);

  for (const tx of stuck.rows) {
    try {
      await simulateProviderWebhook(
        tx.provider_reference,
        tx.destination_amount,
        tx.destination_currency
      );
    } catch (err) {
      console.error(`Stuck tx ${tx.id} simulation failed:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function startServer() {
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');

    await runMigrations();
    console.log('Migrations complete');

    const app = createApp();
    const PORT = config.port;
    app.listen(PORT, () => {
      console.log(`Backend running on port ${PORT}`);
    });

    resolveStuckTransactions().catch((err) => console.error('resolveStuckTransactions failed:', err.message));
  } catch (err) {
    console.error('Failed to start server:', err.message);
    console.error('Check that PostgreSQL is running and DATABASE_URL is correct.');
    console.error('Current DATABASE_URL:', process.env.DATABASE_URL ? '(set)' : '(not set)');
    process.exit(1);
  }
}

startServer();
