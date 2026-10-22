// fee-calculator.service.ts
import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Immutable breakdown of the money movements for a single course purchase.
 *
 * All monetary amounts are expressed in USDC and rounded to two decimal
 * places (the smallest unit tracked by this service).
 */
export interface FeeBreakdown {
  /** Settlement currency. Always `'USDC'` for on-chain payments. */
  currency: string;
  /** Course price before fees or tax. */
  basePrice: number;
  /** Platform fee percentage applied to {@link basePrice} (0–100). */
  platformFeePercent: number;
  /** Platform fee amount deducted from {@link basePrice}. */
  platformFeeAmount: number;
  /** Amount credited to the instructor: `basePrice - platformFeeAmount`. */
  instructorPayout: number;
  /** Normalized (upper-case) tax region, or `'DEFAULT'` when unresolved. */
  region: string;
  /** Regional tax rate percentage applied to {@link basePrice}. */
  taxRatePercent: number;
  /** Tax amount added on top of {@link basePrice}. */
  taxAmount: number;
  /** Amount charged to the student: `basePrice + taxAmount`. */
  totalPayable: number;
}

/** How long tax rates are cached in memory before re-reading from the DB. */
const TAX_RATE_CACHE_TTL_MS = 60_000;
const DEFAULT_REGION = 'DEFAULT';

@Injectable()
export class FeeCalculatorService {
  private readonly logger = new Logger(FeeCalculatorService.name);

  private taxRateCache: { rates: Map<string, number>; loadedAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ----------------------------------------------------------
  // TAX RATES — admin-configurable, stored in `tax_rates`
  // ----------------------------------------------------------

  private normalizeRegion(region?: string): string {
    return (region?.trim() || DEFAULT_REGION).toUpperCase();
  }

  private async loadTaxRates(): Promise<Map<string, number>> {
    if (this.taxRateCache && Date.now() - this.taxRateCache.loadedAt < TAX_RATE_CACHE_TTL_MS) {
      return this.taxRateCache.rates;
    }
    const rows = await this.prisma.taxRate.findMany({ where: { isActive: true } });
    const rates = new Map(rows.map((r) => [r.region, Number(r.ratePercent)]));
    this.taxRateCache = { rates, loadedAt: Date.now() };
    return rates;
  }

  private invalidateTaxRateCache() {
    this.taxRateCache = null;
  }

  /**
   * Resolves the active tax rate for a region.
   *
   * The region is trimmed and upper-cased before lookup. If no active rate is
   * configured for that region, the `DEFAULT` rate is used (and a warning is
   * logged) so that checkout does not fail outright. If no `DEFAULT` rate is
   * configured either, `0` is returned.
   *
   * Results are cached in memory for {@link TAX_RATE_CACHE_TTL_MS} (60s), so
   * repeated checkouts do not hit the database on every calculation.
   *
   * @param region ISO country code, `'EU'`, or `'DEFAULT'`. Omit for DEFAULT.
   * @returns Tax rate as a percentage (for example `7.5` means 7.5%).
   *
   * @example
   * // With a configured NG rate of 7.5 and a DEFAULT rate of 0:
   * await getTaxRate('ng');       // 7.5
   * await getTaxRate('unknown');  // 0 (falls back to DEFAULT + warning)
   */
  async getTaxRate(region?: string): Promise<number> {
    const key = this.normalizeRegion(region);
    const rates = await this.loadTaxRates();
    const rate = rates.get(key);
    if (rate !== undefined) return rate;

    if (key !== DEFAULT_REGION) {
      this.logger.warn(`No tax rate configured for region "${region}", falling back to default`);
    }
    return rates.get(DEFAULT_REGION) ?? 0;
  }

  /**
   * Lists every configured tax rate, including inactive entries, ordered
   * alphabetically by region. Intended for the admin tax-rate dashboard.
   *
   * @returns All rows in the `tax_rates` table ordered by `region` ascending.
   */
  listTaxRates() {
    return this.prisma.taxRate.findMany({ orderBy: { region: 'asc' } });
  }

  /**
   * Creates or replaces the configured tax rate for a region.
   *
   * The region is normalized to upper-case, so `ng`, `Ng`, and `NG` all refer
   * to the same row. Upserting invalidates the in-memory tax-rate cache so the
   * next {@link getTaxRate} call sees the new value immediately.
   *
   * `ratePercent` is validated by `UpsertTaxRateDto` as a percentage between 0
   * and 100 with at most two decimal places. Amounts computed from it are
   * rounded to two decimal USDC places.
   *
   * @param region Region key (`NG`, `EU`, `DEFAULT`, ...).
   * @param dto New rate configuration; `isActive` defaults to `true`.
   * @returns The created or updated tax-rate record.
   *
   * @example
   * await upsertTaxRate('ng', { ratePercent: 7.5, description: 'Nigeria VAT' });
   * await getTaxRate('NG'); // 7.5
   */
  async upsertTaxRate(
    region: string,
    dto: { ratePercent: number; description?: string; isActive?: boolean },
  ) {
    const key = this.normalizeRegion(region);
    const taxRate = await this.prisma.taxRate.upsert({
      where: { region: key },
      create: {
        region: key,
        ratePercent: dto.ratePercent,
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
      update: {
        ratePercent: dto.ratePercent,
        description: dto.description,
        isActive: dto.isActive,
      },
    });
    this.invalidateTaxRateCache();
    this.logger.log(`Tax rate for ${key} set to ${dto.ratePercent}%`);
    return taxRate;
  }

  /**
   * Deletes the configured tax rate for a region.
   *
   * The region is normalized to upper-case before lookup. After deletion the
   * in-memory cache is invalidated, so subsequent lookups fall back to the
   * `DEFAULT` rate (or `0` when no default exists). Removing a region that has
   * no configured rate throws {@link NotFoundException}.
   *
   * @param region Region key (`NG`, `EU`, `DEFAULT`, ...).
   * @returns `{ region, deleted: true }` when the row was removed.
   * @throws NotFoundException When no tax rate is configured for the region.
   *
   * @example
   * await removeTaxRate('ng');
   * await getTaxRate('NG'); // DEFAULT rate (or 0)
   */
  async removeTaxRate(region: string) {
    const key = this.normalizeRegion(region);
    const existing = await this.prisma.taxRate.findUnique({ where: { region: key } });
    if (!existing) throw new NotFoundException(`No tax rate configured for region "${key}"`);

    await this.prisma.taxRate.delete({ where: { region: key } });
    this.invalidateTaxRateCache();
    this.logger.log(`Tax rate for ${key} removed`);
    return { region: key, deleted: true };
  }

  /** Rounds to 2 decimal places, the smallest unit tracked for USDC amounts. */
  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  /**
   * Computes the full USDC fee and tax breakdown for a course purchase.
   *
   * Calculation rules:
   * - `platformFeeAmount = round(coursePrice * platformFeePercent / 100)`
   * - `instructorPayout = round(coursePrice - platformFeeAmount)`
   * - `taxAmount = round(coursePrice * taxRatePercent / 100)`
   * - `totalPayable = round(coursePrice + taxAmount)`
   *
   * Tax is charged on the course price only; it is not applied on top of the
   * platform fee. All amounts are rounded to two decimal places using
   * half-up rounding (`Math.round` plus `Number.EPSILON`), which matches the
   * precision of USDC amounts handled on-chain. The platform fee is deducted
   * from the course price before the instructor payout is calculated, so the
   * student-facing total never includes the platform fee twice.
   *
   * @param params.coursePrice Course price in USDC. Must be >= 0.
   * @param params.platformFeePercent Platform fee percentage (0–100).
   * @param params.region Region used to resolve the tax rate; omitted/unknown
   *   regions fall back to the configured `DEFAULT` rate.
   * @returns A {@link FeeBreakdown} with all amounts in USDC.
   * @throws BadRequestException If `coursePrice` is negative or the platform
   *   fee percentage is outside 0–100.
   *
   * @example
   * // Course costs 100 USDC, platform fee is 10%, NG tax rate is 7.5%:
   * const breakdown = await computeBreakdown({
   *   coursePrice: 100,
   *   platformFeePercent: 10,
   *   region: 'NG',
   * });
   * // {
   * //   currency: 'USDC',
   * //   basePrice: 100,
   * //   platformFeePercent: 10,
   * //   platformFeeAmount: 10,
   * //   instructorPayout: 90,
   * //   region: 'NG',
   * //   taxRatePercent: 7.5,
   * //   taxAmount: 7.5,
   * //   totalPayable: 107.5,
   * // }
   */
  async computeBreakdown(params: {
    coursePrice: number;
    platformFeePercent: number;
    region?: string;
  }): Promise<FeeBreakdown> {
    const { coursePrice, platformFeePercent, region } = params;

    if (coursePrice < 0) {
      throw new BadRequestException('Course price cannot be negative');
    }
    if (platformFeePercent < 0 || platformFeePercent > 100) {
      throw new BadRequestException('Platform fee percent must be between 0 and 100');
    }

    const taxRatePercent = await this.getTaxRate(region);
    const platformFeeAmount = this.round(coursePrice * (platformFeePercent / 100));
    const instructorPayout = this.round(coursePrice - platformFeeAmount);
    const taxAmount = this.round(coursePrice * (taxRatePercent / 100));
    const totalPayable = this.round(coursePrice + taxAmount);

    return {
      currency: 'USDC',
      basePrice: this.round(coursePrice),
      platformFeePercent,
      platformFeeAmount,
      instructorPayout,
      region: this.normalizeRegion(region),
      taxRatePercent,
      taxAmount,
      totalPayable,
    };
  }
}
