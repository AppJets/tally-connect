// src/activation/dto/activate.dto.ts
import { IsString, IsUUID, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Payload sent by the existing Lex app after a successful payment.
 * The existing app signs this request with ACTIVATION_WEBHOOK_SECRET
 * so we can trust the identity without re-validating the JWT here.
 */
export class ActivateDto {
  @ApiProperty({ description: 'customerId from Lex Auth Service' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ description: 'Agency that purchased the plugin' })
  @IsUUID()
  agencyId: string;

  @ApiProperty({ description: 'The specific client this activation is scoped to' })
  @IsUUID()
  clientId: string;

  @ApiProperty({ description: 'Subscription duration in days (e.g. 30, 365)', example: 365 })
  @IsInt()
  @Min(1)
  @Max(3650)
  planDurationDays: number;

  @ApiPropertyOptional({ description: 'Opaque payment reference from billing system' })
  @IsOptional()
  @IsString()
  paymentReference?: string;
}

export class DeactivateDto {
  @ApiProperty()
  @IsUUID()
  customerId: string;

  @ApiProperty()
  @IsUUID()
  clientId: string;
}
