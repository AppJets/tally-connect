// src/database/data-source.ts
// Used by TypeORM CLI for migration:generate and migration:run
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// When running from dist/src/database/, go up 3 levels to project root
dotenv.config({ path: resolve(__dirname, '../../../.env.local') });
dotenv.config({ path: resolve(__dirname, '../../../.env') });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'lex_tally_db',
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [resolve(__dirname, '../**/*.entity.{ts,js}')],
  migrations: [resolve(__dirname, '../../migrations/*.{ts,js}')],
});
