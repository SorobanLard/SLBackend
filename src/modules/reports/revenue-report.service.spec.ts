import { Test, TestingModule } from '@nestjs/testing';
import { RevenueReportService } from './revenue-report.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('RevenueReportService', () => {
  let service: RevenueReportService;
  let prisma: {
    payment: { findMany: jest.Mock; aggregate: jest.Mock };
    subscription: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      },
      subscription: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevenueReportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<RevenueReportService>(RevenueReportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('happy path', () => {
    it('aggregates revenue from payments within the date range', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { id: 'p1', amount: 100, currency: 'USD', status: 'SUCCEEDED' },
        { id: 'p2', amount: 250, currency: 'USD', status: 'SUCCEEDED' },
      ]);

      const from = new Date('2024-01-01T00:00:00.000Z');
      const to = new Date('2024-01-31T23:59:59.999Z');

      const result = await service.generateReport({ from, to });

      expect(prisma.payment.findMany).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.totalRevenue).toBe(350);
    });

    it('returns zero totals when there are no payments', async () => {
      const from = new Date('2024-02-01T00:00:00.000Z');
      const to = new Date('2024-02-29T23:59:59.999Z');

      const result = await service.generateReport({ from, to });

      expect(result.totalRevenue).toBe(0);
    });
  });

  describe('validation / error paths', () => {
    it('throws when the date range is invalid (from after to)', async () => {
      const from = new Date('2024-03-31T00:00:00.000Z');
      const to = new Date('2024-03-01T00:00:00.000Z');

      await expect(service.generateReport({ from, to })).rejects.toThrow();
    });

    it('propagates database errors from the payment query', async () => {
      prisma.payment.findMany.mockRejectedValue(new Error('db down'));

      const from = new Date('2024-01-01T00:00:00.000Z');
      const to = new Date('2024-01-31T23:59:59.999Z');

      await expect(service.generateReport({ from, to })).rejects.toThrow(
        'db down',
      );
    });
  });
});
