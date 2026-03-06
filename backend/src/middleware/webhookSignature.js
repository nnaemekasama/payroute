const config = require('../config');
const crypto = require('crypto');

function webhookSignatureMiddleware(req, res, next) {
  const signature = req.headers['x-webhook-signature'];

  if (!signature) {
    return res.status(401).json({ error: 'Missing webhook signature' });
  }

  // Support both HTTP (rawBody buffer) and internal simulation (rawBody string)
  const rawBody = req.rawBody != null
    ? (Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : req.rawBody)
    : (req.body != null ? JSON.stringify(req.body) : null);

  if (!rawBody) {
    return res.status(400).json({ error: 'Missing request body' });
  }

  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

module.exports = webhookSignatureMiddleware;
