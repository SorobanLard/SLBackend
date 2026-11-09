import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CourseAutosaveController } from './course-autosave.controller';
import { CourseAutosaveService } from './course-autosave.service';
import { AutosaveCourseDto } from './dto/autosave-course.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../common/guards/roles.guard';

describe('CourseAutosaveController', () => {
  let controller: CourseAutosaveController;

  const mockAutosaveService = {
    autosave: jest.fn(),
    getRecoveredDraft: jest.fn(),
    getDraftById: jest.fn(),
    discardDraft: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CourseAutosaveController],
      providers: [
        { provide: CourseAutosaveService, useValue: mockAutosaveService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<CourseAutosaveController>(
      CourseAutosaveController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('autosave (POST /courses/autosave)', () => {
    it('delegates to CourseAutosaveService.autosave with userId, stellarAddress, and dto', async () => {
      const dto: AutosaveCourseDto = {
        courseId: 'course-1',
        title: 'Soroban Smart Contracts',
        data: { title: 'Soroban Smart Contracts', modules: [] },
        version: 1,
      };
      const expected = {
        id: 'draft-1',
        courseId: 'course-1',
        instructorId: 'inst-1',
        instructorAddress: 'GABC123',
        title: dto.title,
        data: dto.data,
        version: 2,
        lastSavedAt: new Date('2026-10-01T00:00:00Z'),
      };
      mockAutosaveService.autosave.mockResolvedValue(expected);

      const result = await controller.autosave('inst-1', 'GABC123', dto);

      expect(result).toEqual(expected);
      expect(mockAutosaveService.autosave).toHaveBeenCalledWith(
        'inst-1',
        'GABC123',
        dto,
      );
    });

    it('declares HTTP 200 OK status code metadata', () => {
      const status = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CourseAutosaveController.prototype.autosave,
      );
      expect(status).toBe(HttpStatus.OK);
    });

    it('propagates ConflictException when draft version mismatches', async () => {
      mockAutosaveService.autosave.mockRejectedValue(
        new ConflictException('Conflict detected: draft was modified'),
      );

      await expect(
        controller.autosave('inst-1', 'GABC123', {
          draftId: 'draft-1',
          data: { title: 'Stale' },
          version: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getRecoveredDraft (GET /courses/autosave/recovered)', () => {
    it('delegates to CourseAutosaveService.getRecoveredDraft with userId and optional courseId', async () => {
      const expected = { id: 'draft-1', courseId: 'course-1', version: 3 };
      mockAutosaveService.getRecoveredDraft.mockResolvedValue(expected);

      const result = await controller.getRecoveredDraft('inst-1', 'course-1');

      expect(result).toEqual(expected);
      expect(mockAutosaveService.getRecoveredDraft).toHaveBeenCalledWith(
        'inst-1',
        'course-1',
      );
    });

    it('supports omitting courseId query parameter', async () => {
      mockAutosaveService.getRecoveredDraft.mockResolvedValue(null);

      const result = await controller.getRecoveredDraft('inst-1', undefined);

      expect(result).toBeNull();
      expect(mockAutosaveService.getRecoveredDraft).toHaveBeenCalledWith(
        'inst-1',
        undefined,
      );
    });
  });

  describe('getDraftById (GET /courses/autosave/:id)', () => {
    it('delegates to CourseAutosaveService.getDraftById with draftId and userId', async () => {
      const expected = { id: 'draft-1', instructorId: 'inst-1', version: 1 };
      mockAutosaveService.getDraftById.mockResolvedValue(expected);

      const result = await controller.getDraftById('draft-1', 'inst-1');

      expect(result).toEqual(expected);
      expect(mockAutosaveService.getDraftById).toHaveBeenCalledWith(
        'draft-1',
        'inst-1',
      );
    });

    it('propagates NotFoundException when draft does not exist', async () => {
      mockAutosaveService.getDraftById.mockRejectedValue(
        new NotFoundException('Draft missing not found'),
      );

      await expect(
        controller.getDraftById('missing', 'inst-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('discardDraft (DELETE /courses/autosave/:id)', () => {
    it('delegates to CourseAutosaveService.discardDraft with draftId and userId', async () => {
      const expected = { message: 'Draft draft-1 successfully discarded' };
      mockAutosaveService.discardDraft.mockResolvedValue(expected);

      const result = await controller.discardDraft('draft-1', 'inst-1');

      expect(result).toEqual(expected);
      expect(mockAutosaveService.discardDraft).toHaveBeenCalledWith(
        'draft-1',
        'inst-1',
      );
    });

    it('propagates ForbiddenException when another user attempts to discard a draft', async () => {
      mockAutosaveService.discardDraft.mockRejectedValue(
        new ForbiddenException('You do not have permission to access this draft.'),
      );

      await expect(
        controller.discardDraft('draft-1', 'other-instructor'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('invalid input and forbidden-role guard checks', () => {
    it('applies JwtAuthGuard and RolesGuard and restricts to INSTRUCTOR and ADMIN', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        CourseAutosaveController,
      );
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, CourseAutosaveController)).toEqual([
        UserRole.INSTRUCTOR,
        UserRole.ADMIN,
      ]);
    });

    it('forbids STUDENT role while allowing INSTRUCTOR and ADMIN via RolesGuard', () => {
      const reflector = new Reflector();
      const rolesGuard = new RolesGuard(reflector);
      const makeContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => CourseAutosaveController.prototype.autosave,
          getClass: () => CourseAutosaveController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(makeContext(UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(makeContext(UserRole.INSTRUCTOR))).toBe(
        true,
      );
      expect(rolesGuard.canActivate(makeContext(UserRole.ADMIN))).toBe(true);
    });

    it('rejects invalid AutosaveCourseDto when data is missing or version < 1', async () => {
      const invalidDto = plainToInstance(AutosaveCourseDto, {
        data: null,
        version: 0,
      });
      const errors = await validate(invalidDto);
      const failedProps = errors.map((e) => e.property);
      expect(failedProps).toContain('data');
      expect(failedProps).toContain('version');
    });
  });
});
