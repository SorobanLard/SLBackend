import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { CourseAutosaveController } from './course-autosave.controller';
import { CourseAutosaveService } from './course-autosave.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CourseAutosaveController', () => {
  let controller: CourseAutosaveController;

  const mockAutosaveService = {
    autosave: jest.fn(),
    getRecoveredDraft: jest.fn(),
    getDraftById: jest.fn(),
    discardDraft: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourseAutosaveController],
      providers: [
        { provide: CourseAutosaveService, useValue: mockAutosaveService },
        Reflector,
      ],
    }).compile();

    controller = module.get<CourseAutosaveController>(CourseAutosaveController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard and RolesGuard(INSTRUCTOR, ADMIN) at the controller level', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CourseAutosaveController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, CourseAutosaveController)).toEqual([
      UserRole.INSTRUCTOR,
      UserRole.ADMIN,
    ]);

    const rolesGuard = new RolesGuard(new Reflector());
    const studentCtx = {
      getHandler: () => controller.autosave,
      getClass: () => CourseAutosaveController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'stu-1', role: UserRole.STUDENT } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(studentCtx)).toBe(false);
  });

  it('autosave delegates to autosaveService.autosave with userId, stellarAddress, and dto', async () => {
    const dto = { title: 'Draft Course', category: 'Solar' } as any;
    const expected = { id: 'draft-1', ...dto };
    mockAutosaveService.autosave.mockResolvedValue(expected);

    const res = await controller.autosave('inst-1', 'GABC123', dto);

    expect(mockAutosaveService.autosave).toHaveBeenCalledWith(
      'inst-1',
      'GABC123',
      dto,
    );
    expect(res).toEqual(expected);
  });

  it('getRecoveredDraft delegates to autosaveService.getRecoveredDraft', async () => {
    const expected = { id: 'draft-1', courseId: 'c-1' };
    mockAutosaveService.getRecoveredDraft.mockResolvedValue(expected);

    const res = await controller.getRecoveredDraft('inst-1', 'c-1');

    expect(mockAutosaveService.getRecoveredDraft).toHaveBeenCalledWith(
      'inst-1',
      'c-1',
    );
    expect(res).toEqual(expected);
  });

  it('getDraftById and discardDraft delegate to autosaveService', async () => {
    mockAutosaveService.getDraftById.mockResolvedValue({ id: 'draft-1' });
    mockAutosaveService.discardDraft.mockResolvedValue({ discarded: true });

    await expect(controller.getDraftById('draft-1', 'inst-1')).resolves.toEqual({
      id: 'draft-1',
    });
    await expect(controller.discardDraft('draft-1', 'inst-1')).resolves.toEqual({
      discarded: true,
    });

    expect(mockAutosaveService.getDraftById).toHaveBeenCalledWith('draft-1', 'inst-1');
    expect(mockAutosaveService.discardDraft).toHaveBeenCalledWith('draft-1', 'inst-1');
  });

  it('propagates ForbiddenException / NotFoundException when accessing another user draft', async () => {
    mockAutosaveService.getDraftById.mockRejectedValue(
      new ForbiddenException('Draft belongs to another instructor'),
    );
    await expect(controller.getDraftById('draft-1', 'other-inst')).rejects.toThrow(
      ForbiddenException,
    );

    mockAutosaveService.discardDraft.mockRejectedValue(
      new NotFoundException('Draft not found'),
    );
    await expect(controller.discardDraft('missing', 'inst-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
