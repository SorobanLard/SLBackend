import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckError,
  HealthIndicatorResult,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { CacheService } from '../../common/cache/cache.service';
import { SearchService } from '../search/search.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly cache: CacheService,
    private readonly search: SearchService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary:
      'Readiness probe: checks Postgres (Prisma), Redis, Meilisearch and the event-poller checkpoint',
  })
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.redisPingIndicator(),
      () => this.meilisearchPingIndicator(),
      () => this.eventPollerCheckpointIndicator(),
    ]);
  }

  @Get('checkpoint')
  @ApiOperation({
    summary: 'Current Stellar event-poller ledger checkpoint (crash recovery)',
  })
  checkpoint() {
    return this.events.getCheckpointStatus();
  }

  private async redisPingIndicator(): Promise<HealthIndicatorResult> {
    try {
      const roundTripMs = await this.cache.ping();
      return { redis: { status: 'up', roundTripMs } };
    } catch (err) {
      throw new HealthCheckError('Redis ping failed', {
        redis: { status: 'down', message: (err as Error).message },
      });
    }
  }

  private async meilisearchPingIndicator(): Promise<HealthIndicatorResult> {
    try {
      const roundTripMs = await this.search.ping();
      return { meilisearch: { status: 'up', roundTripMs } };
    } catch (err) {
      throw new HealthCheckError('Meilisearch ping failed', {
        meilisearch: { status: 'down', message: (err as Error).message },
      });
    }
  }

  /**
   * Reports the event-poller checkpoint inside the aggregate health check.
   * Informational only: it always reports `up` (with a `checkpointHealthy`
   * flag and failure details) so a transient checkpoint write failure on the
   * poller never sends a 503 that pulls the whole service out of rotation.
   * Use GET /health/checkpoint for the authoritative checkpoint state.
   */
  private async eventPollerCheckpointIndicator(): Promise<HealthIndicatorResult> {
    const status = await this.events.getCheckpointStatus();
    return {
      event_poller_checkpoint: {
        status: 'up',
        checkpointHealthy: status.healthy,
        lastProcessedLedger: status.lastProcessedLedger,
        persistedLedger: status.persistedLedger,
        lastPolledAt: status.lastPolledAt,
        resumedFromCheckpoint: status.resumedFromCheckpoint,
        consecutiveWriteFailures: status.consecutiveWriteFailures,
        lastWriteError: status.lastWriteError,
      },
    };
  }
}
