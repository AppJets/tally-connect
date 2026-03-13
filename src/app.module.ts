// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { ActivationModule } from './activation/activation.module';
import { TallyConnectionModule } from './tally-connection/tally-connection.module';
import { SyncModule } from './sync/sync.module';
import { NormalizationModule } from './normalization/normalization.module';

@Module({
  imports: [
    // ── Config ──────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Database ─────────────────────────────────────────────────────────────
    DatabaseModule,

    // ── Queue ────────────────────────────────────────────────────────────────
    BullModule.forRootAsync({
      useFactory: (config) => ({
        connection: {
          host: config.get('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get('redis.password'),
        },
        defaultJobOptions: {
          removeOnComplete: { count: 1000 },
          removeOnFail: false,
        },
      }),
      inject: ['ConfigService'],
    }),

    // ── Rate limiting ─────────────────────────────────────────────────────────
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]),

    // ── Feature modules ───────────────────────────────────────────────────────
    ActivationModule,
    TallyConnectionModule,
    NormalizationModule,
    SyncModule,
  ],
})
export class AppModule {}
