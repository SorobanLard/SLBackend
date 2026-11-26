import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EngagementReportService } from './engagement-report.service';
import { EngagementScope } from './dto/engagement-report-query.dto';

describe('EngagementReportService', () => {
  let service: EngagementReportService;
  let prisma: {
    enrollment: { findMany: jest.Mock };
    lessonProgress: { aggregate: jest.Mock; count: jest.Mock; groupBy: jest.Mock };
    userPoints: { findMany: jest.Mock };
    user: { findUnique: jest.Mock };
    course: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      enrollment: { findMany: jest.fn() },
      lessonProgress: {
        aggregate: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      userPoints: { findMany: jest.fn() },
      user: { findUnique: jest.fn() },
      course: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementReportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EngagementReportService>(EngagementReportService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('happy path', () => {
    it('aggregates platform engagement metrics', async () => {
      const now = new Date();
      prisma.enrollment.findMany.mockResolvedValue([
        {
          id: 'e1',
          studentId: 's1',
          status: 'COMPLETED',
          progressPercent: 100,
          updatedAt: now,
          enrolledAt: now,
        },
        {
          id: 'e2',
          studentId: 's2',
          status: 'ACTIVE',
          progressPercent: 50,
          updatedAt: now,
          enrolledAt: now,
        },
      ]);
      prisma.lessonProgress.aggregate.mockResolvedValue({
        _sum: { watchedSecs: 7200 },
        _count: { _all: 10 },
      });
      prisma.lessonProgress.count.mockResolvedValue(4);
      prisma.lessonProgress.groupBy.mockResolvedValue([
        { enrollmentId: 'e1', _max: { updatedAt: now } },
        { enrollmentId: 'e2', _max: { updatedAt: now } },
      ]);
      prisma.userPoints.findMany.mockResolvedValue([
        { userId: 's1', currentStreak: 4, longestStreak: 10 },
        { userId: 's2', currentStreak: 2, longestStreak: 6 },
      ]);

      const report = await service.getReport({});

      expect(report.scope).toBe(EngagementScope.PLATFORM);
      expect(report.summary.students).toBe(2);
      expect(report.summary.enrollments).toBe(2);
      expect(report.summary.completedEnrollments).toBe(1);
      expect(report.summary.courseCompletionRate).toBe(50);
      expect(report.summary.avgProgressPercent).toBe(75);
      expect(report.summary.watchTime.totalSeconds).toBe(7200);
      expect(report.summary.watchTime.totalHours).toBe(2);
      expect(report.summary.watchTime.avgSecondsPerStudent).toBe(3600);
      expect(report.summary.lessons.started).toBe(10);
      expect(report.summary.lessons.completed).toBe(4);
      expect(report.summary.lessons.completionRate).toBe(40);
      expect(report.summary.streaks.avgCurrentStreak).toBe(3);
      expect(report.summary.streaks.longestStreak).toBe(10);
      expect(report.summary.inactivity.thresholdDays).toBe(14);
    });

    it('returns zeroed metrics when there are no enrollments', async () => {
      prisma.enrollment.findMany.mockResolvedValue([]);
      prisma.lessonProgress.aggregate.mockResolvedValue({
        _sum: { watchedSecs: null },
        _count: { _all: 0 },
      });
      prisma.lessonProgress.count.mockResolvedValue(0);

      const report = await service.getReport({});

      expect(report.summary.students).toBe(0);
      expect(report.summary.enrollments).toBe(0);
      expect(report.summary.avgProgressPercent).toBe(0);
      expect(report.summary.watchTime.totalSeconds).toBe(0);
      expect(report.summary.watchTime.avgSecondsPerStudent).toBe(0);
      expect(report.summary.streaks.avgCurrentStreak).toBe(0);
      expect(report.summary.streaks.longestStreak).toBe(0);
      expect(prisma.lessonProgress.groupBy).not.toHaveBeenCalled();
      expect(prisma.userPoints.findMany).not.toHaveBeenCalled();
    });

    it('scopes the report to a single student', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 's1' });
      prisma.enrollment.findMany.mockResolvedValue([]);
      prisma.lessonProgress.aggregate.mockResolvedValue({
        _sum: { watchedSecs: 0 },
        _count: { _all: 0 },
      });
      prisma.lessonProgress.count.mockResolvedValue(0);

      const report = await service.getReport({
        scope: EngagementScope.STUDENT,
        studentId: 's1',
      });

      expect(report.scope).toBe(EngagementScope.STUDENT);
      expect(report.studentId).toBe('s1');
      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ studentId: 's1' }),
        }),
      );
    });
  });

  describe('validation', () => {
    it('throws BadRequest when scope=STUDENT without studentId', async () => {
      await expect(
        service.getReport({ scope: EngagementScope.STUDENT }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the student does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getReport({ scope: EngagementScope.STUDENT, studentId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest when scope=COURSE without courseId', async () => {
      await expect(
        service.getReport({ scope: EngagementScope.COURSE }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(
        service.getReport({ scope: EngagementScope.COURSE, courseId: 'missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequest for an invalid from date', async () => {
      await expect(
        service.getReport({ from: 'not-a-date' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when from is after to', async () => {
      await expect(
        service.getReport({
          from: '2024-02-01T00:00:00.000Z',
          to: '2024-01-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
