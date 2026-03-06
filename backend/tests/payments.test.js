const createApp = require('../src/app');
const { setupDatabase, teardownDatabase, cleanTables, pool } = require('./setup');
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
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('POST /payments', () => {
  const validPayment = {
    sender_account_id: 'a0000000-0000-0000-0000-000000000001',
    recipient_account_id: 'a0000000-0000-0000-0000-000000000003',
    amount: 1600000,
    source_currency: 'NGN',
    destination_currency: 'USD',
  };

  test('requires Idempotency-Key header', async () => {
    const res = await request('POST', '/payments', validPayment);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Idempotency-Key/i);
  });

  test('creates a payment successfully', async () => {
    const res = await request('POST', '/payments', validPayment, {
      'Idempotency-Key': 'test-key-1',
    });

    // Payment may succeed (processing) or fail (reversed) due to simulated provider
    expect([201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.source_amount).toBe('1600000.0000');
    expect(res.body.source_currency).toBe('NGN');
    expect(res.body.destination_currency).toBe('USD');
    expect(res.body.destination_amount).toBeDefined();
    expect(res.body.sender_account_id).toBe(validPayment.sender_account_id);
    expect(res.body.recipient_account_id).toBe(validPayment.recipient_account_id);
  });

  test('returns same response for duplicate idempotency key', async () => {
    const key = 'test-idempotent-key';

    const res1 = await request('POST', '/payments', validPayment, {
      'Idempotency-Key': key,
    });
    expect(res1.status).toBe(201);

    const res2 = await request('POST', '/payments', validPayment, {
      'Idempotency-Key': key,
    });
    expect(res2.status).toBe(201);
    expect(res2.body.id).toBe(res1.body.id);
  });

  test('rejects idempotency key reuse with different body', async () => {
    const key = 'test-conflict-key';

    await request('POST', '/payments', validPayment, {
      'Idempotency-Key': key,
    });

    const res = await request('POST', '/payments', { ...validPayment, amount: 999 }, {
      'Idempotency-Key': key,
    });
    expect(res.status).toBe(409);
  });

  test('rejects payment with insufficient funds', async () => {
    const res = await request('POST', '/payments', {
      ...validPayment,
      amount: 999999999999,
    }, {
      'Idempotency-Key': 'test-overdraft',
    });

    expect(res.status).toBe(402);
  });

  test('rejects payment with missing fields', async () => {
    const res = await request('POST', '/payments', {
      sender_account_id: validPayment.sender_account_id,
    }, {
      'Idempotency-Key': 'test-missing-fields',
    });

    expect(res.status).toBe(400);
  });

  test('rejects same currency transfer', async () => {
    const res = await request('POST', '/payments', {
      ...validPayment,
      destination_currency: 'NGN',
      recipient_account_id: 'a0000000-0000-0000-0000-000000000001',
    }, {
      'Idempotency-Key': 'test-same-currency',
    });

    // Will fail validation (same account or same currency)
    expect([400, 422]).toContain(res.status);
  });

  test('deducts funds from sender on successful payment', async () => {
    const before = await pool.query(
      'SELECT balance FROM accounts WHERE id = $1',
      [validPayment.sender_account_id]
    );
    const balanceBefore = parseFloat(before.rows[0].balance);

    const res = await request('POST', '/payments', validPayment, {
      'Idempotency-Key': 'test-balance-check',
    });
    expect(res.status).toBe(201);

    const after = await pool.query(
      'SELECT balance FROM accounts WHERE id = $1',
      [validPayment.sender_account_id]
    );
    const balanceAfter = parseFloat(after.rows[0].balance);

    if (res.body.status === 'processing') {
      expect(balanceAfter).toBe(balanceBefore - 1600000);
    } else {
      // Provider failed, funds reversed
      expect(balanceAfter).toBe(balanceBefore);
    }
  });

  test('creates ledger entries for every balance movement', async () => {
    const res = await request('POST', '/payments', validPayment, {
      'Idempotency-Key': 'test-ledger-entries',
    });
    expect(res.status).toBe(201);

    const entries = await pool.query(
      'SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY created_at',
      [res.body.id]
    );

    // At minimum, fund lock creates a debit+credit pair
    expect(entries.rows.length).toBeGreaterThanOrEqual(2);

    // Verify double-entry: sum of debits = sum of credits per transaction
    const debits = entries.rows
      .filter(e => e.entry_type === 'debit')
      .reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const credits = entries.rows
      .filter(e => e.entry_type === 'credit')
      .reduce((sum, e) => sum + parseFloat(e.amount), 0);

    expect(debits).toBe(credits);
  });
});

describe('GET /payments/:id', () => {
  test('returns payment details with ledger entries', async () => {
    const createRes = await request('POST', '/payments', {
      sender_account_id: 'a0000000-0000-0000-0000-000000000001',
      recipient_account_id: 'a0000000-0000-0000-0000-000000000003',
      amount: 500000,
      source_currency: 'NGN',
      destination_currency: 'USD',
    }, {
      'Idempotency-Key': 'test-get-detail',
    });

    const res = await request('GET', `/payments/${createRes.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createRes.body.id);
    expect(res.body.ledger_entries).toBeDefined();
    expect(Array.isArray(res.body.ledger_entries)).toBe(true);
  });

  test('returns 404 for non-existent payment', async () => {
    const res = await request('GET', '/payments/a0000000-0000-0000-0000-000000000099');
    expect(res.status).toBe(404);
  });
});

describe('GET /payments', () => {
  test('returns paginated list', async () => {
    // Create a few payments
    for (let i = 0; i < 3; i++) {
      await request('POST', '/payments', {
        sender_account_id: 'a0000000-0000-0000-0000-000000000001',
        recipient_account_id: 'a0000000-0000-0000-0000-000000000003',
        amount: 100000,
        source_currency: 'NGN',
        destination_currency: 'USD',
      }, {
        'Idempotency-Key': `test-list-${i}`,
      });
    }

    const res = await request('GET', '/payments?page=1&limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(3);
  });

  test('filters by status', async () => {
    const res = await request('GET', '/payments?status=completed');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
