import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('TagsController', () => {
  let controller: TagsController;

  const mockTagsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findByCourse: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    merge: jest.fn(),
    attachToCourse: jest.fn(),
    detachFromCourse: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TagsController],
      providers: [
        { provide: TagsService, useValue: mockTagsService },
        Reflector,
      ],
    }).compile();

    controller = module.get<TagsController>(TagsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard + RolesGuard and restricts mutation routes to ADMIN', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TagsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);

    const adminOnlyHandlers = [
      controller.create,
      controller.update,
      controller.remove,
      controller.merge,
      controller.attachToCourse,
      controller.detachFromCourse,
    ];
    for (const handler of adminOnlyHandlers) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    }

    const readHandlers = [
      controller.findAll,
      controller.findByCourse,
      controller.findOne,
    ];
    for (const handler of readHandlers) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        UserRole.ADMIN,
        UserRole.INSTRUCTOR,
        UserRole.STUDENT,
      ]);
    }

    const rolesGuard = new RolesGuard(new Reflector());
    const studentCreateCtx = {
      getHandler: () => controller.create,
      getClass: () => TagsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'stu-1', role: UserRole.STUDENT } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(studentCreateCtx)).toBe(false);
  });

  it('create, update, and remove delegate to tagsService', async () => {
    const createDto = { label: 'Soroban' } as any;
    mockTagsService.create.mockResolvedValue({ id: 'tag-1', label: 'Soroban' });
    mockTagsService.update.mockResolvedValue({ id: 'tag-1', label: 'Stellar' });
    mockTagsService.remove.mockResolvedValue({ deleted: true });

    await expect(controller.create('admin-1', createDto)).resolves.toEqual({
      id: 'tag-1',
      label: 'Soroban',
    });
    await expect(
      controller.update('tag-1', 'admin-1', { label: 'Stellar' } as any),
    ).resolves.toEqual({ id: 'tag-1', label: 'Stellar' });
    await expect(controller.remove('tag-1', 'admin-1')).resolves.toEqual({
      deleted: true,
    });

    expect(mockTagsService.create).toHaveBeenCalledWith('admin-1', createDto);
    expect(mockTagsService.update).toHaveBeenCalledWith('tag-1', 'admin-1', {
      label: 'Stellar',
    });
    expect(mockTagsService.remove).toHaveBeenCalledWith('tag-1', 'admin-1');
  });

  it('findAll, findByCourse, and findOne delegate to tagsService', async () => {
    mockTagsService.findAll.mockResolvedValue({ data: [], total: 0 });
    mockTagsService.findByCourse.mockResolvedValue([{ id: 'tag-1' }]);
    mockTagsService.findOne.mockResolvedValue({ id: 'tag-1' });

    await controller.findAll({ search: 'solar', page: 1, limit: 10 } as any);
    await controller.findByCourse('course-1');
    await controller.findOne('tag-1');

    expect(mockTagsService.findAll).toHaveBeenCalledWith({
      search: 'solar',
      page: 1,
      limit: 10,
    });
    expect(mockTagsService.findByCourse).toHaveBeenCalledWith('course-1');
    expect(mockTagsService.findOne).toHaveBeenCalledWith('tag-1');
  });

  it('merge, attachToCourse, and detachFromCourse delegate to tagsService', async () => {
    mockTagsService.merge.mockResolvedValue({ id: 'tag-1', usageCount: 5 });
    mockTagsService.attachToCourse.mockResolvedValue({ attached: true });
    mockTagsService.detachFromCourse.mockResolvedValue({ detached: true });

    await controller.merge('tag-1', 'admin-1', { sourceTagIds: ['tag-2'] } as any);
    await controller.attachToCourse('tag-1', 'admin-1', { courseId: 'c-1' } as any);
    await controller.detachFromCourse('tag-1', 'c-1', 'admin-1');

    expect(mockTagsService.merge).toHaveBeenCalledWith('tag-1', 'admin-1', {
      sourceTagIds: ['tag-2'],
    });
    expect(mockTagsService.attachToCourse).toHaveBeenCalledWith('tag-1', 'admin-1', {
      courseId: 'c-1',
    });
    expect(mockTagsService.detachFromCourse).toHaveBeenCalledWith(
      'tag-1',
      'c-1',
      'admin-1',
    );
  });

  it('propagates ConflictException and BadRequestException on duplicate slug or self-merge', async () => {
    mockTagsService.create.mockRejectedValue(
      new ConflictException('Tag slug already exists'),
    );
    await expect(
      controller.create('admin-1', { label: 'Soroban' } as any),
    ).rejects.toThrow(ConflictException);

    mockTagsService.merge.mockRejectedValue(
      new BadRequestException('Cannot merge target tag into itself'),
    );
    await expect(
      controller.merge('tag-1', 'admin-1', { sourceTagIds: ['tag-1'] } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
