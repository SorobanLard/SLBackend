import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuizSessionsController } from './quiz-sessions.controller';
import { QuizSessionsService } from './quiz-sessions.service';
import {
  StartQuizSessionDto,
  SubmitSessionAnswersDto,
} from './dto/quiz-sessions.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('QuizSessionsController', () => {
  let controller: QuizSessionsController;

  const mockQuizSessionsService = {
    startSession: jest.fn(),
    getSessionStatus: jest.fn(),
    submitSession: jest.fn(),
    autoSubmitSession: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [QuizSessionsController],
      providers: [
        { provide: QuizSessionsService, useValue: mockQuizSessionsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<QuizSessionsController>(QuizSessionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('startSession (POST /quizzes/lessons/:lessonId/sessions)', () => {
    it('delegates to QuizSessionsService.startSession with lessonId, userId, and dto', async () => {
      const dto: StartQuizSessionDto = { durationMinutes: 30 };
      const expected = {
        sessionId: 'sess-1',
        lessonId: 'lesson-1',
        userId: 'student-1',
        durationMinutes: 30,
        expiresAt: '2026-10-01T00:30:00Z',
      };
      mockQuizSessionsService.startSession.mockResolvedValue(expected);

      const result = await controller.startSession('lesson-1', dto, 'student-1');

      expect(result).toEqual(expected);
      expect(mockQuizSessionsService.startSession).toHaveBeenCalledWith(
        'lesson-1',
        'student-1',
        dto,
      );
    });

    it('declares HTTP 201 CREATED status code metadata', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          QuizSessionsController.prototype.startSession,
        ),
      ).toBe(HttpStatus.CREATED);
    });
  });

  describe('getSessionStatus (GET /quizzes/sessions/:sessionId)', () => {
    it('delegates to QuizSessionsService.getSessionStatus with sessionId and userId', async () => {
      const expected = {
        sessionId: 'sess-1',
        remainingSeconds: 600,
        status: 'ACTIVE',
      };
      mockQuizSessionsService.getSessionStatus.mockResolvedValue(expected);

      const result = await controller.getSessionStatus('sess-1', 'student-1');

      expect(result).toEqual(expected);
      expect(mockQuizSessionsService.getSessionStatus).toHaveBeenCalledWith(
        'sess-1',
        'student-1',
      );
    });

    it('propagates NotFoundException when session does not exist', async () => {
      mockQuizSessionsService.getSessionStatus.mockRejectedValue(
        new NotFoundException('Session not found'),
      );

      await expect(
        controller.getSessionStatus('missing-sess', 'student-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitSession (POST /quizzes/sessions/:sessionId/submit)', () => {
    it('delegates to QuizSessionsService.submitSession with sessionId, userId, and dto', async () => {
      const dto: SubmitSessionAnswersDto = {
        answers: [{ questionId: 'q-1', selectedOption: 2 } as any],
        passThreshold: 75,
      };
      const expected = {
        sessionId: 'sess-1',
        score: 100,
        passed: true,
      };
      mockQuizSessionsService.submitSession.mockResolvedValue(expected);

      const result = await controller.submitSession('sess-1', dto, 'student-1');

      expect(result).toEqual(expected);
      expect(mockQuizSessionsService.submitSession).toHaveBeenCalledWith(
        'sess-1',
        'student-1',
        dto,
      );
    });

    it('declares HTTP 200 OK status code metadata', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          QuizSessionsController.prototype.submitSession,
        ),
      ).toBe(HttpStatus.OK);
    });
  });

  describe('autoSubmitSession (POST /quizzes/sessions/:sessionId/auto-submit)', () => {
    it('delegates to QuizSessionsService.autoSubmitSession with sessionId, userId, and dto', async () => {
      const dto: SubmitSessionAnswersDto = {
        answers: [],
        passThreshold: 70,
      };
      const expected = {
        sessionId: 'sess-1',
        score: 0,
        passed: false,
        autoSubmitted: true,
      };
      mockQuizSessionsService.autoSubmitSession.mockResolvedValue(expected);

      const result = await controller.autoSubmitSession(
        'sess-1',
        dto,
        'student-1',
      );

      expect(result).toEqual(expected);
      expect(mockQuizSessionsService.autoSubmitSession).toHaveBeenCalledWith(
        'sess-1',
        'student-1',
        dto,
      );
    });
  });

  describe('invalid input, forbidden access, and guard wiring', () => {
    it('applies JwtAuthGuard at controller level', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, QuizSessionsController),
      ).toEqual([JwtAuthGuard]);
    });

    it('propagates ForbiddenException / BadRequestException when user does not own session or session expired', async () => {
      mockQuizSessionsService.submitSession.mockRejectedValueOnce(
        new ForbiddenException('You do not own this quiz session'),
      );
      await expect(
        controller.submitSession(
          'sess-1',
          { answers: [] },
          'other-student',
        ),
      ).rejects.toThrow(ForbiddenException);

      mockQuizSessionsService.submitSession.mockRejectedValueOnce(
        new BadRequestException('Quiz session has already expired'),
      );
      await expect(
        controller.submitSession('sess-1', { answers: [] }, 'student-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects out-of-range durationMinutes or passThreshold in DTO validation', async () => {
      const badStartDto = plainToInstance(StartQuizSessionDto, {
        durationMinutes: 0,
      });
      expect((await validate(badStartDto)).length).toBeGreaterThan(0);

      const overMaxStartDto = plainToInstance(StartQuizSessionDto, {
        durationMinutes: 500,
      });
      expect((await validate(overMaxStartDto)).length).toBeGreaterThan(0);

      const badSubmitDto = plainToInstance(SubmitSessionAnswersDto, {
        answers: 'not-an-array',
        passThreshold: 120,
      });
      expect((await validate(badSubmitDto)).length).toBeGreaterThan(0);
    });
  });
});
