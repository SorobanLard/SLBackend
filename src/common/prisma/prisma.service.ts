// prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma's PostgreSQL connection pool is configured through the datasource URL.
 * Environment defaults can be overridden by explicit URL parameters.
 */
export function configuredDatabaseUrl(raw = process.env.DATABASE_URL): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (!url.searchParams.has('connection_limit')) {
    const limit = Number(process.env.PRISMA_CONNECTION_LIMIT ?? '10');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid PRISMA_CONNECTION_LIMIT');
    url.searchParams.set('connection_limit', String(limit));
  }
  if (!url.searchParams.has('pool_timeout')) {
    const timeout = Number(process.env.PRISMA_POOL_TIMEOUT_SECONDS ?? '10');
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300) throw new Error('Invalid PRISMA_POOL_TIMEOUT_SECONDS');
    url.searchParams.set('pool_timeout', String(timeout));
  }
  return url.toString();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = configuredDatabaseUrl();
    super(url ? { datasources: { db: { url } } } : {});
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
