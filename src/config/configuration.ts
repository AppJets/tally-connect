// src/config/configuration.ts

export default () => ({
  port: parseInt(process.env.PORT ?? '8009', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME ?? 'lex_tally_db',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  security: {
    apiSecretSaltRounds: parseInt(process.env.API_SECRET_SALT_ROUNDS ?? '12', 10),
    activationWebhookSecret: process.env.ACTIVATION_WEBHOOK_SECRET,
  },

  queue: {
    concurrency: parseInt(process.env.SYNC_QUEUE_CONCURRENCY ?? '10', 10),
    jobAttempts: parseInt(process.env.SYNC_JOB_ATTEMPTS ?? '3', 10),
  },
});
