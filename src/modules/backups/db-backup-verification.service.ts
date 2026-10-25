import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { DB_BACKUP_S3_CLIENT } from './backups.constants';

export type BackupVerificationState = 'SUCCESS' | 'FAILED' | 'SKIPPED';

export interface BackupIntegrityReport {
  tableCount: number;
  appliedMigrations: number;
  incompleteMigrations: number;
  keyTablesPresent: number;
  expectedKeyTables: number;
}

export interface BackupVerificationStatus {
  state: BackupVerificationState;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  backupKey?: string;
  backupLastModified?: string;
  sizeBytes?: number;
  checksumVerified?: boolean;
  restoreDurationMs?: number;
  integrity?: BackupIntegrityReport;
  message?: string;
}

interface DatabaseConnection {
  hostname: string;
  port: string;
  username: string;
  password: string;
  database: string;
  sslMode?: string;
}

interface LatestBackup {
  key: string;
  lastModified: Date;
}

const KEY_TABLES = [
  'users',
  'courses',
  'enrollments',
  'assignments',
  'assignment_submissions',
  'certificates',
  'event_poller_checkpoints',
];

const INTEGRITY_QUERY = `
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS table_count,
  (SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied_migrations,
  (SELECT COUNT(*) FROM "_prisma_migrations"
    WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS incomplete_migrations,
  (SELECT COUNT(*) FROM (VALUES ${KEY_TABLES.map((name) => `('${name}')`).join(', ')})
    AS expected(name)
    WHERE to_regclass('public.' || expected.name) IS NOT NULL) AS key_tables_present
`;

/**
 * DbBackupVerificationService
 *
 * Restores the most recent database dump from S3 into an isolated scratch
 * database and runs a light integrity check. A backup that has never been
 * restored is not a verified backup.
 *
 * Safety:
 *  - Disabled by default (`BACKUP_VERIFY_ENABLED=false`).
 *  - Requires an explicit `BACKUP_VERIFY_DATABASE_URL` that must point at a
 *    different database than `DATABASE_URL`.
 *  - The scratch database's `public` schema is dropped and recreated before the
 *    restore, so the target must never be the production database.
 */
@Injectable()
export class DbBackupVerificationService {
  private readonly logger = new Logger(DbBackupVerificationService.name);
  private verificationInProgress = false;
  private lastRunStatus: BackupVerificationStatus | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(DB_BACKUP_S3_CLIENT) private readonly s3Client: S3Client,
  ) {}

  /** Nightly at 03:30 UTC — after the 02:00 UTC backup. */
  @Cron('0 30 3 * * *', {
    name: 'nightly-database-backup-verification',
    timeZone: 'UTC',
  })
  async handleScheduledVerification(): Promise<BackupVerificationStatus> {
    return this.runVerification();
  }

  async runVerification(): Promise<BackupVerificationStatus> {
    const startedAt = new Date();

    if (!this.isVerificationEnabled()) {
      return this.recordSkipped(
        startedAt,
        'Database backup verification is disabled',
      );
    }

    if (this.verificationInProgress) {
      return this.recordSkipped(
        startedAt,
        'A database backup verification is already in progress',
      );
    }

    this.verificationInProgress = true;
    let temporaryDirectory: string | undefined;

    this.logger.log(
      `Database backup verification started at ${startedAt.toISOString()}`,
    );

    try {
      const sourceUrl = this.getRequiredConfig('DATABASE_URL');
      const scratchUrl = this.getRequiredConfig('BACKUP_VERIFY_DATABASE_URL');
      const bucket = this.getRequiredConfig('BACKUP_S3_BUCKET');
      const prefix = this.getObjectPrefix();

      const sourceConnection = this.parseDatabaseUrl(sourceUrl);
      const scratchConnection = this.parseDatabaseUrl(scratchUrl);
      this.assertScratchDatabase(sourceConnection, scratchConnection);

      const latestBackup = await this.findLatestBackup(bucket, prefix);
      if (!latestBackup) {
        throw new Error(
          `No database backup (*.dump) found in s3://${bucket}/${prefix}/`,
        );
      }

      temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'sorobanlard-backup-verify-'),
      );
      const dumpPath = join(temporaryDirectory, 'latest.dump');

      this.logger.log(
        `Verifying backup ${latestBackup.key} (last modified ${latestBackup.lastModified.toISOString()})`,
      );

      const download = await this.downloadBackup(
        bucket,
        latestBackup.key,
        dumpPath,
      );
      const dumpStats = await stat(dumpPath);
      if (!dumpStats.isFile() || dumpStats.size === 0) {
        throw new Error('Downloaded backup archive is empty');
      }

      const checksumVerified = await this.verifyChecksum(
        dumpPath,
        download.checksumSha256,
      );

      // Validate the archive before touching the scratch database.
      await this.runDatabaseCommand('pg_restore', ['--list', dumpPath]);

      await this.resetScratchDatabase(scratchConnection);

      const restoreStartedAt = Date.now();
      await this.restoreDump(dumpPath, scratchConnection);
      const restoreDurationMs = Date.now() - restoreStartedAt;

      const integrity = await this.checkIntegrity(scratchConnection);
      this.assertIntegrity(integrity);

      const status = this.createStatus(startedAt, 'SUCCESS', {
        backupKey: latestBackup.key,
        backupLastModified: latestBackup.lastModified.toISOString(),
        sizeBytes: dumpStats.size,
        checksumVerified,
        restoreDurationMs,
        integrity,
      });
      this.lastRunStatus = status;
      this.logger.log(
        `Database backup verification succeeded ${JSON.stringify(status)}`,
      );
      return status;
    } catch (error) {
      const message = this.getErrorMessage(error);
      const status = this.createStatus(startedAt, 'FAILED', { message });
      this.lastRunStatus = status;
      this.logger.error(
        `Database backup verification failed ${JSON.stringify(status)}`,
      );
      return status;
    } finally {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true }).catch(
          (error) =>
            this.logger.warn(
              `Failed to remove temporary verification files: ${this.getErrorMessage(error)}`,
            ),
        );
      }
      this.verificationInProgress = false;
    }
  }

  getLastRunStatus(): BackupVerificationStatus | null {
    return this.lastRunStatus ? { ...this.lastRunStatus } : null;
  }

  private async findLatestBackup(
    bucket: string,
    prefix: string,
  ): Promise<LatestBackup | null> {
    let continuationToken: string | undefined;
    let latest: LatestBackup | null = null;

    do {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${prefix}/`,
          ContinuationToken: continuationToken,
        }),
      );

      for (const object of response.Contents ?? []) {
        if (!object.Key?.endsWith('.dump') || !object.LastModified) continue;

        if (
          !latest ||
          object.LastModified > latest.lastModified ||
          (object.LastModified.getTime() === latest.lastModified.getTime() &&
            object.Key > latest.key)
        ) {
          latest = { key: object.Key, lastModified: object.LastModified };
        }
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return latest;
  }

  private async downloadBackup(
    bucket: string,
    key: string,
    destination: string,
  ): Promise<{ checksumSha256?: string }> {
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ChecksumMode: 'ENABLED',
      }),
    );

    if (!response.Body) {
      throw new Error(`Backup object ${key} has no body`);
    }

    await pipeline(
      response.Body as NodeJS.ReadableStream,
      createWriteStream(destination),
    );

    return { checksumSha256: response.ChecksumSHA256 };
  }

  private async verifyChecksum(
    dumpPath: string,
    expectedChecksum?: string,
  ): Promise<boolean> {
    if (!expectedChecksum) {
      this.logger.warn(
        'Backup object has no SHA256 checksum metadata; skipping checksum comparison',
      );
      return false;
    }

    const hash = createHash('sha256');
    for await (const chunk of createReadStream(dumpPath)) {
      hash.update(chunk);
    }
    const actualChecksum = hash.digest('base64');

    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        'Backup checksum mismatch: downloaded archive does not match the stored SHA256 checksum',
      );
    }

    return true;
  }

  private async resetScratchDatabase(
    connection: DatabaseConnection,
  ): Promise<void> {
    await this.runDatabaseCommand(
      'psql',
      [
        '--no-password',
        '--set',
        'ON_ERROR_STOP=1',
        '--command',
        'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
      ],
      connection,
    );
  }

  private async restoreDump(
    dumpPath: string,
    connection: DatabaseConnection,
  ): Promise<void> {
    await this.runDatabaseCommand(
      'pg_restore',
      [
        '--no-password',
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--dbname',
        connection.database,
        dumpPath,
      ],
      connection,
    );
  }

  private async checkIntegrity(
    connection: DatabaseConnection,
  ): Promise<BackupIntegrityReport> {
    const output = await this.runDatabaseCommand(
      'psql',
      [
        '--no-password',
        '--set',
        'ON_ERROR_STOP=1',
        '--tuples-only',
        '--no-align',
        '--field-separator',
        '|',
        '--command',
        INTEGRITY_QUERY,
      ],
      connection,
    );

    const values = output.trim().split('|').map((value) => Number(value.trim()));
    if (values.length !== 4 || values.some((value) => !Number.isInteger(value))) {
      throw new Error(`Unexpected integrity-check output: ${output.trim()}`);
    }

    const [
      tableCount,
      appliedMigrations,
      incompleteMigrations,
      keyTablesPresent,
    ] = values;

    return {
      tableCount,
      appliedMigrations,
      incompleteMigrations,
      keyTablesPresent,
      expectedKeyTables: KEY_TABLES.length,
    };
  }

  private assertIntegrity(integrity: BackupIntegrityReport): void {
    const problems: string[] = [];

    if (integrity.tableCount <= 0) {
      problems.push('restored database has no tables');
    }
    if (integrity.appliedMigrations <= 0) {
      problems.push('no applied Prisma migrations found');
    }
    if (integrity.incompleteMigrations > 0) {
      problems.push(
        `${integrity.incompleteMigrations} incomplete/rolled-back migration(s) found`,
      );
    }
    if (integrity.keyTablesPresent !== integrity.expectedKeyTables) {
      problems.push(
        `only ${integrity.keyTablesPresent}/${integrity.expectedKeyTables} key tables are present`,
      );
    }

    if (problems.length > 0) {
      throw new Error(`Backup integrity check failed: ${problems.join('; ')}`);
    }
  }

  private runDatabaseCommand(
    command: string,
    args: string[],
    connection?: DatabaseConnection,
  ): Promise<string> {
    const commandEnvironment = connection
      ? {
          ...process.env,
          PGHOST: connection.hostname,
          PGPORT: connection.port,
          PGUSER: connection.username,
          PGPASSWORD: connection.password,
          PGDATABASE: connection.database,
          ...(connection.sslMode ? { PGSSLMODE: connection.sslMode } : {}),
        }
      : process.env;

    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        {
          env: commandEnvironment,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout);
            return;
          }

          const detail = stderr.trim() || error.message;
          reject(new Error(`${command} failed: ${detail}`));
        },
      );
    });
  }

  private parseDatabaseUrl(databaseUrl: string): DatabaseConnection {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(databaseUrl);
    } catch {
      throw new Error('Database URL must be a valid PostgreSQL URL');
    }

    if (
      parsedUrl.protocol !== 'postgresql:' &&
      parsedUrl.protocol !== 'postgres:'
    ) {
      throw new Error('Database URL must use the PostgreSQL protocol');
    }

    const database = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
    if (!parsedUrl.hostname || !database) {
      throw new Error('Database URL must include a host and database name');
    }

    return {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || '5432',
      username: decodeURIComponent(parsedUrl.username),
      password: decodeURIComponent(parsedUrl.password),
      database,
      sslMode: parsedUrl.searchParams.get('sslmode') ?? undefined,
    };
  }

  private assertScratchDatabase(
    source: DatabaseConnection,
    scratch: DatabaseConnection,
  ): void {
    const sourceIdentity = `${source.hostname}:${source.port}/${source.database}`;
    const scratchIdentity = `${scratch.hostname}:${scratch.port}/${scratch.database}`;

    if (sourceIdentity === scratchIdentity) {
      throw new Error(
        'BACKUP_VERIFY_DATABASE_URL must not point at the production DATABASE_URL',
      );
    }
  }

  private getRequiredConfig(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) {
      throw new Error(
        `${key} is required when database backup verification is enabled`,
      );
    }
    return value;
  }

  private getObjectPrefix(): string {
    const configuredPrefix = this.config.get<string>(
      'BACKUP_S3_PREFIX',
      'database-backups',
    );
    const prefix = configuredPrefix.replace(/^\/+|\/+$/g, '');
    return prefix || 'database-backups';
  }

  private isVerificationEnabled(): boolean {
    return (
      String(this.config.get<string | boolean>('BACKUP_VERIFY_ENABLED', false))
        .trim()
        .toLowerCase() === 'true'
    );
  }

  private recordSkipped(
    startedAt: Date,
    message: string,
  ): BackupVerificationStatus {
    const status = this.createStatus(startedAt, 'SKIPPED', { message });
    this.lastRunStatus = status;
    this.logger.warn(`Database backup verification skipped ${JSON.stringify(status)}`);
    return status;
  }

  private createStatus(
    startedAt: Date,
    state: BackupVerificationState,
    details: Partial<BackupVerificationStatus>,
  ): BackupVerificationStatus {
    const completedAt = new Date();
    return {
      state,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      ...details,
    };
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
