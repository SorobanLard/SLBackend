import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InstructorReportService } from './instructor-report.service';
import { InstructorReportQueryDto } from './dto/instructor-report-query.dto';

describe('InstructorReportService', () => {
  let service: InstructorReportService;
  let prisma: {
    user: { findUnique: jest.Mock; count: jest.Mock };
    course: { findMany: jest.Mock };
    enrollment: { findMany: jest.Mock; aggregate: jest.Mock; count: jest.Mock };
    courseReview: { aggregate: jest.Mock };
  };

  const instructor = {
    id: 'instructor-1',
    name: 'Jane Doe',
    role: 'INSTRUCTOR',
    stellarAddress: 'GABC123',
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), count: jest.fn() },
      course: { findMany: jest.fn() },
      enrollment: {
        findMany: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      },
      courseReview: { aggregate: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstructorReportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InstructorReportService>(InstructorReportService);
  });

  const emptyDto: InstructorReportQueryDto = {} as InstructorReportQueryDto;

  describe('getReport', () => {
    it('computes metrics and comparisons for the happy path', async () => {
      prisma.user.findUnique.mockResolvedValue(instructor);
      prisma.course.findMany.mockResolvedValue([
        { id: 'c1', status: 'ACTIVE', platformFeePercent: 10 },
        { id: 'c2', status: 'DRAFT', platformFeePercent: 5 },
      ]);
      prisma.enrollment.findMany.mockResolvedValue([
        { courseId: 'c1', status: 'COMPLETED', amountPaid: 100 },
        { courseId: 'c2', status: 'ACTIVE', amountPaid: 50 },
      ]);
      prisma.courseReview.aggregate
        .mockResolvedValueOnce({ _avg: { rating: 4.5 }, _count: { _all: 2 } })
        .mockResolvedValueOnce({ _avg: { rating: 4 } });
      prisma.user.count.mockResolvedValue(2);
      prisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 300 },
        _count: { _all: 4 },
      });
      prisma.enrollment.count.mockResolvedValue(2);

      const report = await service.getReport('instructor-1', emptyDto);

      expect(report.instructor).toEqual({
        id: 'instructor-1',
        name: 'Jane Doe',
        stellarAddress: 'GABC123',
      });
      expect(report.metrics.courses).toEqual({ total: 2, active: 1 });
      expect(report.metrics.ratings).toEqual({ average: 4.5, totalReviews: 2 });
      expect(report.metrics.students).toEqual({
        enrollments: 2,
        completions: 1,
        completionRate: 50,
      });
      expect(report.metrics.revenue).toEqual({
        gross: 150,
        platformFees: 12.5,
        net: 137.5,
      });
      expect(report.platformAverages).toEqual({
        instructorCount: 2,
        rating: 4,
        completionRate: 50,
        grossRevenuePerInstructor: 150,
        enrollmentsPerInstructor: 2,
      });
      expect(report.comparison.rating.verdict).toBe('above');
      expect(report.comparison.completionRate.verdict).toBe('on_par');
      expect(report.comparison.grossRevenue.verdict).toBe('on_par');
      expect(report.comparison.enrollments.verdict).toBe('on_par');
    });

    it('throws NotFoundException when the instructor does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getReport('missing', emptyDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the user is not an instructor', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...instructor, role: 'STUDENT' });

      await expect(service.getReport('instructor-1', emptyDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException for an invalid from date', async () => {
      prisma.user.findUnique.mockResolvedValue(instructor);

      await expect(
        service.getReport('instructor-1', { from: 'not-a-date' } as InstructorReportQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException when from is after to', async () => {
      prisma.user.findUnique.mockResolvedValue(instructor);

      await expect(
        service.getReport('instructor-1', {
          from: '2024-02-01',
          to: '2024-01-01',
        } as InstructorReportQueryDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns null percentDiff when the platform average is zero', async () => {
      prisma.user.findUnique.mockResolvedValue(instructor);
      prisma.course.findMany.mockResolvedValue([]);
      prisma.enrollment.findMany.mockResolvedValue([]);
      prisma.courseReview.aggregate
        .mockResolvedValueOnce({ _avg: { rating: null }, _count: { _all: 0 } })
        .mockResolvedValueOnce({ _avg: { rating: null } });
      prisma.user.count.mockResolvedValue(0);
      prisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: null },
        _count: { _all: 0 },
      });
      prisma.enrollment.count.mockResolvedValue(0);

      const report = await service.getReport('instructor-1', emptyDto);

      expect(report.comparison.rating.percentDiff).toBeNull();
      expect(report.comparison.rating.verdict).toBe('on_par');
      expect(report.platformAverages.instructorCount).toBe(0);
    });
  });
});
