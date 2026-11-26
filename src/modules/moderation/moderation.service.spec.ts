import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ReportStatus, ReportTargetType, CourseStatus, ReportCategory } from '@prisma/client';
import { ModerationService, DEFAULT_UNPUBLISH_THRESHOLD } from './moderation.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('ModerationService', () => {
  let service: ModerationService;
  let prisma: {
    abuseReport: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    course: { findUnique: jest.Mock; update: jest.Mock };
    discussionComment: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      abuseReport: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      course: { findUnique: jest.fn(), update: jest.fn() },
      discussionComment: { findUnique: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ModerationService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ModerationService>(ModerationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createFlag', () => {
    const baseDto = {
      targetType: ReportTargetType.COURSE,
      targetId: 'course-1',
      category: ReportCategory.SPAM,
      description: 'spam',
    };

    it('creates a flag on the happy path without auto action', async () => {
      prisma.abuseReport.findFirst.mockResolvedValue(null);
      prisma.abuseReport.create.mockResolvedValue({ id: 'report-1', ...baseDto });
      prisma.abuseReport.findMany.mockResolvedValue([{ reporterId: 'reporter-1' }]);

      const result = await service.createFlag('reporter-1', baseDto as any);

      expect(prisma.abuseReport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reporterId: 'reporter-1',
          status: ReportStatus.PENDING,
        }),
      });
      expect(result.pendingCount).toBe(1);
      expect(result.autoActionTaken).toBe(false);
    });

    it('throws BadRequestException for an invalid category', async () => {
      await expect(
        service.createFlag('reporter-1', { ...baseDto, category: 'INVALID' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.abuseReport.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when a pending report already exists', async () => {
      prisma.abuseReport.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(service.createFlag('reporter-1', baseDto as any)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.abuseReport.create).not.toHaveBeenCalled();
    });

    it('auto-pauses a course when the threshold is reached', async () => {
      prisma.abuseReport.findFirst.mockResolvedValue(null);
      prisma.abuseReport.create.mockResolvedValue({ id: 'report-1' });
      prisma.abuseReport.findMany.mockResolvedValue(
        Array.from({ length: DEFAULT_UNPUBLISH_THRESHOLD }, (_, i) => ({ reporterId: `r-${i}` })),
      );
      prisma.course.findUnique.mockResolvedValue({ id: 'course-1', status: CourseStatus.PUBLISHED });
      prisma.course.update.mockResolvedValue({ id: 'course-1', status: CourseStatus.PAUSED });

      const result = await service.createFlag('reporter-1', baseDto as any);

      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { status: CourseStatus.PAUSED },
      });
      expect(result.autoActionTaken).toBe(true);
    });

    it('does not auto-pause a course that is already paused', async () => {
      prisma.abuseReport.findFirst.mockResolvedValue(null);
      prisma.abuseReport.create.mockResolvedValue({ id: 'report-1' });
      prisma.abuseReport.findMany.mockResolvedValue(
        Array.from({ length: DEFAULT_UNPUBLISH_THRESHOLD }, (_, i) => ({ reporterId: `r-${i}` })),
      );
      prisma.course.findUnique.mockResolvedValue({ id: 'course-1', status: CourseStatus.PAUSED });

      const result = await service.createFlag('reporter-1', baseDto as any);

      expect(prisma.course.update).not.toHaveBeenCalled();
      expect(result.autoActionTaken).toBe(false);
    });

    it('auto-hides a comment when the threshold is reached', async () => {
      const commentDto = { ...baseDto, targetType: ReportTargetType.COMMENT, targetId: 'comment-1' };
      prisma.abuseReport.findFirst.mockResolvedValue(null);
      prisma.abuseReport.create.mockResolvedValue({ id: 'report-1' });
      prisma.abuseReport.findMany.mockResolvedValue(
        Array.from({ length: DEFAULT_UNPUBLISH_THRESHOLD }, (_, i) => ({ reporterId: `r-${i}` })),
      );
      prisma.discussionComment.findUnique.mockResolvedValue({ id: 'comment-1', hidden: false });
      prisma.discussionComment.update.mockResolvedValue({ id: 'comment-1', hidden: true });

      const result = await service.createFlag('reporter-1', commentDto as any);

      expect(prisma.discussionComment.update).toHaveBeenCalledWith({
        where: { id: 'comment-1' },
        data: { hidden: true },
      });
      expect(result.autoActionTaken).toBe(true);
    });

    it('swallows auto-unpublish errors and reports no action taken', async () => {
      prisma.abuseReport.findFirst.mockResolvedValue(null);
      prisma.abuseReport.create.mockResolvedValue({ id: 'report-1' });
      prisma.abuseReport.findMany.mockResolvedValue(
        Array.from({ length: DEFAULT_UNPUBLISH_THRESHOLD }, (_, i) => ({ reporterId: `r-${i}` })),
      );
      prisma.course.findUnique.mockRejectedValue(new Error('db down'));

      const result = await service.createFlag('reporter-1', baseDto as any);

      expect(result.autoActionTaken).toBe(false);
    });
  });

  describe('resolveFlag', () => {
    it('updates the flag with resolution metadata', async () => {
      prisma.abuseReport.findUnique.mockResolvedValue({ id: 'flag-1' });
      prisma.abuseReport.update.mockResolvedValue({ id: 'flag-1', status: ReportStatus.RESOLVED });

      const result = await service.resolveFlag('flag-1', 'admin-1', {
        status: ReportStatus.RESOLVED,
        resolutionNote: 'handled',
      } as any);

      expect(prisma.abuseReport.update).toHaveBeenCalledWith({
        where: { id: 'flag-1' },
        data: expect.objectContaining({
          status: ReportStatus.RESOLVED,
          resolvedById: 'admin-1',
          resolutionNote: 'handled',
          resolvedAt: expect.any(Date),
        }),
      });
      expect(result).toEqual({ id: 'flag-1', status: ReportStatus.RESOLVED });
    });

    it('throws NotFoundException when the flag does not exist', async () => {
      prisma.abuseReport.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveFlag('missing', 'admin-1', { status: ReportStatus.RESOLVED } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.abuseReport.update).not.toHaveBeenCalled();
    });
  });

  describe('getDashboardListing', () => {
    it('applies filters and pagination defaults', async () => {
      prisma.abuseReport.findMany.mockResolvedValue([{ id: 'r1' }]);
      prisma.abuseReport.count.mockResolvedValue(1);

      const result = await service.getDashboardListing({
        status: ReportStatus.PENDING,
        targetType: ReportTargetType.COURSE,
      });

      expect(prisma.abuseReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ReportStatus.PENDING, targetType: ReportTargetType.COURSE },
          skip: 0,
          take: 10,
        }),
      );
      expect(result).toEqual({
        data: [{ id: 'r1' }],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('computes skip and totalPages from provided page/limit', async () => {
      prisma.abuseReport.findMany.mockResolvedValue([]);
      prisma.abuseReport.count.mockResolvedValue(25);

      const result = await service.getDashboardListing({ page: 3, limit: 10 });

      expect(prisma.abuseReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.totalPages).toBe(3);
    });
  });
});
