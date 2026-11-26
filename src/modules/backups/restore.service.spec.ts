import { Test, TestingModule } from "@nestjs/testing";
import { RestoreService } from "./restore.service";
import { PrismaService } from "../../prisma/prisma.service";

describe("RestoreService", () => {
  let service: RestoreService;
  let prisma: {
    restoreJob: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      restoreJob: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RestoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<RestoreService>(RestoreService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("happy path", () => {
    it("creates a restore job and returns it", async () => {
      const created = { id: "job-1", status: "PENDING" };
      prisma.restoreJob.create.mockResolvedValue(created);

      const result = await (service as any).createRestoreJob({
        backupId: "backup-1",
      });

      expect(prisma.restoreJob.create).toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it("returns an existing restore job by id", async () => {
      const job = { id: "job-1", status: "COMPLETED" };
      prisma.restoreJob.findUnique.mockResolvedValue(job);

      const result = await (service as any).getRestoreJob("job-1");

      expect(prisma.restoreJob.findUnique).toHaveBeenCalledWith({
        where: { id: "job-1" },
      });
      expect(result).toEqual(job);
    });
  });

  describe("validation / error paths", () => {
    it("throws when the restore job does not exist", async () => {
      prisma.restoreJob.findUnique.mockResolvedValue(null);

      await expect(
        (service as any).getRestoreJob("missing"),
      ).rejects.toThrow();
    });

    it("propagates prisma errors when creating a job fails", async () => {
      prisma.restoreJob.create.mockRejectedValue(new Error("db down"));

      await expect(
        (service as any).createRestoreJob({ backupId: "backup-1" }),
      ).rejects.toThrow("db down");
    });
  });
});
