// src/normalization/normalization.service.ts
import { Injectable } from '@nestjs/common';

/**
 * Transforms raw Tally field names & structures into Lex's
 * standardized accounting schema before persistence.
 *
 * Tally's XML uses inconsistent casing and legacy field names.
 * All mapping logic is centralized here so schema changes are
 * a single-file edit without touching processors or entities.
 */
@Injectable()
export class NormalizationService {

  normalizeVoucher(raw: Record<string, any>) {
    return {
      connectionId: raw.connectionId ?? null,

      // Tally uses "SALES" "PURCHASE" etc — normalize to title case
      voucherType: this.normalizeName(
        raw.voucherType ?? raw.VOUCHERTYPENAME ?? raw.vouchertypename,
      ),

      partyName: this.normalizeName(
        raw.partyName ?? raw.PARTYLEDGERNAME ?? raw.partyledgername,
      ),

      narration: (raw.narration ?? raw.NARRATION ?? '').trim(),

      amount: this.normalizeAmount(
        raw.amount ?? raw.AMOUNT ?? raw.grossAmount,
      ),

      gstin: this.normalizeGSTIN(
        raw.gstin ?? raw.GSTIN ?? raw.buyersgstin,
      ),

      placeOfSupply: raw.placeOfSupply ?? raw.PLACEOFSUPPLY ?? null,

      gstAmount: raw.gstAmount != null
        ? this.normalizeAmount(raw.gstAmount)
        : null,
    };
  }

  normalizeLedger(raw: Record<string, any>) {
    const closingBalance = this.normalizeAmount(
      raw.closingBalance ?? raw.CLOSINGBALANCE ?? 0,
    );

    return {
      connectionId: raw.connectionId ?? null,

      groupName: this.normalizeName(
        raw.groupName ?? raw.PARENT ?? raw.parent,
      ),

      // Tally returns negative for Cr, positive for Dr in some contexts
      closingBalance: Math.abs(closingBalance),

      balanceType: raw.balanceType
        ?? (closingBalance < 0 ? 'Cr' : 'Dr'),

      gstin: this.normalizeGSTIN(
        raw.gstin ?? raw.GSTIN,
      ),
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private normalizeName(value: string | undefined): string | null {
    if (!value) return null;
    return value.trim();
  }

  private normalizeAmount(value: any): number {
    if (value == null) return 0;
    const parsed = typeof value === 'string'
      ? parseFloat(value.replace(/,/g, ''))
      : Number(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  private normalizeGSTIN(value: string | undefined): string | null {
    if (!value) return null;
    const cleaned = value.trim().toUpperCase();
    // Basic GSTIN format validation: 15 alphanumeric characters
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(cleaned)
      ? cleaned
      : null;
  }
}
