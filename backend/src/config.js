const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://payroute:payroute_secret_123@localhost:5432/payroute',
  webhookSecret: process.env.WEBHOOK_SECRET || 'whsec_test_secret_key_for_hmac',
  fxQuoteTtlSeconds: parseInt(process.env.FX_QUOTE_TTL_SECONDS, 10) || 300,
};

const required = ['databaseUrl', 'webhookSecret'];
for (const key of required) {
  if (!config[key]) {
    throw new Error(`Missing required config: ${key}`);
  }
}

module.exports = config;
