import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { EnrollmentsController } from './enrollments.controller';
import { EnrollmentsService } from './enrollments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('EnrollmentsController', () => {
  let controller: EnrollmentsController;

  const mockEnrollmentsService = {
    create: jest.fn(),
    findByStudent: jest.fn(),
    findByCourse: jest.fn(),
    findOne: jest.fn(),
    isEnrolled: jest.fn(),
    checkPrerequisites: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollmentsController],
      providers: [
        { provide: EnrollmentsService, useValue: mockEnrollmentsService },
      ],
    }).compile();

    controller = module.get<EnrollmentsController>(EnrollmentsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── Route delegation ─────────────────────────────────────────────────────

  describe('create', () => {
    const body = { courseId: 'course-1', txHash: '0xabc', amountPaid: 100 };

    it('delegates to enrollmentsService.create and returns the result', async () => {
      const enrollment = { id: 'enr-1' };
      mockEnrollmentsService.create.mockResolvedValue(enrollment);

      const result = await controller.create('student-1', body);

      expect(mockEnrollmentsService.create).toHaveBeenCalledWith(
        'student-1',
        'course-1',
        '0xabc',
        100,
      );
      expect(result).toBe(enrollment);
    });

    it('converts a Prisma P2002 unique-constraint error into ConflictException', async () => {
      const prismaError = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      mockEnrollmentsService.create.mockRejectedValue(prismaError);

      await expect(controller.create('student-1', body)).rejects.toThrow(ConflictException);
    });

    it('re-throws non-P2002 errors unchanged', async () => {
      const unexpected = new Error('DB down');
      mockEnrollmentsService.create.mockRejectedValue(unexpected);

      await expect(controller.create('student-1', body)).rejects.toThrow('DB down');
    });
  });

  describe('findMy', () => {
    it('delegates to findByStudent with student id, page and limit', () => {
      mockEnrollmentsService.findByStudent.mockReturnValue([]);

      controller.findMy('student-1', { page: 2, limit: 10 } as any);

      expect(mockEnrollmentsService.findByStudent).toHaveBeenCalledWith('student-1', 2, 10);
    });

    it('passes undefined page/limit when query is omitted', () => {
      controller.findMy('student-1', {} as any);

      expect(mockEnrollmentsService.findByStudent).toHaveBeenCalledWith(
        'student-1',
        undefined,
        undefined,
      );
    });
  });

  describe('findByCourse', () => {
    it('delegates to findByCourse with course id, page and limit', () => {
      mockEnrollmentsService.findByCourse.mockReturnValue([]);

      controller.findByCourse('course-1', { page: 1, limit: 20 } as any);

      expect(mockEnrollmentsService.findByCourse).toHaveBeenCalledWith('course-1', 1, 20);
    });
  });

  describe('findOne', () => {
    it('delegates to findOne with student and course ids', () => {
      const enrollment = { id: 'enr-1' };
      mockEnrollmentsService.findOne.mockReturnValue(enrollment);

      const result = controller.findOne('student-1', 'course-1');

      expect(mockEnrollmentsService.findOne).toHaveBeenCalledWith('student-1', 'course-1');
      expect(result).toBe(enrollment);
    });
  });

  describe('isEnrolled', () => {
    it('delegates to isEnrolled with student and course ids', () => {
      mockEnrollmentsService.isEnrolled.mockReturnValue({ enrolled: true });

      const result = controller.isEnrolled('student-1', 'course-1');

      expect(mockEnrollmentsService.isEnrolled).toHaveBeenCalledWith('student-1', 'course-1');
      expect(result).toEqual({ enrolled: true });
    });
  });

  describe('checkPrerequisites', () => {
    it('delegates to checkPrerequisites with student and course ids', () => {
      const prereqResult = { eligible: false, missing: ['course-0'] };
      mockEnrollmentsService.checkPrerequisites.mockReturnValue(prereqResult);

      const result = controller.checkPrerequisites('student-1', 'course-1');

      expect(mockEnrollmentsService.checkPrerequisites).toHaveBeenCalledWith(
        'student-1',
        'course-1',
      );
      expect(result).toBe(prereqResult);
    });
  });

  // ─── Guard / decorator wiring ─────────────────────────────────────────────

  describe('guard wiring', () => {
    it('applies JwtAuthGuard at the controller class level (all routes protected)', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, EnrollmentsController)).toEqual([
        JwtAuthGuard,
      ]);
    });

    it.each([
      'create',
      'findMy',
      'findByCourse',
      'findOne',
      'isEnrolled',
      'checkPrerequisites',
    ] as const)(
      '%s has no additional method-level guard (class-level guard is sufficient)',
      (method) => {
        const methodGuards = Reflect.getMetadata(
          GUARDS_METADATA,
          EnrollmentsController.prototype[method],
        );
        expect(methodGuards).toBeUndefined();
      },
    );
  });
});
