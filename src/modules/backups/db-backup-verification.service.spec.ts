import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { DbBackupVerificationService } from './db-backup-verification.service';

jest.mock('node:child_process', () => ({
  execFile: jest.fn(),
}));

describe('DbBackupVerificationService', () => {
  let service: DbBackupVerificationService;
  let configValues: Record<string, string | boolean | number>;
  let send: jest.Mock;
  const mockedExecFile = execFile as unknown as jest.Mock;
  const dumpContents = 'valid-dump';

  const sourceUrl =
    'postgresql://backup-user:secret@database.internal:5433/sorobanlard?sslmode=require';
  const scratchUrl =
    'postgresql://restore-user:restore-secret@database.internal:5433/sorobanlard_restore_test';

  beforeEach(() => {
    configValues = {
      BACKUP_VERIFY_ENABLED: true,
      BACKUP_S3_BUCKET: 'backup-bucket',
      BACKUP_S3_PREFIX: '/nightly/',
      DATABASE_URL: sourceUrl,
      BACKUP_VERIFY_DATABASE_URL: scratchUrl,
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key in configValues ? configValues[key] : fallback,
      ),
    } as unknown as ConfigService;
    send = jest.fn();
    service = new DbBackupVerificationService(config, {
      send,
    } as unknown as S3Client);
    mockedExecFile.mockReset();
  });

  function mockS3WithLatestBackup(checksum?: string) {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [
            {
              Key: 'nightly/old.dump',
              LastModified: new Date('2026-10-19T02:00:00.000Z'),
            },
            {
              Key: 'nightly/latest.dump',
              LastModified: new Date('2026-10-21T02:00:00.000Z'),
            },
            {
              Key: 'nightly/readme.txt',
              LastModified: new Date('2026-10-21T03:00:00.000Z'),
            },
          ],
          IsTruncated: false,
        };
      }

      if (command instanceof GetObjectCommand) {
        return {
          Body: Readable.from(Buffer.from(dumpContents)),
          ChecksumSHA256:
            checksum ??
            createHash('sha256').update(dumpContents).digest('base64'),
        };
      }

      return {};
    });
  }

  function mockCommands(integrityOutput = '34|21|0|7\n') {
    mockedExecFile.mockImplementation(
      (
        command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const commandText = args.join(' ');
        if (
          command === 'psql' &&
          commandText.includes('information_schema.tables')
        ) {
          callback(null, integrityOutput, '');
          return;
        }
        callback(null, '', '');
      },
    );
  }

  it('downloads the newest dump, restores it into the scratch database, and verifies integrity', async () => {
    mockS3WithLatestBackup();
    mockCommands();

    const result = await service.runVerification();

    expect(result).toEqual(
      expect.objectContaining({
        state: 'SUCCESS',
        backupKey: 'nightly/latest.dump',
        backupLastModified: '2026-10-21T02:00:00.000Z',
        sizeBytes: dumpContents.length,
        checksumVerified: true,
        restoreDurationMs: expect.any(Number),
        integrity: {
          tableCount: 34,
          appliedMigrations: 21,
          incompleteMigrations: 0,
          keyTablesPresent: 7,
          expectedKeyTables: 7,
        },
      }),
    );
    expect(service.getLastRunStatus()).toEqual(result);

    const getObject = send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof GetObjectCommand);
    expect(getObject.input).toEqual(
      expect.objectContaining({
        Bucket: 'backup-bucket',
        Key: 'nightly/latest.dump',
        ChecksumMode: 'ENABLED',
      }),
    );

    const calls = mockedExecFile.mock.calls;
    const restoreListCall = calls.find(
      ([command, args]) => command === 'pg_restore' && args[0] === '--list',
    );
    expect(restoreListCall).toBeDefined();

    const resetCall = calls.find(
      ([command, args]) =>
        command === 'psql' && args.join(' ').includes('DROP SCHEMA'),
    );
    expect(resetCall[2].env).toEqual(
      expect.objectContaining({
        PGHOST: 'database.internal',
        PGPORT: '5433',
        PGUSER: 'restore-user',
        PGPASSWORD: 'restore-secret',
        PGDATABASE: 'sorobanlard_restore_test',
      }),
    );

    const restoreCall = calls.find(
      ([command, args]) =>
        command === 'pg_restore' && args.includes('--exit-on-error'),
    );
    expect(restoreCall[1]).toEqual(
      expect.arrayContaining([
        '--no-owner',
        '--no-privileges',
        '--exit-on-error',
        '--dbname',
        'sorobanlard_restore_test',
      ]),
    );
    expect(restoreCall[1].join(' ')).not.toContain('secret');
  });

  it('reports the latest result via getLastRunStatus', async () => {
    mockS3WithLatestBackup();
    mockCommands();

    expect(service.getLastRunStatus()).toBeNull();
    await service.runVerification();
    expect(service.getLastRunStatus()).toEqual(
      expect.objectContaining({ state: 'SUCCESS' }),
    );
  });

  it('skips when verification is disabled', async () => {
    configValues.BACKUP_VERIFY_ENABLED = false;

    const result = await service.runVerification();

    expect(result.state).toBe('SKIPPED');
    expect(result.message).toBe('Database backup verification is disabled');
    expect(mockedExecFile).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('fails when no backup archive exists', async () => {
    send.mockResolvedValue({ Contents: [], IsTruncated: false });

    const result = await service.runVerification();

    expect(result.state).toBe('FAILED');
    expect(result.message).toContain('No database backup');
  });

  it('refuses to restore over the production database', async () => {
    configValues.BACKUP_VERIFY_DATABASE_URL = sourceUrl;

    const result = await service.runVerification();

    expect(result.state).toBe('FAILED');
    expect(result.message).toContain(
      'BACKUP_VERIFY_DATABASE_URL must not point at the production DATABASE_URL',
    );
    expect(send).not.toHaveBeenCalled();
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('treats a checksum mismatch as a corrupt backup', async () => {
    mockS3WithLatestBackup('not-the-real-checksum');
    mockCommands();

    const result = await service.runVerification();

    expect(result.state).toBe('FAILED');
    expect(result.message).toContain('Backup checksum mismatch');
    expect(
      mockedExecFile.mock.calls.some(([command]) => command === 'pg_restore'),
    ).toBe(false);
  });

  it('fails when the restored database is missing key tables', async () => {
    mockS3WithLatestBackup();
    mockCommands('34|21|0|6\n');

    const result = await service.runVerification();

    expect(result.state).toBe('FAILED');
    expect(result.message).toContain('Backup integrity check failed');
    expect(result.message).toContain('only 6/7 key tables are present');
  });

  it('fails when the restore command fails', async () => {
    mockS3WithLatestBackup();
    mockedExecFile.mockImplementation(
      (
        command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (command === 'pg_restore' && args.includes('--exit-on-error')) {
          callback(new Error('restore failed'), '', 'relation already exists');
          return;
        }
        callback(null, '', '');
      },
    );

    const result = await service.runVerification();

    expect(result.state).toBe('FAILED');
    expect(result.message).toBe('pg_restore failed: relation already exists');
  });

  it('delegates scheduled runs to the verification runner', async () => {
    const expected = {
      state: 'SKIPPED' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 0,
    };
    jest.spyOn(service, 'runVerification').mockResolvedValue(expected);

    await expect(service.handleScheduledVerification()).resolves.toEqual(
      expected,
    );
    expect(service.runVerification).toHaveBeenCalledTimes(1);
  });
});
