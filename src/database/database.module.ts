// src/database/database.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Subscription } from '../activation/entities/subscription.entity';
import { ApiCredential } from '../activation/entities/api-credential.entity';
import { TallyConnection } from '../tally-connection/entities/tally-connection.entity';
import { Voucher } from '../accounting/entities/voucher.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { SyncSession, SyncError } from '../monitoring/entities/sync-session.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get<number>('database.port'),
        username: config.get('database.username'),
        password: config.get('database.password'),
        database: config.get('database.name'),
        synchronize: config.get<boolean>('database.synchronize', false),
        logging: config.get<boolean>('database.logging', false),
        entities: [
          Subscription,
          ApiCredential,
          TallyConnection,
          Voucher,
          Ledger,
          SyncSession,
          SyncError,
        ],
        migrations: ['dist/migrations/*.js'],
        migrationsRun: false,
        // Connection pool tuning for a microservice
        extra: {
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        },
        ssl: config.get('nodeEnv') === 'production'
          ? { rejectUnauthorized: false }
          : false,
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
