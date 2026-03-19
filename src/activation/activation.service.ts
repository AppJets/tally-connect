// src/activation/activation.service.ts
import {
  Injectable, ConflictException, NotFoundException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { ApiCredential } from './entities/api-credential.entity';
import { ActivateDto, DeactivateDto } from './dto/activate.dto';

export interface ActivationResult {
  subscriptionId: string;
  apiKey: string;
  /** Raw secret — shown ONCE. Client must store it securely. */
  apiSecret: string;
  apiSecretPrefix: string;
  expiresAt: Date;
  message: string;
}

@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(ApiCredential)
    private readonly credentialRepo: Repository<ApiCredential>,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Called by the existing Lex app after a confirmed payment.
   * Idempotent: if the client is already active, renews the expiry
   * and rotates credentials instead of throwing.
   */
  async activate(dto: ActivateDto): Promise<ActivationResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Check for an existing subscription for this customer+client pair
      let subscription = await this.subscriptionRepo.findOne({
        where: { customerId: dto.customerId, clientId: dto.clientId },
      });

      const now = new Date();
      const expiresAt = new Date(now.getTime() + dto.planDurationDays * 86_400_000);

      if (subscription) {
        // Renew: extend expiry, reactivate if revoked/expired
        subscription.status = SubscriptionStatus.ACTIVE;
        subscription.planDurationDays = dto.planDurationDays;
        subscription.activatedAt = now;
        subscription.expiresAt = expiresAt;
        if (dto.paymentReference) {
          subscription.paymentReference = dto.paymentReference;
        }
        await queryRunner.manager.save(subscription);

        // Revoke any old credentials for this subscription
        await queryRunner.manager.update(
          ApiCredential,
          { subscriptionId: subscription.id },
          { isActive: false },
        );

        this.logger.log(`Subscription renewed for customer=${dto.customerId} client=${dto.clientId}`);
      } else {
        // First-time activation
        subscription = this.subscriptionRepo.create({
          customerId: dto.customerId,
          agencyId: dto.agencyId,
          clientId: dto.clientId,
          planDurationDays: dto.planDurationDays,
          status: SubscriptionStatus.ACTIVE,
          activatedAt: now,
          expiresAt,
          paymentReference: dto.paymentReference,
        });
        await queryRunner.manager.save(subscription);
        this.logger.log(`New subscription created for customer=${dto.customerId} client=${dto.clientId}`);
      }

      // Generate fresh api_key + api_secret
      const { apiKey, apiSecret, apiSecretHash, apiSecretPrefix } =
        await this.generateCredentials();

      const credential = this.credentialRepo.create({
        subscriptionId: subscription.id,
        apiKey,
        apiSecretHash,
        apiSecretPrefix,
        isActive: true,
        expiresAt,
      });
      await queryRunner.manager.save(credential);

      await queryRunner.commitTransaction();

      return {
        subscriptionId: subscription.id,
        apiKey,
        apiSecret, // ← raw, shown once
        apiSecretPrefix,
        expiresAt,
        message:
          subscription
            ? 'Plugin activated. Store your api_secret securely — it will not be shown again.'
            : 'Plugin renewed. New credentials issued; previous credentials have been revoked.',
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Activation failed', err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /** Revoke all credentials for a customer+client pair */
  async deactivate(dto: DeactivateDto): Promise<{ message: string }> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { customerId: dto.customerId, clientId: dto.clientId },
    });

    if (!subscription) {
      throw new NotFoundException('No active subscription found for this customer and client.');
    }

    subscription.status = SubscriptionStatus.REVOKED;
    await this.subscriptionRepo.save(subscription);

    await this.credentialRepo.update(
      { subscriptionId: subscription.id },
      { isActive: false },
    );

    this.logger.log(`Subscription revoked for customer=${dto.customerId} client=${dto.clientId}`);
    return { message: 'Plugin deactivated. All credentials revoked.' };
  }

  async getStatus(customerId: string, clientId: string) {
    const subscription = await this.subscriptionRepo.findOne({
      where: { customerId, clientId },
    });

    if (!subscription) {
      return { active: false, message: 'No subscription found.' };
    }

    const isExpired =
      subscription.status === SubscriptionStatus.ACTIVE &&
      subscription.expiresAt < new Date();

    if (isExpired) {
      subscription.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepo.save(subscription);
    }

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      active: subscription.status === SubscriptionStatus.ACTIVE,
      expiresAt: subscription.expiresAt,
      clientId: subscription.clientId,
    };
  }

  /**
   * Regenerate API credentials for an existing subscription.
   * Revokes old credentials and issues new ones.
   */
  async regenerateCredentials(customerId: string, clientId: string): Promise<ActivationResult> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { customerId, clientId },
    });

    if (!subscription) {
      throw new NotFoundException('No subscription found for this customer and client.');
    }

    if (subscription.status !== SubscriptionStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot regenerate credentials for ${subscription.status} subscription. Please reactivate first.`
      );
    }

    if (subscription.expiresAt < new Date()) {
      subscription.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepo.save(subscription);
      throw new BadRequestException('Subscription has expired. Please renew to get new credentials.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Revoke all existing credentials
      await queryRunner.manager.update(
        ApiCredential,
        { subscriptionId: subscription.id },
        { isActive: false },
      );

      // Generate fresh credentials
      const { apiKey, apiSecret, apiSecretHash, apiSecretPrefix } =
        await this.generateCredentials();

      const credential = this.credentialRepo.create({
        subscriptionId: subscription.id,
        apiKey,
        apiSecretHash,
        apiSecretPrefix,
        isActive: true,
        expiresAt: subscription.expiresAt,
      });
      await queryRunner.manager.save(credential);

      await queryRunner.commitTransaction();

      this.logger.log(`Credentials regenerated for customer=${customerId} client=${clientId}`);

      return {
        subscriptionId: subscription.id,
        apiKey,
        apiSecret,
        apiSecretPrefix,
        expiresAt: subscription.expiresAt,
        message: 'New credentials generated. Previous credentials have been revoked. Store your api_secret securely — it will not be shown again.',
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Credential regeneration failed', err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async generateCredentials() {
    const saltRounds = this.configService.get<number>('security.apiSecretSaltRounds', 12);

    const apiKey = `ltk_${uuidv4().replace(/-/g, '')}`; // lt = lex tally key
    const rawSecret = `lts_${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '')}`; // long entropy
    const apiSecretHash = await bcrypt.hash(rawSecret, saltRounds);
    const apiSecretPrefix = rawSecret.slice(0, 8);

    return { apiKey, apiSecret: rawSecret, apiSecretHash, apiSecretPrefix };
  }

  /** Used by ApiKeyGuard to validate inbound sync requests */
  async validateCredential(
    apiKey: string,
    apiSecret: string,
  ): Promise<ApiCredential & { subscription: Subscription } | null> {
    const credential = await this.credentialRepo.findOne({
      where: { apiKey, isActive: true },
      relations: ['subscription'],
    });

    if (!credential) return null;
    if (credential.expiresAt < new Date()) return null;
    if (credential.subscription.status !== SubscriptionStatus.ACTIVE) return null;

    const valid = await bcrypt.compare(apiSecret, credential.apiSecretHash);
    if (!valid) return null;

    // Fire-and-forget last_used_at update
    this.credentialRepo.update(credential.id, { lastUsedAt: new Date() }).catch(() => {});

    return credential as ApiCredential & { subscription: Subscription };
  }
}
