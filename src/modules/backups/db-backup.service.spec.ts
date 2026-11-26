import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { DbBackupService } from "./db-backup.service";
import { PrismaService } from "../../prisma/prisma.service";
import { DB_BACKUP_S3_CLIENT } from "./backups.constants";

describe("DbBackupService", () => {
  let service: DbBackupService;
  let prisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let s3Client: { send: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      $transaction: jest.fn(),
    };
    s3Client = { send: jest.fn() };
    config = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          BACKUP_S3_BUCKET: "test-bucket",
          BACKUP_S3_ENDPOINT: "http://localhost:9000",
          AWS_REGION: "us-east-1",
        };
        return values[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbBackupService,
        { provide: PrismaService, useValue: prisma },
        { provide: DB_BACKUP_S3_CLIENT, useValue: s3Client },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<DbBackupService>(DbBackupService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("happy path", () => {
    it("runs a backup and uploads the dump to S3", async () => {
      prisma.$queryRaw.mockResolvedValue([{ dump: "-- pg dump --" }]);
      s3Client.send.mockResolvedValue({});

      const result = await (service as any).createBackup();

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(s3Client.send).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe("error path", () => {
    it("propagates database errors without uploading", async () => {
      prisma.$queryRaw.mockRejectedValue(new Error("db unavailable"));

      await expect((service as any).createBackup()).rejects.toThrow(
        "db unavailable",
      );
      expect(s3Client.send).not.toHaveBeenCalled();
    });

    it("propagates S3 upload failures", async () => {
      prisma.$queryRaw.mockResolvedValue([{ dump: "-- pg dump --" }]);
      s3Client.send.mockRejectedValue(new Error("upload failed"));

      await expect((service as any).createBackup()).rejects.toThrow(
        "upload failed",
      );
    });
  });
});
