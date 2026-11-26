import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { QuizAttemptsService } from './quiz-attempts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('QuizAttemptsService', () => {
  let service: QuizAttemptsService;
  let prisma: {
    quiz: { findUnique: jest.Mock };
    quizAttempt: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      quiz: { findUnique: jest.fn() },
      quizAttempt: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizAttemptsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<QuizAttemptsService>(QuizAttemptsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startAttempt', () => {
    it('creates an attempt for an existing quiz (happy path)', async () => {
      const quiz = { id: 'quiz-1', isPublished: true, maxAttempts: 3 };
      const attempt = { id: 'attempt-1', quizId: 'quiz-1', userId: 'user-1' };
      prisma.quiz.findUnique.mockResolvedValue(quiz);
      prisma.quizAttempt.count.mockResolvedValue(0);
      prisma.quizAttempt.create.mockResolvedValue(attempt);

      const result = await service.startAttempt('quiz-1', 'user-1');

      expect(prisma.quiz.findUnique).toHaveBeenCalledWith({ where: { id: 'quiz-1' } });
      expect(prisma.quizAttempt.create).toHaveBeenCalled();
      expect(result).toEqual(attempt);
    });

    it('throws NotFoundException when the quiz does not exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);

      await expect(service.startAttempt('missing', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when max attempts are exceeded', async () => {
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1', isPublished: true, maxAttempts: 1 });
      prisma.quizAttempt.count.mockResolvedValue(1);

      await expect(service.startAttempt('quiz-1', 'user-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
    });
  });

  describe('submitAttempt', () => {
    it('throws NotFoundException when the attempt does not exist', async () => {
      prisma.quizAttempt.findUnique.mockResolvedValue(null);

      await expect(
        service.submitAttempt('missing', 'user-1', { answers: [] } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when the attempt belongs to another user', async () => {
      prisma.quizAttempt.findUnique.mockResolvedValue({
        id: 'attempt-1',
        userId: 'other-user',
        status: 'IN_PROGRESS',
      });

      await expect(
        service.submitAttempt('attempt-1', 'user-1', { answers: [] } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws BadRequestException when the attempt is already submitted', async () => {
      prisma.quizAttempt.findUnique.mockResolvedValue({
        id: 'attempt-1',
        userId: 'user-1',
        status: 'SUBMITTED',
      });

      await expect(
        service.submitAttempt('attempt-1', 'user-1', { answers: [] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getAttempt', () => {
    it('returns the attempt for the owning user', async () => {
      const attempt = { id: 'attempt-1', userId: 'user-1' };
      prisma.quizAttempt.findUnique.mockResolvedValue(attempt);

      await expect(service.getAttempt('attempt-1', 'user-1')).resolves.toEqual(attempt);
    });

    it('throws NotFoundException when the attempt is missing', async () => {
      prisma.quizAttempt.findUnique.mockResolvedValue(null);

      await expect(service.getAttempt('missing', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
