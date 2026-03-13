// src/activation/activation.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { ApiCredential } from './entities/api-credential.entity';
import { ActivationService } from './activation.service';
import { ActivationController } from './activation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, ApiCredential])],
  controllers: [ActivationController],
  providers: [ActivationService],
  exports: [ActivationService], // ApiKeyGuard depends on this
})
export class ActivationModule {}
