import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { EnrollmentsService } from './enrollments.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ReferralsService } from '../referrals/referrals.service';
import { FraudDetectionService } from './fraud-detection.service';
import { DripScheduleService } from '../lessons/drip-schedule.service';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;

  const mockPrisma = {
    enrollment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    course: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    coursePrerequisite: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  const mockInvoices = {
    generateForEnrollment: jest.fn(),
  };

  const mockFraudDetection = {
    processFraudCheck: jest.fn(),
  };

  const mockReferrals = {
    trackConversion: jest.fn(),
  };

  const mockDripSchedule = {
    calculateAndSyncUnlockSchedule: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: InvoicesService, useValue: mockInvoices },
        { provide: FraudDetectionService, useValue: mockFraudDetection },
        { provide: ReferralsService, useValue: mockReferrals },
        { provide: DripScheduleService, useValue: mockDripSchedule },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create()', () => {
    const mockEnrollment = {
      id: 'enr-1',
      studentId: 'student-1',
      courseId: 'course-1',
      txHash: 'tx-123',
      amountPaid: 50,
      course: {
        id: 'course-1',
        title: 'Soroban 101',
        instructorAddress: 'GINSTRUCTOR',
      },
      student: { id: 'student-1' },
    };

    it('creates enrollment, updates course stats, notifies users, and initializes side effects on happy path', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', title: 'Soroban 101' });
      mockPrisma.coursePrerequisite.findMany.mockResolvedValue([]);
      mockFraudDetection.processFraudCheck.mockResolvedValue({
        action: 'ALLOW',
        score: 0,
        reasons: [],
      });
      mockPrisma.enrollment.create.mockResolvedValue(mockEnrollment);
      mockPrisma.course.update.mockResolvedValue({});
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'inst-user-1' });
      mockInvoices.generateForEnrollment.mockResolvedValue({});
      mockReferrals.trackConversion.mockResolvedValue({});
      mockDripSchedule.calculateAndSyncUnlockSchedule.mockResolvedValue({});

      const result = await service.create('student-1', 'course-1', 'tx-123', 50);

      expect(result).toEqual(mockEnrollment);
      expect(mockPrisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: {
          totalEnrollments: { increment: 1 },
          totalRevenue: { increment: 50 },
        },
      });
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        NotificationType.ENROLLMENT_CONFIRMED,
        'Enrollment confirmed!',
        expect.stringContaining('Soroban 101'),
        { courseId: 'course-1', txHash: 'tx-123' },
      );
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'inst-user-1',
        NotificationType.NEW_ENROLLMENT,
        'New student enrolled',
        expect.stringContaining('Soroban 101'),
        { courseId: 'course-1' },
      );
      expect(mockInvoices.generateForEnrollment).toHaveBeenCalledWith('enr-1');
      expect(mockReferrals.trackConversion).toHaveBeenCalledWith('student-1', 'enr-1');
      expect(mockDripSchedule.calculateAndSyncUnlockSchedule).toHaveBeenCalledWith('enr-1');
    });

    it('throws ConflictException when student is already enrolled', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(mockEnrollment);

      await expect(
        service.create('student-1', 'course-1', 'tx-123', 50),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when prerequisites are not met', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', title: 'Soroban 101' });
      mockPrisma.coursePrerequisite.findMany.mockResolvedValue([
        { prerequisiteId: 'prereq-1', prerequisite: { id: 'prereq-1', title: 'Rust Basics' } },
      ]);
      mockPrisma.enrollment.findMany.mockResolvedValue([]);

      await expect(
        service.create('student-1', 'course-1', 'tx-123', 50),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('throws HttpException 423 when fraud detection returns HOLD', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', title: 'Soroban 101' });
      mockPrisma.coursePrerequisite.findMany.mockResolvedValue([]);
      mockFraudDetection.processFraudCheck.mockResolvedValue({
        action: 'HOLD',
        score: 95,
        reasons: ['velocity_spike'],
        flagId: 'flag-1',
      });

      await expect(
        service.create('student-1', 'course-1', 'tx-123', 50),
      ).rejects.toThrow(HttpException);
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('translates Prisma P2002 race condition into ConflictException', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);
      mockPrisma.course.findUnique.mockResolvedValue({ id: 'course-1', title: 'Soroban 101' });
      mockPrisma.coursePrerequisite.findMany.mockResolvedValue([]);
      mockFraudDetection.processFraudCheck.mockResolvedValue({
        action: 'ALLOW',
        score: 0,
        reasons: [],
      });
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPrisma.enrollment.create.mockRejectedValue(p2002);

      await expect(
        service.create('student-1', 'course-1', 'tx-123', 50),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByStudent()', () => {
    it('returns paginated enrollments with metadata', async () => {
      const rows = [{ id: 'enr-1' }];
      mockPrisma.$transaction.mockResolvedValue([rows, 1]);

      const res = await service.findByStudent('student-1', 2, 10);
      expect(res).toEqual({
        data: rows,
        meta: { total: 1, page: 2, limit: 10 },
      });
    });
  });

  describe('findOne() & isEnrolled()', () => {
    it('returns enrollment when found and throws NotFoundException when missing', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({ id: 'enr-1' });
      await expect(service.findOne('student-1', 'course-1')).resolves.toEqual({ id: 'enr-1' });

      mockPrisma.enrollment.findUnique.mockResolvedValueOnce(null);
      await expect(service.findOne('student-1', 'course-1')).rejects.toThrow(NotFoundException);
    });

    it('returns boolean for isEnrolled()', async () => {
      mockPrisma.enrollment.count.mockResolvedValueOnce(1);
      await expect(service.isEnrolled('student-1', 'course-1')).resolves.toBe(true);

      mockPrisma.enrollment.count.mockResolvedValueOnce(0);
      await expect(service.isEnrolled('student-1', 'course-1')).resolves.toBe(false);
    });
  });

  describe('checkPrerequisites() & upsertFromBackup()', () => {
    it('throws NotFoundException in checkPrerequisites if course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);
      await expect(service.checkPrerequisites('student-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('handles create, overwrite, and merge modes in upsertFromBackup()', async () => {
      mockPrisma.enrollment.findUnique.mockResolvedValueOnce(null);
      mockPrisma.enrollment.create.mockResolvedValueOnce({
        id: 'enr-new',
        studentId: 's1',
        courseId: 'c1',
      });

      const created = await service.upsertFromBackup({
        studentId: 's1',
        courseId: 'c1',
        amountPaid: 10,
        mode: 'create',
      });
      expect(created.action).toBe('created');

      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({
        id: 'enr-existing',
        progressPercent: 40,
        amountPaid: 10,
        status: 'ACTIVE',
      });
      const skipped = await service.upsertFromBackup({
        studentId: 's1',
        courseId: 'c1',
        amountPaid: 20,
        mode: 'create',
      });
      expect(skipped.action).toBe('skipped');

      mockPrisma.enrollment.findUnique.mockResolvedValueOnce({
        id: 'enr-existing',
        progressPercent: 40,
        amountPaid: 10,
        status: 'ACTIVE',
      });
      mockPrisma.enrollment.update.mockResolvedValueOnce({ id: 'enr-existing', progressPercent: 80 });
      const merged = await service.upsertFromBackup({
        studentId: 's1',
        courseId: 'c1',
        amountPaid: 20,
        progressPercent: 80,
        mode: 'merge',
      });
      expect(merged.action).toBe('merged');
    });
  });
});
