import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: {
    report: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      report: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('happy path', () => {
    it('delegates to Prisma when creating a report', async () => {
      const dto = { title: 'Q1', type: 'ENGAGEMENT' } as any;
      const created = { id: 'r1', ...dto };
      prisma.report.create.mockResolvedValue(created);

      const result = await (service as any).create(dto);

      expect(prisma.report.create).toHaveBeenCalledWith({ data: dto });
      expect(result).toEqual(created);
    });

    it('returns a list of reports', async () => {
      const rows = [{ id: 'r1' }, { id: 'r2' }];
      prisma.report.findMany.mockResolvedValue(rows);

      const result = await (service as any).findAll();

      expect(prisma.report.findMany).toHaveBeenCalled();
      expect(result).toEqual(rows);
    });
  });

  describe('error path', () => {
    it('propagates Prisma errors on create', async () => {
      prisma.report.create.mockRejectedValue(new Error('db down'));

      await expect((service as any).create({ title: 'x' })).rejects.toThrow(
        'db down',
      );
    });

    it('throws when a report is not found', async () => {
      prisma.report.findUnique.mockResolvedValue(null);

      await expect((service as any).findOne('missing')).rejects.toThrow();
    });
  });
});
