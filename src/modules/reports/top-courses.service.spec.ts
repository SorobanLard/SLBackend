import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  TopCoursesMetric,
  TopCoursesWindow,
} from './dto/top-courses-query.dto';
import { TopCoursesService } from './top-courses.service';

describe('TopCoursesService', () => {
  let service: TopCoursesService;

  const mockPrisma = {
    enrollment: { groupBy: jest.fn() },
    course: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopCoursesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TopCoursesService>(TopCoursesService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const course = (id: string, title = `Course ${id}`) => ({
    id,
    title,
    category: 'Development',
    level: 'BEGINNER',
    instructorAddress: `G-${id}`,
    price: 100,
    status: 'PUBLISHED',
    thumbnailUrl: null,
  });

  it('ranks courses by enrollments with defaults', async () => {
    mockPrisma.enrollment.groupBy.mockResolvedValue([
      { courseId: 'course-1', _count: { _all: 8 } },
      { courseId: 'course-2', _count: { _all: 5 } },
    ]);
    mockPrisma.course.findMany.mockResolvedValue([
      course('course-1'),
      course('course-2'),
    ]);

    const result = await service.getTopCourses({});

    expect(mockPrisma.enrollment.groupBy).toHaveBeenCalledWith({
      by: ['courseId'],
      where: { status: { not: EnrollmentStatus.REFUNDED } },
      _count: { _all: true },
      orderBy: { _count: { _all: 'desc' } },
      take: 10,
    });
    expect(result).toEqual({
      metric: TopCoursesMetric.ENROLLMENTS,
      window: TopCoursesWindow.ALL_TIME,
      limit: 10,
      data: [
        {
          rank: 1,
          course: course('course-1'),
          metric: TopCoursesMetric.ENROLLMENTS,
          metricValue: 8,
        },
        {
          rank: 2,
          course: course('course-2'),
          metric: TopCoursesMetric.ENROLLMENTS,
          metricValue: 5,
        },
      ],
    });
  });

  it('filters enrollment rankings by the 7-day window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    mockPrisma.enrollment.groupBy.mockResolvedValue([]);
    mockPrisma.course.findMany.mockResolvedValue([]);

    await service.getTopCourses({
      metric: TopCoursesMetric.ENROLLMENTS,
      window: TopCoursesWindow.LAST_7_DAYS,
      limit: 3,
    });

    expect(mockPrisma.enrollment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: EnrollmentStatus.REFUNDED },
          enrolledAt: { gte: new Date('2026-11-17T12:00:00Z') },
        },
        take: 3,
      }),
    );
  });

  it('ranks courses by revenue and normalizes a missing amount', async () => {
    mockPrisma.enrollment.groupBy.mockResolvedValue([
      { courseId: 'course-1', _sum: { amountPaid: '150.5' } },
      { courseId: 'course-2', _sum: { amountPaid: null } },
    ]);
    mockPrisma.course.findMany.mockResolvedValue([
      course('course-1'),
      course('course-2'),
    ]);

    const result = await service.getTopCourses({
      metric: TopCoursesMetric.REVENUE,
      window: TopCoursesWindow.ALL_TIME,
      limit: 2,
    });

    expect(mockPrisma.enrollment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['courseId'],
        _sum: { amountPaid: true },
        orderBy: { _sum: { amountPaid: 'desc' } },
      }),
    );
    expect(result.data.map((entry) => entry.metricValue)).toEqual([150.5, 0]);
  });

  it('calculates completion rates and sorts descending', async () => {
    mockPrisma.enrollment.groupBy.mockResolvedValue([
      { courseId: 'course-1', status: EnrollmentStatus.COMPLETED, _count: { _all: 3 } },
      { courseId: 'course-1', status: EnrollmentStatus.ACTIVE, _count: { _all: 1 } },
      { courseId: 'course-2', status: EnrollmentStatus.COMPLETED, _count: { _all: 1 } },
      { courseId: 'course-2', status: EnrollmentStatus.ACTIVE, _count: { _all: 3 } },
    ]);
    mockPrisma.course.findMany.mockResolvedValue([
      course('course-1'),
      course('course-2'),
    ]);

    const result = await service.getTopCourses({
      metric: TopCoursesMetric.COMPLETION_RATE,
      window: TopCoursesWindow.ALL_TIME,
      limit: 2,
    });

    expect(result.data.map((entry) => ({
      courseId: entry.course.id,
      metricValue: entry.metricValue,
    }))).toEqual([
      { courseId: 'course-1', metricValue: 75 },
      { courseId: 'course-2', metricValue: 25 },
    ]);
  });

  it('omits missing courses and compacts ranks', async () => {
    mockPrisma.enrollment.groupBy.mockResolvedValue([
      { courseId: 'missing-course', _count: { _all: 9 } },
      { courseId: 'course-2', _count: { _all: 4 } },
    ]);
    mockPrisma.course.findMany.mockResolvedValue([course('course-2')]);

    const result = await service.getTopCourses({
      metric: TopCoursesMetric.ENROLLMENTS,
    });

    expect(result.data).toEqual([
      {
        rank: 1,
        course: course('course-2'),
        metric: TopCoursesMetric.ENROLLMENTS,
        metricValue: 4,
      },
    ]);
  });

  it.each([
    [TopCoursesWindow.LAST_30_DAYS, 30],
    [TopCoursesWindow.LAST_90_DAYS, 90],
  ])('applies the %s window cutoff', async (window, days) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    mockPrisma.enrollment.groupBy.mockResolvedValue([]);
    mockPrisma.course.findMany.mockResolvedValue([]);

    await service.getTopCourses({ window, limit: 5 });

    const expectedCutoff = new Date('2026-11-24T12:00:00Z');
    expectedCutoff.setDate(expectedCutoff.getDate() - days);
    expect(mockPrisma.enrollment.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: EnrollmentStatus.REFUNDED },
          enrolledAt: { gte: expectedCutoff },
        },
        take: 5,
      }),
    );
  });

  it('throws BadRequestException for an invalid ranking metric', async () => {
    await expect(
      service.getTopCourses({
        metric: 'INVALID_METRIC' as TopCoursesMetric,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for an invalid time window', async () => {
    await expect(
      service.getTopCourses({
        window: 'INVALID_WINDOW' as TopCoursesWindow,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
