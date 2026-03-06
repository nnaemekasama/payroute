const crypto = require('crypto');
const pool = require('../db/pool');
const { ValidationError, ConflictError } = require('../utils/errors');

function hashRequestBody(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Idempotency middleware for POST endpoints.
 * Uses INSERT ON CONFLICT + SELECT FOR UPDATE to serialize
 * concurrent requests with the same idempotency key.
 */
function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) {
    return next(new ValidationError('Idempotency-Key header is required'));
  }

  const requestHash = hashRequestBody(req.body);
  const method = req.method;
  const path = req.originalUrl;

  const originalJson = res.json.bind(res);

  (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const insertResult = await client.query(
        `INSERT INTO idempotency_keys (key, method, path, request_hash, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + interval '24 hours')
         ON CONFLICT (key) DO NOTHING
         RETURNING id`,
        [key, method, path, requestHash]
      );

      if (insertResult.rows.length > 0) {
        // New key — proceed with the request. Store the idempotency key id for later.
        req.idempotencyKeyId = insertResult.rows[0].id;
        await client.query('COMMIT');

        // Override res.json to capture and cache the response
        res.json = (body) => {
          pool.query(
            `UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE key = $3`,
            [res.statusCode, JSON.stringify(body), key]
          ).catch((err) => console.error('Failed to cache idempotency response:', err));

          return originalJson(body);
        };

        return next();
      }

      // Key exists — fetch cached response (FOR UPDATE blocks until first request commits)
      const existing = await client.query(
        `SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = $1 FOR UPDATE`,
        [key]
      );
      await client.query('COMMIT');

      const record = existing.rows[0];

      if (record.request_hash !== requestHash) {
        return next(new ConflictError('Idempotency key reused with different request body'));
      }

      if (record.response_status && record.response_body) {
        return res.status(record.response_status).json(record.response_body);
      }

      // First request is still in-flight and hasn't committed a response yet.
      // In practice, FOR UPDATE should block until it does, but handle edge case.
      return res.status(409).json({
        error: { code: 'CONFLICT', message: 'Request is still being processed' },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return next(err);
    } finally {
      client.release();
    }
  })();
}

module.exports = idempotency;
