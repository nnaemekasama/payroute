const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  webhookSecret: process.env.WEBHOOK_SECRET,
  fxQuoteTtlSeconds: parseInt(process.env.FX_QUOTE_TTL_SECONDS, 10) || 300,
};

const required = ['databaseUrl', 'webhookSecret'];
for (const key of required) {
  if (!config[key]) {
    throw new Error(`Missing required config: ${key}. Set DATABASE_URL and WEBHOOK_SECRET in backend/.env (see .env.example).`);
  }
}

module.exports = config;
