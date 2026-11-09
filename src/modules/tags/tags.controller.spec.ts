import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { MergeTagsDto } from './dto/merge-tags.dto';
import { AttachTagDto } from './dto/attach-tag.dto';
import { QueryTagsDto } from './dto/query-tags.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../common/guards/roles.guard';

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
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TagsController],
      providers: [{ provide: TagsService, useValue: mockTagsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<TagsController>(TagsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create (POST /tags)', () => {
    it('delegates to TagsService.create with adminId and dto', async () => {
      const dto: CreateTagDto = { label: 'Web Design' };
      const expected = { id: 'tag-1', label: 'Web Design', slug: 'web-design', usageCount: 0 };
      mockTagsService.create.mockResolvedValue(expected);

      const result = await controller.create('admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockTagsService.create).toHaveBeenCalledWith('admin-1', dto);
    });

    it('declares HTTP 201 CREATED status code metadata', () => {
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, TagsController.prototype.create),
      ).toBe(HttpStatus.CREATED);
    });

    it('propagates ConflictException when tag slug already exists', async () => {
      mockTagsService.create.mockRejectedValue(
        new ConflictException('Tag already exists'),
      );

      await expect(
        controller.create('admin-1', { label: 'Web Design' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll (GET /tags)', () => {
    it('delegates to TagsService.findAll with query params', async () => {
      const query: QueryTagsDto = { search: 'web', page: 1, limit: 20 } as any;
      const expected = { items: [{ id: 'tag-1', label: 'Web Design' }], total: 1 };
      mockTagsService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query);

      expect(result).toEqual(expected);
      expect(mockTagsService.findAll).toHaveBeenCalledWith(query);
    });
  });

  describe('findByCourse (GET /tags/course/:courseId)', () => {
    it('delegates to TagsService.findByCourse with courseId', async () => {
      const expected = [{ id: 'tag-1', label: 'Web Design' }];
      mockTagsService.findByCourse.mockResolvedValue(expected);

      const result = await controller.findByCourse('course-1');

      expect(result).toEqual(expected);
      expect(mockTagsService.findByCourse).toHaveBeenCalledWith('course-1');
    });
  });

  describe('findOne (GET /tags/:id)', () => {
    it('delegates to TagsService.findOne with tag id', async () => {
      const expected = { id: 'tag-1', label: 'Web Design', courses: [] };
      mockTagsService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('tag-1');

      expect(result).toEqual(expected);
      expect(mockTagsService.findOne).toHaveBeenCalledWith('tag-1');
    });

    it('propagates NotFoundException when tag id is missing', async () => {
      mockTagsService.findOne.mockRejectedValue(
        new NotFoundException('Tag not found'),
      );

      await expect(controller.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update (PATCH /tags/:id)', () => {
    it('delegates to TagsService.update with id, adminId, and dto', async () => {
      const dto: UpdateTagDto = { label: 'UI & UX Design' } as any;
      const expected = { id: 'tag-1', label: 'UI & UX Design', slug: 'ui-ux-design' };
      mockTagsService.update.mockResolvedValue(expected);

      const result = await controller.update('tag-1', 'admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockTagsService.update).toHaveBeenCalledWith('tag-1', 'admin-1', dto);
    });
  });

  describe('remove (DELETE /tags/:id)', () => {
    it('delegates to TagsService.remove with id and adminId', async () => {
      const expected = { deleted: true, id: 'tag-1' };
      mockTagsService.remove.mockResolvedValue(expected);

      const result = await controller.remove('tag-1', 'admin-1');

      expect(result).toEqual(expected);
      expect(mockTagsService.remove).toHaveBeenCalledWith('tag-1', 'admin-1');
    });
  });

  describe('merge (POST /tags/:id/merge)', () => {
    it('delegates to TagsService.merge with targetTagId, adminId, and dto', async () => {
      const dto: MergeTagsDto = { sourceTagIds: ['tag-2', 'tag-3'] } as any;
      const expected = { id: 'tag-1', mergedCount: 2 };
      mockTagsService.merge.mockResolvedValue(expected);

      const result = await controller.merge('tag-1', 'admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockTagsService.merge).toHaveBeenCalledWith('tag-1', 'admin-1', dto);
    });

    it('propagates BadRequestException when targetTagId is in sourceTagIds', async () => {
      mockTagsService.merge.mockRejectedValue(
        new BadRequestException('Cannot merge a tag into itself'),
      );

      await expect(
        controller.merge('tag-1', 'admin-1', { sourceTagIds: ['tag-1'] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('attachToCourse & detachFromCourse', () => {
    it('attachToCourse delegates to TagsService.attachToCourse', async () => {
      const dto: AttachTagDto = { courseId: 'course-1' } as any;
      const expected = { tagId: 'tag-1', courseId: 'course-1' };
      mockTagsService.attachToCourse.mockResolvedValue(expected);

      const result = await controller.attachToCourse('tag-1', 'admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockTagsService.attachToCourse).toHaveBeenCalledWith(
        'tag-1',
        'admin-1',
        dto,
      );
    });

    it('detachFromCourse delegates to TagsService.detachFromCourse', async () => {
      const expected = { detached: true };
      mockTagsService.detachFromCourse.mockResolvedValue(expected);

      const result = await controller.detachFromCourse(
        'tag-1',
        'course-1',
        'admin-1',
      );

      expect(result).toEqual(expected);
      expect(mockTagsService.detachFromCourse).toHaveBeenCalledWith(
        'tag-1',
        'course-1',
        'admin-1',
      );
    });
  });

  describe('guard metadata, role enforcement, and DTO validation', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, TagsController);
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    });

    it('restricts write endpoints to ADMIN and allows all roles on read endpoints', () => {
      expect(
        Reflect.getMetadata(ROLES_KEY, TagsController.prototype.create),
      ).toEqual([UserRole.ADMIN]);
      expect(
        Reflect.getMetadata(ROLES_KEY, TagsController.prototype.remove),
      ).toEqual([UserRole.ADMIN]);
      expect(
        Reflect.getMetadata(ROLES_KEY, TagsController.prototype.findAll),
      ).toEqual([UserRole.ADMIN, UserRole.INSTRUCTOR, UserRole.STUDENT]);

      const reflector = new Reflector();
      const rolesGuard = new RolesGuard(reflector);
      const createCtx = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => TagsController.prototype.create,
          getClass: () => TagsController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(createCtx(UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(createCtx(UserRole.INSTRUCTOR))).toBe(false);
      expect(rolesGuard.canActivate(createCtx(UserRole.ADMIN))).toBe(true);
    });

    it('rejects invalid CreateTagDto labels (too short or disallowed symbols)', async () => {
      const tooShort = plainToInstance(CreateTagDto, { label: 'A' });
      expect((await validate(tooShort)).length).toBeGreaterThan(0);

      const badChars = plainToInstance(CreateTagDto, {
        label: 'Invalid<script>',
      });
      expect((await validate(badChars)).length).toBeGreaterThan(0);
    });
  });
});
