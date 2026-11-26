import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { EnrollmentsService } from './enrollments.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ReferralsService } from '../referrals/referrals.service';
import { FraudDetectionService } from './fraud-detection.service';
import { DripScheduleService } from '../lessons/drip-schedule.service';

describe('EnrollmentsService', () => {
  let service: EnrollmentsService;

  const prisma = {
    enrollment: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    course: { update: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const notifications = { notifyUser: jest.fn() };
  const invoices = { generateForEnrollment: jest.fn() };
  const referrals = { trackConversion: jest.fn() };
  const fraudDetection = { processFraudCheck: jest.fn() };
  const dripSchedule = { calculateAndSyncUnlockSchedule: jest.fn() };

  const studentId = 'student-1';
  const courseId = 'course-1';
  const txHash = 'tx-hash-1';
  const amountPaid = 100;

  const buildEnrollment = () => ({
    id: 'enrollment-1',
    studentId,
    courseId,
    txHash,
    amountPaid,
    course: {
      id: courseId,
      title: 'Intro to Stellar',
      instructorAddress: 'G-INSTRUCTOR',
    },
    student: { id: studentId },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: InvoicesService, useValue: invoices },
        { provide: ReferralsService, useValue: referrals },
        { provide: FraudDetectionService, useValue: fraudDetection },
        { provide: DripScheduleService, useValue: dripSchedule },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);

    // Default happy-path stubs
    prisma.enrollment.findUnique.mockResolvedValue(null);
    prisma.enrollment.create.mockResolvedValue(buildEnrollment());
    prisma.course.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ id: 'instructor-1' });
    notifications.notifyUser.mockResolvedValue(undefined);
    invoices.generateForEnrollment.mockResolvedValue(undefined);
    referrals.trackConversion.mockResolvedValue(undefined);
    dripSchedule.calculateAndSyncUnlockSchedule.mockResolvedValue(undefined);
    fraudDetection.processFraudCheck.mockResolvedValue({
      action: 'ALLOW',
      score: 0,
      reasons: [],
      flagId: null,
    });

    // Prerequisites pass by default
    jest
      .spyOn(service as any, 'checkPrerequisites')
      .mockResolvedValue({ eligible: true, missing: [] });
  });

  describe('create', () => {
    it('creates an enrollment on the happy path', async () => {
      const result = await service.create(studentId, courseId, txHash, amountPaid);

      expect(prisma.enrollment.findUnique).toHaveBeenCalledWith({
        where: { studentId_courseId: { studentId, courseId } },
      });
      expect(prisma.enrollment.create).toHaveBeenCalledWith({
        data: { studentId, courseId, txHash, amountPaid },
        include: { course: true, student: true },
      });
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: courseId },
        data: {
          totalEnrollments: { increment: 1 },
          totalRevenue: { increment: amountPaid },
        },
      });
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        studentId,
        NotificationType.ENROLLMENT_CONFIRMED,
        'Enrollment confirmed!',
        expect.stringContaining('Intro to Stellar'),
        { courseId, txHash },
      );
      expect(invoices.generateForEnrollment).toHaveBeenCalledWith('enrollment-1');
      expect(referrals.trackConversion).toHaveBeenCalledWith(studentId, 'enrollment-1');
      expect(dripSchedule.calculateAndSyncUnlockSchedule).toHaveBeenCalledWith(
        'enrollment-1',
      );
      expect(result).toEqual(buildEnrollment());
    });

    it('throws ConflictException when already enrolled', async () => {
      prisma.enrollment.findUnique.mockResolvedValue(buildEnrollment());

      await expect(
        service.create(studentId, courseId, txHash, amountPaid),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when prerequisites are not met', async () => {
      jest
        .spyOn(service as any, 'checkPrerequisites')
        .mockResolvedValue({ eligible: false, missing: ['course-0'] });

      await expect(
        service.create(studentId, courseId, txHash, amountPaid),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('throws HttpException 423 when fraud detection returns HOLD', async () => {
      fraudDetection.processFraudCheck.mockResolvedValue({
        action: 'HOLD',
        score: 95,
        reasons: ['velocity'],
        flagId: 'flag-1',
      });

      await expect(
        service.create(studentId, courseId, txHash, amountPaid),
      ).rejects.toMatchObject({ status: 423 });
      expect(prisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('does not fail enrollment when invoice generation throws', async () => {
      invoices.generateForEnrollment.mockRejectedValue(new Error('invoice boom'));

      const result = await service.create(studentId, courseId, txHash, amountPaid);

      expect(result).toEqual(buildEnrollment());
      expect(referrals.trackConversion).toHaveBeenCalled();
    });
  });

  describe('findByStudent', () => {
    it('returns paginated enrollments', async () => {
      const enrollments = [buildEnrollment()];
      prisma.$transaction.mockResolvedValue([enrollments, 1]);

      const result = await service.findByStudent(studentId, 1, 20);

      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { studentId }, skip: 0, take: 20 }),
      );
      expect(result).toEqual({ data: enrollments, meta: { total: 1 } });
    });
  });
});
