import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { CourseStatus, EnrollmentStatus, UserRole } from '@prisma/client';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: any;

  const mockPrisma = {
    user: {
      count: jest.fn(),
    },
    course: {
      count: jest.fn(),
    },
    enrollment: {
      count: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('getSummary', () => {
    it('should return cached summary when no date range is provided', async () => {
      // Mock all the Prisma calls for recalculation
      mockPrisma.user.count
        .mockResolvedValueOnce(1000) // total users
        .mockResolvedValueOnce(800)  // students
        .mockResolvedValueOnce(150)  // instructors
        .mockResolvedValueOnce(50);  // new users

      mockPrisma.course.count
        .mockResolvedValueOnce(200) // total courses
        .mockResolvedValueOnce(180) // active
        .mockResolvedValueOnce(15)  // pending
        .mockResolvedValueOnce(5);  // archived

      mockPrisma.enrollment.count
        .mockResolvedValueOnce(5000) // all time
        .mockResolvedValueOnce(100)  // in period
        .mockResolvedValueOnce(80);  // completed

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 25000 },
      });

      const result = await service.getSummary({});

      expect(result.users.total).toBe(1000);
      expect(result.users.students).toBe(800);
      expect(result.users.instructors).toBe(150);
      expect(result.courses.total).toBe(200);
      expect(result.courses.active).toBe(180);
      expect(result.enrollments.allTime).toBe(5000);
      expect(result.revenue.totalInPeriod).toBe(25000);
      expect(result.meta.source).toBe('cache');
    });

    it('should compute live summary when date range is provided', async () => {
      const startDate = '2026-01-01';
      const endDate = '2026-01-31';

      mockPrisma.user.count
        .mockResolvedValueOnce(1000) // total
        .mockResolvedValueOnce(800)  // students
        .mockResolvedValueOnce(150)  // instructors
        .mockResolvedValueOnce(20);  // new in period

      mockPrisma.course.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(180)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(5);

      mockPrisma.enrollment.count
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(40);

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 5000 },
      });

      const result = await service.getSummary({ startDate, endDate });

      expect(result.users.newInPeriod).toBe(20);
      expect(result.enrollments.totalInPeriod).toBe(50);
      expect(result.enrollments.completedInPeriod).toBe(40);
      expect(result.revenue.totalInPeriod).toBe(5000);
      expect(result.meta.source).toBe('live');
      expect(result.meta.isStale).toBe(false);
    });

    it('should throw BadRequestException if only startDate is provided', async () => {
      await expect(service.getSummary({ startDate: '2026-01-01' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if only endDate is provided', async () => {
      await expect(service.getSummary({ endDate: '2026-01-31' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if startDate is invalid', async () => {
      await expect(service.getSummary({ startDate: 'invalid-date', endDate: '2026-01-31' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if endDate is invalid', async () => {
      await expect(service.getSummary({ startDate: '2026-01-01', endDate: 'invalid-date' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if startDate is after endDate', async () => {
      await expect(service.getSummary({ startDate: '2026-02-01', endDate: '2026-01-01' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if endDate is in the future', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      
      await expect(service.getSummary({ startDate: '2026-01-01', endDate: futureDate }))
        .rejects.toThrow(BadRequestException);
    });

    it('should normalize revenue amounts correctly', async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(5);

      mockPrisma.course.count
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(45)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2);

      mockPrisma.enrollment.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8);

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 1234.567 }, // Should be rounded to 1234.57
      });

      const result = await service.getSummary({});

      expect(result.revenue.totalInPeriod).toBe(1234.57);
    });

    it('should handle null revenue sum', async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(5);

      mockPrisma.course.count
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(45)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2);

      mockPrisma.enrollment.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: null },
      });

      const result = await service.getSummary({});

      expect(result.revenue.totalInPeriod).toBe(0);
    });

    it('should mark cached summary as stale after 30 minutes', async () => {
      // First call to populate cache
      mockPrisma.user.count
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(800)
        .mockResolvedValueOnce(150)
        .mockResolvedValueOnce(50);

      mockPrisma.course.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(180)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(5);

      mockPrisma.enrollment.count
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80);

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 25000 },
      });

      const result1 = await service.getSummary({});
      expect(result1.meta.isStale).toBe(false);

      // Mock time passing (30+ minutes)
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => originalDateNow.call(Date) + 31 * 60 * 1000);

      const result2 = await service.getSummary({});
      expect(result2.meta.isStale).toBe(true);

      // Restore original Date.now
      Date.now = originalDateNow;
    });
  });

  describe('handleScheduledRecalculation', () => {
    it('should recalculate and update cache', async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(800)
        .mockResolvedValueOnce(150)
        .mockResolvedValueOnce(50);

      mockPrisma.course.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(180)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(5);

      mockPrisma.enrollment.count
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80);

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 25000 },
      });

      await service.handleScheduledRecalculation();

      // Verify cache was updated by checking subsequent call doesn't hit Prisma again
      jest.clearAllMocks();
      
      const result = await service.getSummary({});
      
      expect(result.users.total).toBe(1000);
      expect(mockPrisma.user.count).not.toHaveBeenCalled(); // Should use cache
    });
  });

  describe('date range validation', () => {
    it('should accept valid date range', async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(800)
        .mockResolvedValueOnce(150)
        .mockResolvedValueOnce(20);

      mockPrisma.course.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(180)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(5);

      mockPrisma.enrollment.count
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(40);

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 5000 },
      });

      const result = await service.getSummary({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(result).toBeDefined();
      expect(result.meta.source).toBe('live');
    });

    it('should accept same startDate and endDate', async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(1000)
        .mockResolvedValueOnce(800)
        .mockResolvedValueOnce(150)
        .mockResolvedValueOnce(5);

      mockPrisma.course.count
        .mockResolvedValueOnce(200)
        .mockResolvedValueOnce(180)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(5);

      mockPrisma.enrollment.count
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8);

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 1000 },
      });

      const result = await service.getSummary({
        startDate: '2026-01-15',
        endDate: '2026-01-15',
      });

      expect(result).toBeDefined();
    });
  });

  describe('stats computation', () => {
    it('should correctly compute all user statistics', async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(1200) // total
        .mockResolvedValueOnce(1000) // students
        .mockResolvedValueOnce(180)  // instructors
        .mockResolvedValueOnce(100); // new

      mockPrisma.course.count.mockResolvedValue(0);
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.enrollment.aggregate.mockResolvedValue({ _sum: { amountPaid: 0 } });

      const result = await service.getSummary({});

      expect(result.users.total).toBe(1200);
      expect(result.users.students).toBe(1000);
      expect(result.users.instructors).toBe(180);
      expect(result.users.newInPeriod).toBe(100);
    });

    it('should correctly compute all course statistics', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      
      mockPrisma.course.count
        .mockResolvedValueOnce(250) // total
        .mockResolvedValueOnce(200) // active
        .mockResolvedValueOnce(30)  // pending
        .mockResolvedValueOnce(20); // archived

      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.enrollment.aggregate.mockResolvedValue({ _sum: { amountPaid: 0 } });

      const result = await service.getSummary({});

      expect(result.courses.total).toBe(250);
      expect(result.courses.active).toBe(200);
      expect(result.courses.pending).toBe(30);
      expect(result.courses.archived).toBe(20);
    });

    it('should correctly compute enrollment statistics', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.course.count.mockResolvedValue(0);
      
      mockPrisma.enrollment.count
        .mockResolvedValueOnce(10000) // all time
        .mockResolvedValueOnce(500)   // in period
        .mockResolvedValueOnce(400);  // completed in period

      mockPrisma.enrollment.aggregate.mockResolvedValue({
        _sum: { amountPaid: 50000 },
      });

      const result = await service.getSummary({});

      expect(result.enrollments.allTime).toBe(10000);
      expect(result.enrollments.totalInPeriod).toBe(500);
      expect(result.enrollments.completedInPeriod).toBe(400);
    });
  });
});
