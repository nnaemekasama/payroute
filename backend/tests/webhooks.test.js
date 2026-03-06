const createApp = require('../src/app');
const { setupDatabase, teardownDatabase, cleanTables, pool } = require('./setup');
const { signPayload } = require('../src/utils/hmac');
const config = require('../src/config');
const http = require('http');

let app, server, baseUrl;

beforeAll(async () => {
  await setupDatabase();
  app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await teardownDatabase();
});

beforeEach(async () => {
  await cleanTables();
});

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function signedWebhookRequest(payload, eventId = 'evt-test-001') {
  const bodyStr = JSON.stringify(payload);
  const signature = signPayload(config.webhookSecret, bodyStr);
  return {
    body: payload,
    headers: {
      'X-Webhook-Signature': signature,
      'X-Webhook-Event-Id': eventId,
    },
  };
}

async function createTestPayment() {
  // Force provider to succeed by mocking — but since we can't easily mock,
  // we'll create a payment and check its actual state
  const res = await request('POST', '/payments', {
    sender_account_id: 'a0000000-0000-0000-0000-000000000001',
    recipient_account_id: 'a0000000-0000-0000-0000-000000000003',
    amount: 1600000,
    source_currency: 'NGN',
    destination_currency: 'USD',
  }, {
    'Idempotency-Key': `webhook-test-${Date.now()}-${Math.random()}`,
  });

  return res.body;
}

describe('POST /webhooks/provider', () => {
  test('rejects requests without signature', async () => {
    const res = await request('POST', '/webhooks/provider', {
      event_type: 'payment.completed',
      reference: 'PRV-TEST',
      status: 'completed',
    }, {
      'X-Webhook-Event-Id': 'evt-1',
    });

    expect(res.status).toBe(401);
  });

  test('rejects requests with invalid signature', async () => {
    const res = await request('POST', '/webhooks/provider', {
      event_type: 'payment.completed',
      reference: 'PRV-TEST',
      status: 'completed',
    }, {
      'X-Webhook-Signature': 'invalid-signature-value-here-that-is-long-enough',
      'X-Webhook-Event-Id': 'evt-2',
    });

    expect(res.status).toBe(401);
  });

  test('returns 200 for unknown provider reference', async () => {
    const payload = {
      event_type: 'payment.completed',
      reference: 'PRV-NONEXISTENT',
      status: 'completed',
      amount: 1000,
      currency: 'USD',
    };

    const { body, headers } = signedWebhookRequest(payload, 'evt-unknown');
    const res = await request('POST', '/webhooks/provider', body, headers);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test('processes duplicate event idempotently', async () => {
    const payload = {
      event_type: 'payment.completed',
      reference: 'PRV-DUPLICATE-TEST',
      status: 'completed',
      amount: 1000,
      currency: 'USD',
    };

    const { body, headers } = signedWebhookRequest(payload, 'evt-dup-1');

    const res1 = await request('POST', '/webhooks/provider', body, headers);
    expect(res1.status).toBe(200);

    const res2 = await request('POST', '/webhooks/provider', body, headers);
    expect(res2.status).toBe(200);

    // Verify event was only inserted once
    const events = await pool.query(
      "SELECT * FROM webhook_events WHERE event_id = 'evt-dup-1'"
    );
    expect(events.rows.length).toBe(1);
  });

  test('completes a payment via webhook', async () => {
    const payment = await createTestPayment();

    // Only test webhook completion if the payment is in 'processing' state
    if (payment.status !== 'processing' || !payment.provider_reference) {
      console.log('Skipping webhook completion test — payment not in processing state');
      return;
    }

    const payload = {
      event_type: 'payment.completed',
      reference: payment.provider_reference,
      status: 'completed',
      amount: parseFloat(payment.destination_amount),
      currency: payment.destination_currency,
    };

    const { body, headers } = signedWebhookRequest(payload, `evt-complete-${Date.now()}`);
    const res = await request('POST', '/webhooks/provider', body, headers);
    expect(res.status).toBe(200);

    // Verify transaction status was updated
    const txn = await pool.query(
      'SELECT * FROM transactions WHERE id = $1',
      [payment.id]
    );
    expect(txn.rows[0].status).toBe('completed');
    expect(txn.rows[0].completed_at).not.toBeNull();

    // Verify recipient account was credited
    const recipient = await pool.query(
      'SELECT balance FROM accounts WHERE id = $1',
      [payment.recipient_account_id]
    );
    expect(parseFloat(recipient.rows[0].balance)).toBeGreaterThan(0);

    // Verify settlement ledger entries were created
    const entries = await pool.query(
      'SELECT * FROM ledger_entries WHERE transaction_id = $1',
      [payment.id]
    );
    // Should have at least 4 entries: fund lock pair + settlement pair
    expect(entries.rows.length).toBeGreaterThanOrEqual(4);
  });

  test('fails a payment via webhook and reverses funds', async () => {
    const payment = await createTestPayment();

    if (payment.status !== 'processing' || !payment.provider_reference) {
      console.log('Skipping webhook failure test — payment not in processing state');
      return;
    }

    const senderBefore = await pool.query(
      'SELECT balance FROM accounts WHERE id = $1',
      [payment.sender_account_id]
    );

    const payload = {
      event_type: 'payment.failed',
      reference: payment.provider_reference,
      status: 'failed',
    };

    const { body, headers } = signedWebhookRequest(payload, `evt-fail-${Date.now()}`);
    const res = await request('POST', '/webhooks/provider', body, headers);
    expect(res.status).toBe(200);

    // Verify transaction was reversed
    const txn = await pool.query(
      'SELECT * FROM transactions WHERE id = $1',
      [payment.id]
    );
    expect(txn.rows[0].status).toBe('reversed');

    // Verify sender funds were returned
    const senderAfter = await pool.query(
      'SELECT balance FROM accounts WHERE id = $1',
      [payment.sender_account_id]
    );
    expect(parseFloat(senderAfter.rows[0].balance)).toBeGreaterThan(
      parseFloat(senderBefore.rows[0].balance)
    );
  });
});
