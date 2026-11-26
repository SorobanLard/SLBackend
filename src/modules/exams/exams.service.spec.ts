import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ExamsService } from './exams.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('ExamsService', () => {
  let service: ExamsService;
  let prisma: any;

  const mockPrisma = {
    course: { findUnique: jest.fn() },
    exam: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    enrollment: { findUnique: jest.fn() },
    examAttempt: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ExamsService>(ExamsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOrUpdateExam', () => {
    const dto: any = {
      courseId: 'course-1',
      title: 'Final Exam',
      description: 'desc',
      questions: [{ id: 'q1', points: 1, correctAnswer: 'a' }],
    };

    it('throws NotFoundException when course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(
        service.createOrUpdateExam('instructor-1', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when caller is not the instructor', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        instructor: { id: 'other' },
        instructorAddress: 'other-address',
      });

      await expect(
        service.createOrUpdateExam('instructor-1', dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates a new exam with default thresholds when none exists', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        instructor: { id: 'instructor-1' },
        instructorAddress: 'addr',
      });
      prisma.exam.findUnique.mockResolvedValue(null);
      prisma.exam.create.mockResolvedValue({ id: 'exam-1' });

      const result = await service.createOrUpdateExam('instructor-1', dto);

      expect(prisma.exam.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseId: 'course-1',
          passingScore: 70,
          cooldownHours: 24,
        }),
      });
      expect(result).toEqual({ id: 'exam-1' });
    });

    it('updates an existing exam preserving thresholds when omitted', async () => {
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        instructor: { id: 'instructor-1' },
        instructorAddress: 'addr',
      });
      prisma.exam.findUnique.mockResolvedValue({
        id: 'exam-1',
        passingScore: 80,
        cooldownHours: 12,
      });
      prisma.exam.update.mockResolvedValue({ id: 'exam-1' });

      await service.createOrUpdateExam('instructor-1', dto);

      expect(prisma.exam.update).toHaveBeenCalledWith({
        where: { id: 'exam-1' },
        data: expect.objectContaining({
          passingScore: 80,
          cooldownHours: 12,
        }),
      });
    });
  });

  describe('getExamByCourse / getExamById', () => {
    it('throws NotFoundException when exam missing for course', async () => {
      prisma.exam.findUnique.mockResolvedValue(null);
      await expect(service.getExamByCourse('course-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when exam id missing', async () => {
      prisma.exam.findUnique.mockResolvedValue(null);
      await expect(service.getExamById('exam-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('checkEligibility', () => {
    const exam = {
      id: 'exam-1',
      courseId: 'course-1',
      cooldownHours: 24,
      passingScore: 70,
    };

    it('returns ineligible when student is not enrolled', async () => {
      prisma.exam.findUnique.mockResolvedValue(exam);
      prisma.enrollment.findUnique.mockResolvedValue(null);

      const result = await service.checkEligibility('student-1', 'exam-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('not enrolled');
    });

    it('returns ineligible when progress is below 100%', async () => {
      prisma.exam.findUnique.mockResolvedValue(exam);
      prisma.enrollment.findUnique.mockResolvedValue({
        progressPercent: 50,
        status: 'IN_PROGRESS',
      });

      const result = await service.checkEligibility('student-1', 'exam-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('100%');
    });

    it('returns ineligible when student already passed', async () => {
      prisma.exam.findUnique.mockResolvedValue(exam);
      prisma.enrollment.findUnique.mockResolvedValue({
        progressPercent: 100,
        status: 'COMPLETED',
      });
      prisma.examAttempt.findFirst.mockResolvedValue({
        passed: true,
        attemptedAt: new Date(),
      });

      const result = await service.checkEligibility('student-1', 'exam-1');
      expect(result.eligible).toBe(false);
      expect(result.passed).toBe(true);
    });

    it('returns ineligible during cooldown window', async () => {
      prisma.exam.findUnique.mockResolvedValue(exam);
      prisma.enrollment.findUnique.mockResolvedValue({
        progressPercent: 100,
        status: 'COMPLETED',
      });
      prisma.examAttempt.findFirst.mockResolvedValue({
        passed: false,
        attemptedAt: new Date(),
      });

      const result = await service.checkEligibility('student-1', 'exam-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('cooldown');
      expect(result.remainingMinutes).toBeGreaterThan(0);
    });

    it('returns eligible when cooldown has elapsed', async () => {
      prisma.exam.findUnique.mockResolvedValue(exam);
      prisma.enrollment.findUnique.mockResolvedValue({
        progressPercent: 100,
        status: 'COMPLETED',
      });
      prisma.examAttempt.findFirst.mockResolvedValue({
        passed: false,
        attemptedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      });

      const result = await service.checkEligibility('student-1', 'exam-1');
      expect(result).toEqual({ eligible: true });
    });
  });

  describe('submitExam', () => {
    const exam = {
      id: 'exam-1',
      courseId: 'course-1',
      cooldownHours: 24,
      passingScore: 70,
      questions: [
        { id: 'q1', points: 1, correctAnswer: 'a' },
        { id: 'q2', points: 1, correctAnswer: ['b', 'c'] },
      ],
    };

    beforeEach(() => {
      jest.spyOn(service, 'checkEligibility').mockResolvedValue({
        eligible: true,
      } as any);
    });

    it('throws ForbiddenException when not eligible', async () => {
      (service.checkEligibility as jest.Mock).mockResolvedValue({
        eligible: false,
        reason: 'nope',
      });

      await expect(
        service.submitExam('student-1', 'exam-1', { answers: {} } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when exam has no questions', async () => {
      prisma.exam.findUnique.mockResolvedValue({ ...exam, questions: [] });

      await expect(
        service.submitExam('student-1', 'exam-1', { answers: {} } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for unknown question id', async () => {
      prisma.exam.findUnique.mockResolvedValue(exam);

      await expect(
        service.submitExam('student-1', 'exam-1', {
          answers: { unknown: 'a' },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('scores a passing attempt and records it', async () => {
      prisma.exam.findUnique.mockResolvedValue(exam);
      prisma.examAttempt.create.mockResolvedValue({
        id: 'attempt-1',
        attemptedAt: new Date(),
      });

      const result = await service.submitExam('student-1', 'exam-1', {
        answers: { q1: 'a', q2: ['b', 'c'] },
      } as any);

      expect(result.score).toBe(100);
      expect(result.passed).toBe(true);
      expect(prisma.examAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          examId: 'exam-1',
          studentId: 'student-1',
          score: 100,
          passed: true,
        }),
      });
    });

    it('scores a failing attempt below passing threshold', async () => {
      prisma.exam.findUnique.mockResolvedValue(exam);
      prisma.examAttempt.create.mockResolvedValue({
        id: 'attempt-2',
        attemptedAt: new Date(),
      });

      const result = await service.submitExam('student-1', 'exam-1', {
        answers: { q1: 'a', q2: ['b'] },
      } as any);

      expect(result.score).toBe(50);
      expect(result.passed).toBe(false);
    });
  });

  describe('getAttemptHistory', () => {
    it('returns attempts ordered by date', async () => {
      const attempts = [{ id: 'a1' }];
      prisma.examAttempt.findMany.mockResolvedValue(attempts);

      const result = await service.getAttemptHistory('student-1', 'exam-1');

      expect(prisma.examAttempt.findMany).toHaveBeenCalledWith({
        where: { studentId: 'student-1', examId: 'exam-1' },
        orderBy: { attemptedAt: 'desc' },
      });
      expect(result).toEqual(attempts);
    });
  });

  describe('hasPassedExam', () => {
    it('returns true when course has no exam', async () => {
      prisma.exam.findUnique.mockResolvedValue(null);
      await expect(
        service.hasPassedExam('student-1', 'course-1'),
      ).resolves.toBe(true);
    });

    it('returns true when a passing attempt exists', async () => {
      prisma.exam.findUnique.mockResolvedValue({ id: 'exam-1' });
      prisma.examAttempt.findFirst.mockResolvedValue({ id: 'attempt-1' });
      await expect(
        service.hasPassedExam('student-1', 'course-1'),
      ).resolves.toBe(true);
    });

    it('returns false when no passing attempt exists', async () => {
      prisma.exam.findUnique.mockResolvedValue({ id: 'exam-1' });
      prisma.examAttempt.findFirst.mockResolvedValue(null);
      await expect(
        service.hasPassedExam('student-1', 'course-1'),
      ).resolves.toBe(false);
    });
  });

  describe('deleteExam', () => {
    const examWithCourse = {
      id: 'exam-1',
      course: {
        instructor: { id: 'instructor-1' },
        instructorAddress: 'addr',
      },
    };

    it('throws NotFoundException when exam missing', async () => {
      prisma.exam.findUnique.mockResolvedValue(null);
      await expect(
        service.deleteExam('exam-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-owner non-admin', async () => {
      prisma.exam.findUnique.mockResolvedValue(examWithCourse);
      await expect(
        service.deleteExam('exam-1', 'stranger', UserRole.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the course instructor to delete', async () => {
      prisma.exam.findUnique.mockResolvedValue(examWithCourse);
      prisma.exam.delete.mockResolvedValue({ id: 'exam-1' });

      await service.deleteExam('exam-1', 'instructor-1', UserRole.INSTRUCTOR);

      expect(prisma.exam.delete).toHaveBeenCalledWith({
        where: { id: 'exam-1' },
      });
    });

    it('allows an admin to delete', async () => {
      prisma.exam.findUnique.mockResolvedValue(examWithCourse);
      prisma.exam.delete.mockResolvedValue({ id: 'exam-1' });

      await service.deleteExam('exam-1', 'admin-1', UserRole.ADMIN);

      expect(prisma.exam.delete).toHaveBeenCalled();
    });
  });
});
