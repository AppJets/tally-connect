// src/common/guards/api-key.guard.ts
import {
  Injectable, CanActivate, ExecutionContext,
  UnauthorizedException, Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ActivationService } from '../../activation/activation.service';

/**
 * Validates requests from the TDL plugin using api_key + api_secret.
 *
 * Header contract:
 *   X-API-Key:    <apiKey>          (publicly visible key)
 *   X-API-Secret: <rawApiSecret>    (sensitive — HTTPS only)
 *
 * On success, attaches `credential` and `subscription` to request
 * for downstream controllers/services to use without re-querying.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly activationService: ActivationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const apiKey = req.headers['x-api-key'] as string;
    const apiSecret = req.headers['x-api-secret'] as string;

    if (!apiKey || !apiSecret) {
      throw new UnauthorizedException('X-API-Key and X-API-Secret headers are required');
    }

    const credential = await this.activationService.validateCredential(apiKey, apiSecret);

    if (!credential) {
      this.logger.warn(`Invalid credentials attempt for apiKey=${apiKey?.slice(0, 12)}...`);
      throw new UnauthorizedException('Invalid or expired API credentials');
    }

    // Attach to request for use in controllers/services
    (req as any).credential = credential;
    (req as any).subscription = credential.subscription;

    return true;
  }
}
