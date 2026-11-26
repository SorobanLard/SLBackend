import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { LearningPathStatus } from '@prisma/client';
import { LearningPathsService } from './learning-paths.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('LearningPathsService', () => {
  let service: LearningPathsService;
  let prisma: {
    learningPath: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    course: { findMany: jest.Mock };
    coursePrerequisite: { findMany: jest.Mock };
    learningPathCourse: { createMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const adminId = 'admin-1';

  beforeEach(async () => {
    prisma = {
      learningPath: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      course: { findMany: jest.fn() },
      coursePrerequisite: { findMany: jest.fn() },
      learningPathCourse: { createMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearningPathsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LearningPathsService>(LearningPathsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('creates a path and returns the hydrated record (happy path)', async () => {
      prisma.learningPath.findUnique
        .mockResolvedValueOnce(null) // slug conflict check
        .mockResolvedValueOnce({ id: 'p1', title: 'My Path', courses: [] }); // findOne

      const created = { id: 'p1', title: 'My Path', slug: 'my-path' };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
      prisma.learningPath.create.mockResolvedValue(created);

      const result = await service.create(adminId, {
        title: 'My Path',
        description: 'desc',
      } as any);

      expect(prisma.learningPath.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'my-path', createdById: adminId }),
        }),
      );
      expect(result).toEqual({ id: 'p1', title: 'My Path', courses: [] });
    });

    it('throws ConflictException when slug already exists', async () => {
      prisma.learningPath.findUnique.mockResolvedValueOnce({
        id: 'existing',
        title: 'My Path',
      });

      await expect(
        service.create(adminId, { title: 'My Path' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects non-ACTIVE courses via validateOrderedCourses', async () => {
      prisma.learningPath.findUnique.mockResolvedValueOnce(null);
      prisma.course.findMany.mockResolvedValue([
        { id: 'c1', title: 'Draft', status: 'DRAFT' },
      ]);

      await expect(
        service.create(adminId, { title: 'My Path', courseIds: ['c1'] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown course IDs', async () => {
      prisma.learningPath.findUnique.mockResolvedValueOnce(null);
      prisma.course.findMany.mockResolvedValue([]);

      await expect(
        service.create(adminId, { title: 'My Path', courseIds: ['missing'] } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects prerequisite order violations inside the path', async () => {
      prisma.learningPath.findUnique.mockResolvedValueOnce(null);
      prisma.course.findMany.mockResolvedValue([
        { id: 'c1', title: 'A', status: 'ACTIVE' },
        { id: 'c2', title: 'B', status: 'ACTIVE' },
      ]);
      // c1 requires c2, but c2 comes after c1 in the path
      prisma.coursePrerequisite.findMany.mockResolvedValue([
        { courseId: 'c1', prerequisiteId: 'c2' },
      ]);

      await expect(
        service.create(adminId, {
          title: 'My Path',
          courseIds: ['c1', 'c2'],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('restricts students to PUBLISHED paths', async () => {
      prisma.learningPath.findMany.mockResolvedValue([]);
      prisma.learningPath.count.mockResolvedValue(0);

      const result = await service.findAll({}, false);

      expect(prisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: LearningPathStatus.PUBLISHED }),
        }),
      );
      expect(result.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    it('lets admins filter by status and clamps limit', async () => {
      prisma.learningPath.findMany.mockResolvedValue([]);
      prisma.learningPath.count.mockResolvedValue(0);

      await service.findAll(
        { limit: 999, status: LearningPathStatus.DRAFT },
        true,
      );

      expect(prisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
          where: expect.objectContaining({ status: LearningPathStatus.DRAFT }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when path is missing', async () => {
      prisma.learningPath.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws ConflictException when renaming to an existing slug', async () => {
      prisma.learningPath.findUnique
        .mockResolvedValueOnce({ id: 'p1', title: 'Old', slug: 'old', courses: [] })
        .mockResolvedValueOnce({ id: 'p2', title: 'New' });

      await expect(
        service.update('p1', { title: 'New' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('replaceCourses', () => {
    it('rejects modifying an ARCHIVED path', async () => {
      prisma.learningPath.findUnique.mockResolvedValue({
        id: 'p1',
        status: LearningPathStatus.ARCHIVED,
        courses: [],
      });

      await expect(
        service.replaceCourses('p1', ['c1', 'c2']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires at least 2 courses for a PUBLISHED path', async () => {
      prisma.learningPath.findUnique.mockResolvedValue({
        id: 'p1',
        status: LearningPathStatus.PUBLISHED,
        courses: [],
      });

      await expect(
        service.replaceCourses('p1', ['c1']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
