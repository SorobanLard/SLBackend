import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FeeCalculatorService } from './fee-calculator.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('FeeCalculatorService (Issue #243 — unit tests)', () => {
  let service: FeeCalculatorService;

  const defaultRates = [
    { region: 'DEFAULT', ratePercent: 0 },
    { region: 'US', ratePercent: 10 },
  ];

  const mockPrisma = {
    taxRate: {
      findMany: jest.fn().mockResolvedValue(defaultRates),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeCalculatorService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(FeeCalculatorService);
    jest.clearAllMocks();
    mockPrisma.taxRate.findMany.mockResolvedValue(defaultRates);
  });

  // ------------------------------------------------------------------
  // computeBreakdown — happy path
  // ------------------------------------------------------------------

  describe('computeBreakdown', () => {
    it('returns the full fee breakdown for a configured region', async () => {
      const breakdown = await service.computeBreakdown({
        coursePrice: 100,
        platformFeePercent: 20,
        region: 'US',
      });

      expect(breakdown).toEqual({
        currency: 'USDC',
        basePrice: 100,
        platformFeePercent: 20,
        platformFeeAmount: 20,
        instructorPayout: 80,
        region: 'US',
        taxRatePercent: 10,
        taxAmount: 10,
        totalPayable: 110,
      });
    });

    it('normalizes the region key (trims and upper-cases)', async () => {
      const breakdown = await service.computeBreakdown({
        coursePrice: 100,
        platformFeePercent: 20,
        region: '  us ',
      });

      expect(breakdown.region).toBe('US');
    });

    it('falls back to the configured DEFAULT rate for unconfigured regions', async () => {
      mockPrisma.taxRate.findMany.mockResolvedValue([{ region: 'DEFAULT', ratePercent: 5 }]);

      const breakdown = await service.computeBreakdown({
        coursePrice: 100,
        platformFeePercent: 20,
        region: 'NG',
      });

      expect(breakdown.taxRatePercent).toBe(5);
      expect(breakdown.taxAmount).toBe(5);
      expect(breakdown.totalPayable).toBe(105);
    });

    it('uses 0% tax when no region and no DEFAULT rate is configured', async () => {
      mockPrisma.taxRate.findMany.mockResolvedValue([]);

      const breakdown = await service.computeBreakdown({
        coursePrice: 100,
        platformFeePercent: 20,
      });

      expect(breakdown.region).toBe('DEFAULT');
      expect(breakdown.taxRatePercent).toBe(0);
      expect(breakdown.taxAmount).toBe(0);
      expect(breakdown.totalPayable).toBe(100);
    });

    it('charges no tax when the missing region has no DEFAULT either', async () => {
      mockPrisma.taxRate.findMany.mockResolvedValue([{ region: 'US', ratePercent: 10 }]);

      const breakdown = await service.computeBreakdown({
        coursePrice: 100,
        platformFeePercent: 20,
        region: 'NG',
      });

      expect(breakdown.taxRatePercent).toBe(0);
      expect(breakdown.totalPayable).toBe(100);
    });

    it('zero platform fee pays out the full price to the instructor', async () => {
      const breakdown = await service.computeBreakdown({
        coursePrice: 75.5,
        platformFeePercent: 0,
      });

      expect(breakdown.platformFeeAmount).toBe(0);
      expect(breakdown.instructorPayout).toBe(75.5);
    });

    it('rounds every amount to 2 decimal places', async () => {
      const breakdown = await service.computeBreakdown({
        coursePrice: 19.99,
        platformFeePercent: 12.5,
        region: 'US',
      });

      expect(breakdown.platformFeeAmount).toBe(2.5);
      expect(breakdown.instructorPayout).toBe(17.49);
      expect(breakdown.taxAmount).toBe(2);
      expect(breakdown.totalPayable).toBe(21.99);
    });

    it('keeps sub-cent micro prices intact when no tax is due', async () => {
      const breakdown = await service.computeBreakdown({
        coursePrice: 0.07,
        platformFeePercent: 0,
      });

      expect(breakdown.taxAmount).toBe(0);
      expect(breakdown.totalPayable).toBe(0.07);
      expect(breakdown.instructorPayout).toBe(0.07);
    });

    // ------------------------------------------------------------------
    // computeBreakdown — validation / error paths
    // ------------------------------------------------------------------

    it('rejects a negative course price', async () => {
      await expect(
        service.computeBreakdown({ coursePrice: -1, platformFeePercent: 20 }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([-1, 100.01, 101])(
      'rejects a platform fee percent of %p (0–100 range)',
      async (feePercent) => {
        await expect(
          service.computeBreakdown({ coursePrice: 100, platformFeePercent: feePercent }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('accepts the boundary values of 0% and 100% platform fee', async () => {
      const zero = await service.computeBreakdown({ coursePrice: 100, platformFeePercent: 0 });
      const full = await service.computeBreakdown({ coursePrice: 100, platformFeePercent: 100 });

      expect(zero.platformFeeAmount).toBe(0);
      expect(full.platformFeeAmount).toBe(100);
      expect(full.instructorPayout).toBe(0);
    });
  });

  // ------------------------------------------------------------------
  // Tax rate caching
  // ------------------------------------------------------------------

  describe('tax rate caching', () => {
    it('reads rates from the database once for repeated lookups within the cache TTL', async () => {
      await service.getTaxRate('US');
      await service.getTaxRate('NG');
      await service.computeBreakdown({ coursePrice: 10, platformFeePercent: 5, region: 'US' });

      expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(1);
    });

    it('re-reads rates after the cache TTL (60s) elapses', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-21T00:00:00Z') });

      try {
        await service.getTaxRate('US');
        expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(1);

        jest.setSystemTime(new Date('2026-10-21T00:01:01Z'));

        await service.getTaxRate('US');
        expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('re-reads rates after a tax rate is upserted (cache invalidated)', async () => {
      await service.getTaxRate('US');
      expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(1);

      mockPrisma.taxRate.upsert.mockResolvedValue({ region: 'US', ratePercent: 12 });
      await service.upsertTaxRate('US', { ratePercent: 12 });

      await service.getTaxRate('US');
      expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(2);
    });

    it('re-reads rates after a tax rate is deleted (cache invalidated)', async () => {
      await service.getTaxRate('US');
      expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(1);

      mockPrisma.taxRate.findUnique.mockResolvedValue({ region: 'US', ratePercent: 10 });
      mockPrisma.taxRate.delete.mockResolvedValue({ region: 'US', ratePercent: 10 });
      await service.removeTaxRate('US');

      await service.getTaxRate('US');
      expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(2);
    });
  });

  // ------------------------------------------------------------------
  // Tax rate administration
  // ------------------------------------------------------------------

  describe('getTaxRate', () => {
    it('returns the region-configured rate', async () => {
      expect(await service.getTaxRate('us')).toBe(10);
    });

    it('returns the DEFAULT rate for an unconfigured region', async () => {
      mockPrisma.taxRate.findMany.mockResolvedValue([{ region: 'DEFAULT', ratePercent: 7.5 }]);

      expect(await service.getTaxRate('en'))
        .toBe(7.5);
    });
  });

  describe('upsertTaxRate', () => {
    it('normalizes the region and upserts with create/update payloads', async () => {
      const created = { region: 'NG', ratePercent: 15, description: null, isActive: true };
      mockPrisma.taxRate.upsert.mockResolvedValue(created);

      const result = await service.upsertTaxRate('  ng ', { ratePercent: 15 });

      expect(result).toEqual(created);
      expect(mockPrisma.taxRate.upsert).toHaveBeenCalledWith({
        where: { region: 'NG' },
        create: {
          region: 'NG',
          ratePercent: 15,
          description: undefined,
          isActive: true,
        },
        update: {
          ratePercent: 15,
          description: undefined,
          isActive: undefined,
        },
      });
    });

    it('defaults isActive to true when not provided in create', async () => {
      mockPrisma.taxRate.upsert.mockResolvedValue({ region: 'EU', ratePercent: 1 });

      await service.upsertTaxRate('EU', { ratePercent: 1 });

      expect(mockPrisma.taxRate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('removeTaxRate', () => {
    it('throws NotFoundException when the region has no configured rate', async () => {
      mockPrisma.taxRate.findUnique.mockResolvedValue(null);

      await expect(service.removeTaxRate('ZZ')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.taxRate.delete).not.toHaveBeenCalled();
    });

    it('deletes the rate and invalidates the cache', async () => {
      await service.getTaxRate('US');
      expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(1);

      mockPrisma.taxRate.findUnique.mockResolvedValue({ region: 'US', ratePercent: 10 });
      mockPrisma.taxRate.delete.mockResolvedValue({ region: 'US', ratePercent: 10 });

      const result = await service.removeTaxRate(' us ');

      expect(result).toEqual({ region: 'US', deleted: true });
      expect(mockPrisma.taxRate.delete).toHaveBeenCalledWith({
        where: { region: 'US' },
      });
      await service.getTaxRate('US');
      expect(mockPrisma.taxRate.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('listTaxRates', () => {
    it('lists all tax rates ordered by region ascending', async () => {
      const rows = [{ region: 'DEFAULT', ratePercent: 0 }];
      mockPrisma.taxRate.findMany.mockResolvedValue(rows);

      const result = await service.listTaxRates();

      expect(result).toEqual(rows);
      expect(mockPrisma.taxRate.findMany).toHaveBeenCalledWith({
        orderBy: { region: 'asc' },
      });
    });
  });
});
