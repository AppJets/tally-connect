// src/sync/dto/voucher-sync.dto.ts
import {
  IsString, IsNotEmpty, IsNumber, IsOptional,
  IsDateString, ValidateNested, IsArray, IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VoucherLedgerEntryDto {
  @IsString() @IsNotEmpty()
  ledgerName: string;

  @IsNumber()
  amount: number;

  /** Dr / Cr */
  @IsString()
  type: string;
}

export class VoucherSyncDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  tallyCompanyId: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  deviceId: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  voucherNumber: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  voucherType: string;

  @ApiProperty({ example: '2024-04-01' })
  @IsDateString()
  voucherDate: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  partyName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  narration?: string;

  @ApiProperty()
  @IsNumber()
  amount: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  gstin?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  placeOfSupply?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  gstAmount?: number;

  @ApiPropertyOptional({ type: [VoucherLedgerEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VoucherLedgerEntryDto)
  ledgerEntries?: VoucherLedgerEntryDto[];

  /** Raw Tally XML payload parsed to JSON — stored verbatim */
  @ApiPropertyOptional()
  @IsOptional()
  rawData?: Record<string, any>;
}

// ── Ledger Sync ───────────────────────────────────────────────────────────────

export class LedgerSyncDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  tallyCompanyId: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  deviceId: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  ledgerName: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  groupName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  closingBalance?: number;

  @ApiPropertyOptional({ enum: ['Dr', 'Cr'] })
  @IsOptional() @IsString()
  balanceType?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  gstin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  rawData?: Record<string, any>;
}

export class BulkLedgerSyncDto {
  @ApiProperty()
  @IsString() @IsNotEmpty()
  tallyCompanyId: string;

  @ApiProperty()
  @IsString() @IsNotEmpty()
  deviceId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LedgerSyncDto)
  ledgers: LedgerSyncDto[];
}
