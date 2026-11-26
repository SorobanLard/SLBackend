import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateQuestionDto } from './dto/create-question.dto';
import { CreateAnswerDto } from './dto/create-answer.dto';

describe('QuestionsController', () => {
  let controller: QuestionsController;

  const mockQuestionsService = {
    createQuestion: jest.fn(),
    getQuestionsByLesson: jest.fn(),
    createAnswer: jest.fn(),
    markBestAnswer: jest.fn(),
  };

  const student = { id: 'user-1', role: UserRole.STUDENT };
  const admin = { id: 'admin-1', role: UserRole.ADMIN };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuestionsController],
      providers: [
        { provide: QuestionsService, useValue: mockQuestionsService },
      ],
    }).compile();

    controller = module.get<QuestionsController>(QuestionsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── Route delegation ─────────────────────────────────────────────────────

  describe('createQuestion', () => {
    const dto: CreateQuestionDto = {
      title: 'What is Soroban?',
      content: 'Please explain Soroban smart contracts in detail.',
    };

    it('delegates to questionsService.createQuestion with lessonId, user id, role and dto', async () => {
      const question = { id: 'q-1', title: dto.title };
      mockQuestionsService.createQuestion.mockResolvedValue(question);

      const result = await controller.createQuestion('lesson-1', student, dto);

      expect(mockQuestionsService.createQuestion).toHaveBeenCalledWith(
        'lesson-1',
        student.id,
        student.role,
        dto,
      );
      expect(result).toBe(question);
    });

    it('passes admin role through correctly', async () => {
      mockQuestionsService.createQuestion.mockResolvedValue({ id: 'q-2' });

      await controller.createQuestion('lesson-1', admin, dto);

      expect(mockQuestionsService.createQuestion).toHaveBeenCalledWith(
        'lesson-1',
        admin.id,
        admin.role,
        dto,
      );
    });

    it('propagates service errors', async () => {
      mockQuestionsService.createQuestion.mockRejectedValue(new Error('Lesson not found'));
      await expect(controller.createQuestion('bad-lesson', student, dto)).rejects.toThrow(
        'Lesson not found',
      );
    });
  });

  describe('getQuestions', () => {
    it('delegates with lessonId and applies page/limit from query', async () => {
      const page = { data: [], meta: { total: 0, page: 2, limit: 10, totalPages: 0 } };
      mockQuestionsService.getQuestionsByLesson.mockResolvedValue(page);

      const result = await controller.getQuestions('lesson-1', { page: 2, limit: 10 } as any);

      expect(mockQuestionsService.getQuestionsByLesson).toHaveBeenCalledWith('lesson-1', 2, 10);
      expect(result).toBe(page);
    });

    it('defaults page to 1 and limit to 20 when query values are absent', async () => {
      mockQuestionsService.getQuestionsByLesson.mockResolvedValue({ data: [] });

      await controller.getQuestions('lesson-1', {} as any);

      expect(mockQuestionsService.getQuestionsByLesson).toHaveBeenCalledWith('lesson-1', 1, 20);
    });

    it('defaults when query is undefined', async () => {
      mockQuestionsService.getQuestionsByLesson.mockResolvedValue({ data: [] });

      await controller.getQuestions('lesson-1', undefined as any);

      expect(mockQuestionsService.getQuestionsByLesson).toHaveBeenCalledWith('lesson-1', 1, 20);
    });
  });

  describe('createAnswer', () => {
    const dto: CreateAnswerDto = { content: 'Soroban is a smart contract platform.' };

    it('delegates to questionsService.createAnswer with questionId, user id, role and dto', async () => {
      const answer = { id: 'a-1', content: dto.content };
      mockQuestionsService.createAnswer.mockResolvedValue(answer);

      const result = await controller.createAnswer('q-1', student, dto);

      expect(mockQuestionsService.createAnswer).toHaveBeenCalledWith(
        'q-1',
        student.id,
        student.role,
        dto,
      );
      expect(result).toBe(answer);
    });

    it('propagates service errors', async () => {
      mockQuestionsService.createAnswer.mockRejectedValue(new Error('Question not found'));
      await expect(controller.createAnswer('bad-q', student, dto)).rejects.toThrow(
        'Question not found',
      );
    });
  });

  describe('markBestAnswer', () => {
    it('delegates to questionsService.markBestAnswer with answerId, user id and role', async () => {
      const answer = { id: 'a-1', isBestAnswer: true };
      mockQuestionsService.markBestAnswer.mockResolvedValue(answer);

      const result = await controller.markBestAnswer('a-1', student);

      expect(mockQuestionsService.markBestAnswer).toHaveBeenCalledWith(
        'a-1',
        student.id,
        student.role,
      );
      expect(result).toBe(answer);
    });

    it('propagates ForbiddenException from service', async () => {
      mockQuestionsService.markBestAnswer.mockRejectedValue(new Error('Forbidden'));
      await expect(controller.markBestAnswer('a-1', student)).rejects.toThrow('Forbidden');
    });
  });

  // ─── Guard / decorator wiring ─────────────────────────────────────────────

  describe('guard wiring', () => {
    it('the controller class itself carries no class-level guard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, QuestionsController)).toBeUndefined();
    });

    it('createQuestion requires JwtAuthGuard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, QuestionsController.prototype.createQuestion),
      ).toEqual([JwtAuthGuard]);
    });

    it('createAnswer requires JwtAuthGuard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, QuestionsController.prototype.createAnswer),
      ).toEqual([JwtAuthGuard]);
    });

    it('markBestAnswer requires JwtAuthGuard', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, QuestionsController.prototype.markBestAnswer),
      ).toEqual([JwtAuthGuard]);
    });

    it('getQuestions is publicly accessible (no guard)', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, QuestionsController.prototype.getQuestions),
      ).toBeUndefined();
    });
  });
});
