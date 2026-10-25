import { AnalyticsService } from './analytics.service';

describe('Analytics bounded reads (#179)', () => {
  const prisma = {
    analyticsEvent: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  };
  const service = new AnalyticsService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an unbounded raw query without querying the database', async () => {
    await expect(service.queryRawEvents({} as any)).rejects.toThrow('Both from and to');
    expect(prisma.analyticsEvent.findMany).not.toHaveBeenCalled();
  });

  it('rejects ranges spanning more than 90 days', async () => {
    await expect(service.queryRawEvents({ from: '2026-01-01', to: '2026-06-01' } as any))
      .rejects.toThrow('at most 90 days');
  });

  it('filters bounded reads by occurredAt and caps the page size', async () => {
    await service.queryRawEvents({ from: '2026-10-01', to: '2026-10-02', limit: 999 } as any);
    expect(prisma.analyticsEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 200,
      where: { occurredAt: { gte: new Date('2026-10-01'), lte: new Date('2026-10-02') } },
    }));
  });
});
