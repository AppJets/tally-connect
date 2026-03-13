// src/tally-connection/tally-connection.service.ts
import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TallyConnection } from './entities/tally-connection.entity';
import { Subscription } from '../activation/entities/subscription.entity';
import { ApiCredential } from '../activation/entities/api-credential.entity';

export interface RegisterConnectionDto {
  tallyCompanyId: string;
  tallyCompanyName: string;
  deviceId: string;
  deviceLabel?: string;
}

@Injectable()
export class TallyConnectionService {
  private readonly logger = new Logger(TallyConnectionService.name);

  constructor(
    @InjectRepository(TallyConnection)
    private readonly connectionRepo: Repository<TallyConnection>,
  ) {}

  async register(
    dto: RegisterConnectionDto,
    subscription: Subscription,
    credential: ApiCredential,
  ): Promise<TallyConnection> {
    // Check if already registered (upsert by subscriptionId + tallyCompanyId)
    const existing = await this.connectionRepo.findOne({
      where: { subscriptionId: subscription.id, tallyCompanyId: dto.tallyCompanyId },
    });

    if (existing) {
      // Update device fingerprint + name in case of re-installation
      existing.deviceId = dto.deviceId;
      existing.tallyCompanyName = dto.tallyCompanyName;
      existing.deviceLabel = dto.deviceLabel ?? existing.deviceLabel;
      existing.credentialId = credential.id;
      existing.isActive = true;
      return this.connectionRepo.save(existing);
    }

    const connection = this.connectionRepo.create({
      subscriptionId: subscription.id,
      credentialId: credential.id,
      tallyCompanyId: dto.tallyCompanyId,
      tallyCompanyName: dto.tallyCompanyName,
      deviceId: dto.deviceId,
      deviceLabel: dto.deviceLabel,
    });

    this.logger.log(
      `New Tally connection registered: company=${dto.tallyCompanyId} sub=${subscription.id}`,
    );
    return this.connectionRepo.save(connection);
  }

  async findActive(subscriptionId: string, tallyCompanyId: string, deviceId: string) {
    return this.connectionRepo.findOne({
      where: { subscriptionId, tallyCompanyId, deviceId, isActive: true },
    });
  }

  async listForSubscription(subscriptionId: string) {
    return this.connectionRepo.find({ where: { subscriptionId } });
  }

  async updateLastSync(connectionId: string) {
    return this.connectionRepo.update(connectionId, { lastSyncAt: new Date() });
  }
}
