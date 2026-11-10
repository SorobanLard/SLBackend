import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QuizSessionsController } from './quiz-sessions.controller';
import { QuizSessionsService } from './quiz-sessions.service';
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
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuizSessionsController],
      providers: [
        { provide: QuizSessionsService, useValue: mockQuizSessionsService },
      ],
    }).compile();

    controller = module.get<QuizSessionsController>(QuizSessionsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('protects all routes with JwtAuthGuard at the controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, QuizSessionsController)).toEqual(
      [JwtAuthGuard],
    );
  });

  it('startSession delegates to quizSessionsService.startSession with lessonId, userId, and dto', async () => {
    const dto = { durationSeconds: 600 } as any;
    const expected = { id: 'sess-1', lessonId: 'lesson-1', remainingSeconds: 600 };
    mockQuizSessionsService.startSession.mockResolvedValue(expected);

    const res = await controller.startSession('lesson-1', dto, 'student-1');

    expect(mockQuizSessionsService.startSession).toHaveBeenCalledWith(
      'lesson-1',
      'student-1',
      dto,
    );
    expect(res).toEqual(expected);
  });

  it('getSessionStatus delegates to quizSessionsService.getSessionStatus', async () => {
    const expected = { id: 'sess-1', remainingSeconds: 420, isExpired: false };
    mockQuizSessionsService.getSessionStatus.mockResolvedValue(expected);

    const res = await controller.getSessionStatus('sess-1', 'student-1');

    expect(mockQuizSessionsService.getSessionStatus).toHaveBeenCalledWith(
      'sess-1',
      'student-1',
    );
    expect(res).toEqual(expected);
  });

  it('submitSession and autoSubmitSession delegate to quizSessionsService', async () => {
    const dto = { answers: [{ questionId: 'q1', selectedOption: 2 }] } as any;
    mockQuizSessionsService.submitSession.mockResolvedValue({
      sessionId: 'sess-1',
      score: 90,
      passed: true,
    });
    mockQuizSessionsService.autoSubmitSession.mockResolvedValue({
      sessionId: 'sess-1',
      score: 70,
      autoSubmitted: true,
    });

    await expect(
      controller.submitSession('sess-1', dto, 'student-1'),
    ).resolves.toEqual({
      sessionId: 'sess-1',
      score: 90,
      passed: true,
    });
    await expect(
      controller.autoSubmitSession('sess-1', dto, 'student-1'),
    ).resolves.toEqual({
      sessionId: 'sess-1',
      score: 70,
      autoSubmitted: true,
    });

    expect(mockQuizSessionsService.submitSession).toHaveBeenCalledWith(
      'sess-1',
      'student-1',
      dto,
    );
    expect(mockQuizSessionsService.autoSubmitSession).toHaveBeenCalledWith(
      'sess-1',
      'student-1',
      dto,
    );
  });

  it('propagates ForbiddenException / BadRequestException when session is expired or owned by another user', async () => {
    mockQuizSessionsService.getSessionStatus.mockRejectedValue(
      new ForbiddenException('You do not own this quiz session'),
    );
    await expect(
      controller.getSessionStatus('sess-1', 'other-student'),
    ).rejects.toThrow(ForbiddenException);

    mockQuizSessionsService.submitSession.mockRejectedValue(
      new BadRequestException('Quiz session has already been submitted'),
    );
    await expect(
      controller.submitSession('sess-1', { answers: [] } as any, 'student-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
