// src/activation/activation.controller.ts
import {
  Controller, Post, Get, Body, Param,
  Headers, RawBodyRequest, Req,
  UnauthorizedException, Logger, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { ActivationService } from './activation.service';
import { ActivateDto, DeactivateDto } from './dto/activate.dto';

/**
 * These endpoints are called ONLY by the internal Lex platform (server-to-server).
 * They are NOT exposed to end users or the TDL plugin.
 *
 * Security model:
 *   - All requests must carry X-Lex-Signature: sha256=<HMAC-SHA256 of raw body>
 *   - The HMAC secret is ACTIVATION_WEBHOOK_SECRET shared between Lex app and this service
 *   - This avoids the need to validate user JWTs here — the existing Lex app
 *     already did that before calling us.
 */
@ApiTags('Activation (Internal)')
@Controller('internal/activation')
export class ActivationController {
  private readonly logger = new Logger(ActivationController.name);

  constructor(
    private readonly activationService: ActivationService,
    private readonly configService: ConfigService,
  ) {}

  @Post('activate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Activate plugin for a client after payment (called by Lex app)' })
  @ApiHeader({ name: 'X-Lex-Signature', description: 'HMAC-SHA256 of request body' })
  async activate(
    @Headers('x-lex-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() dto: ActivateDto,
  ) {
    this.verifySignature(signature, req.rawBody);
    return this.activationService.activate(dto);
  }

  @Post('deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke plugin access for a client (called by Lex app)' })
  @ApiHeader({ name: 'X-Lex-Signature', description: 'HMAC-SHA256 of request body' })
  async deactivate(
    @Headers('x-lex-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() dto: DeactivateDto,
  ) {
    this.verifySignature(signature, req.rawBody);
    return this.activationService.deactivate(dto);
  }

  @Get('status/:customerId/:clientId')
  @ApiOperation({ summary: 'Check subscription status for a customer+client pair' })
  async getStatus(
    @Headers('x-lex-signature') signature: string,
    @Param('customerId') customerId: string,
    @Param('clientId') clientId: string,
  ) {
    // GET has no body; verify signature against empty string
    this.verifySignature(signature, Buffer.from(''));
    return this.activationService.getStatus(customerId, clientId);
  }

  @Post('regenerate/:customerId/:clientId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate API credentials for an active subscription' })
  @ApiHeader({ name: 'X-Lex-Signature', description: 'HMAC-SHA256 of request body' })
  async regenerateCredentials(
    @Headers('x-lex-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
    @Param('customerId') customerId: string,
    @Param('clientId') clientId: string,
  ) {
    // POST with empty body or minimal body
    this.verifySignature(signature, req.rawBody ?? Buffer.from(''));
    return this.activationService.regenerateCredentials(customerId, clientId);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private verifySignature(signature: string, rawBody: Buffer | undefined): void {
    const secret = this.configService.get<string>('security.activationWebhookSecret');
    if (!secret) {
      throw new Error('ACTIVATION_WEBHOOK_SECRET is not configured');
    }

    if (!signature) {
      this.logger.warn('Request received without X-Lex-Signature');
      throw new UnauthorizedException('Missing X-Lex-Signature header');
    }

    const expected = `sha256=${createHmac('sha256', secret)
      .update(rawBody ?? Buffer.from(''))
      .digest('hex')}`;

    // Timing-safe comparison to prevent timing attacks
    try {
      const sigBuffer = Buffer.from(signature);
      const expBuffer = Buffer.from(expected);
      if (
        sigBuffer.length !== expBuffer.length ||
        !timingSafeEqual(sigBuffer, expBuffer)
      ) {
        throw new Error();
      }
    } catch {
      this.logger.warn('Invalid X-Lex-Signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
