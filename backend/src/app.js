const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');

function createApp() {
  const app = express();

  app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Webhook-Signature', 'X-Webhook-Event-Id'],
    credentials: true,
  }));
  app.use(requestLogger);

  // JSON parsing with raw body capture for webhook signature verification
  app.use(express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'payroute', timestamp: new Date() });
  });

  app.use('/payments', paymentRoutes);
  app.use('/webhooks', webhookRoutes);

  // Accounts helper endpoint for frontend
  const accountModel = require('./models/account');
  app.get('/accounts', async (_req, res, next) => {
    try {
      const accounts = await accountModel.findAll();
      res.json(accounts);
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
