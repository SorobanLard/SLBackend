import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { QuizSessionsService } from './quiz-sessions.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('QuizSessionsService', () => {
  let service: QuizSessionsService;
  let prisma: {
    quizSession: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    quiz: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      quizSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      quiz: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizSessionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<QuizSessionsService>(QuizSessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a session for an existing quiz (happy path)', async () => {
      const dto = { quizId: 'quiz-1', title: 'Session A' } as any;
      prisma.quiz.findUnique.mockResolvedValue({ id: 'quiz-1' });
      prisma.quizSession.create.mockResolvedValue({ id: 'session-1', ...dto });

      const result = await service.create(dto);

      expect(prisma.quiz.findUnique).toHaveBeenCalledWith({ where: { id: 'quiz-1' } });
      expect(prisma.quizSession.create).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'session-1' }));
    });

    it('throws NotFoundException when the quiz does not exist', async () => {
      prisma.quiz.findUnique.mockResolvedValue(null);

      await expect(service.create({ quizId: 'missing' } as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.quizSession.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns the session when found', async () => {
      const session = { id: 'session-1' };
      prisma.quizSession.findUnique.mockResolvedValue(session);

      await expect(service.findOne('session-1')).resolves.toEqual(session);
    });

    it('throws NotFoundException when the session is missing', async () => {
      prisma.quizSession.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates an existing session', async () => {
      prisma.quizSession.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.quizSession.update.mockResolvedValue({ id: 'session-1', title: 'Updated' });

      const result = await service.update('session-1', { title: 'Updated' } as any);

      expect(prisma.quizSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { title: 'Updated' },
      });
      expect(result).toEqual(expect.objectContaining({ title: 'Updated' }));
    });

    it('throws NotFoundException when updating a missing session', async () => {
      prisma.quizSession.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {} as any)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.quizSession.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an existing session', async () => {
      prisma.quizSession.findUnique.mockResolvedValue({ id: 'session-1' });
      prisma.quizSession.delete.mockResolvedValue({ id: 'session-1' });

      await expect(service.remove('session-1')).resolves.toEqual({ id: 'session-1' });
      expect(prisma.quizSession.delete).toHaveBeenCalledWith({ where: { id: 'session-1' } });
    });

    it('throws NotFoundException when removing a missing session', async () => {
      prisma.quizSession.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.quizSession.delete).not.toHaveBeenCalled();
    });
  });
});
