import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CacheService } from '../../common/cache/cache.service';
import { SearchService } from '../search/search.service';
import type { CheckpointStatus } from '../events/events.service';

/**
 * Exercises the real health routes end-to-end: the controller is resolved from
 * a Nest module with the real TerminusModule wired in, so `check()` runs the
 * actual HealthCheckService aggregation and `checkpoint()` runs the real
 * handler that GET /health/checkpoint is bound to.
 *
 * Issue #170 — the aggregate check must cover every critical dependency:
 * Postgres (via Prisma), Redis (via CacheService ping) and Meilisearch
 * (via SearchService ping), plus the informational event-poller checkpoint.
 */
describe('HealthController (Issue #80 — checkpoint via health endpoint)', () => {
  let controller: HealthController;

  const healthyStatus: CheckpointStatus = {
    key: 'stellar-event-poller',
    lastProcessedLedger: 5123,
    persistedLedger: 5123,
    lastPolledAt: new Date('2026-08-27T12:00:00Z'),
    resumedFromCheckpoint: true,
    consecutiveWriteFailures: 0,
    lastWriteError: null,
    healthy: true,
  };

  const mockEvents = { getCheckpointStatus: jest.fn() };
  const mockCache = { ping: jest.fn() };
  const mockSearch = { ping: jest.fn() };
  // PrismaHealthIndicator.pingDb tries $runCommandRaw first, then falls back to
  // $queryRawUnsafe('SELECT 1') for SQL providers.
  const mockPrisma = {
    $runCommandRaw: jest
      .fn()
      .mockRejectedValue(new Error('Use the mongodb provider')),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ result: 1 }]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: CacheService, useValue: mockCache },
        { provide: SearchService, useValue: mockSearch },
      ],
    }).compile();

    controller = module.get(HealthController);
    jest.clearAllMocks();
    mockPrisma.$runCommandRaw.mockRejectedValue(new Error('Use the mongodb provider'));
    mockPrisma.$queryRawUnsafe.mockResolvedValue([{ result: 1 }]);
    mockCache.ping.mockResolvedValue(3);
    mockSearch.ping.mockResolvedValue(7);
    mockEvents.getCheckpointStatus.mockResolvedValue(healthyStatus);
  });

  it('GET /health/checkpoint returns the current ledger checkpoint payload', async () => {
    const result = await controller.checkpoint();

    expect(result).toEqual(healthyStatus);
    expect(mockEvents.getCheckpointStatus).toHaveBeenCalledTimes(1);
  });

  it('GET /health includes database, redis, meilisearch and event poller indicators', async () => {
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.info?.database).toEqual({ status: 'up' });
    expect(result.info?.redis).toEqual({ status: 'up', roundTripMs: 3 });
    expect(result.info?.meilisearch).toEqual({ status: 'up', roundTripMs: 7 });
    expect(result.info?.event_poller_checkpoint).toEqual(
      expect.objectContaining({
        status: 'up',
        checkpointHealthy: true,
        lastProcessedLedger: 5123,
        persistedLedger: 5123,
      }),
    );
  });

  it('GET /health surfaces a degraded checkpoint without failing the overall check', async () => {
    mockEvents.getCheckpointStatus.mockResolvedValue({
      ...healthyStatus,
      consecutiveWriteFailures: 3,
      lastWriteError: 'connection reset',
      healthy: false,
    });

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.info?.event_poller_checkpoint).toEqual(
      expect.objectContaining({
        status: 'up',
        checkpointHealthy: false,
        consecutiveWriteFailures: 3,
        lastWriteError: 'connection reset',
      }),
    );
  });

  it('GET /health fails readiness (503) when Redis is unreachable', async () => {
    mockCache.ping.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));

    const err = await controller.check().catch((e) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const response = err.getResponse();
    expect(response.status).toBe('error');
    expect(response.error.redis).toEqual(
      expect.objectContaining({
        status: 'down',
        message: 'ECONNREFUSED 127.0.0.1:6379',
      }),
    );
    expect(response.details.redis.status).toBe('down');
  });

  it('GET /health fails readiness (503) when Meilisearch is unreachable', async () => {
    mockSearch.ping.mockRejectedValue(new Error('fetch failed'));

    const err = await controller.check().catch((e) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const response = err.getResponse();
    expect(response.status).toBe('error');
    expect(response.error.meilisearch).toEqual(
      expect.objectContaining({
        status: 'down',
        message: 'fetch failed',
      }),
    );
    expect(response.details.meilisearch.status).toBe('down');
  });

  it('GET /health aggregates 503 when Prisma ping fails too', async () => {
    mockPrisma.$runCommandRaw.mockRejectedValue(
      new Error('Use the mongodb provider'),
    );
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('Connection terminated'));
    mockCache.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const err = await controller.check().catch((e) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getResponse().status).toBe('error');
    expect(err.getResponse().details.database).toBeDefined();
    expect(err.getResponse().details.redis.status).toBe('down');
  });
});
