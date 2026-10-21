import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LearningPathStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePathDto } from './dto/create-path.dto';
import { UpdatePathDto } from './dto/update-path.dto';
import { LearningPathsService } from './learning-paths.service';

describe('LearningPathsService', () => {
  let service: LearningPathsService;

  const mockPrisma = {
    learningPath: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    learningPathCourse: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    course: {
      findMany: jest.fn(),
    },
    coursePrerequisite: {
      findMany: jest.fn(),
    },
    enrollment: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const tx = {
    learningPath: { create: jest.fn() },
    learningPathCourse: { createMany: jest.fn(), deleteMany: jest.fn() },
  };

  const course = (id: string, over: Record<string, any> = {}) => ({
    id,
    title: `Course ${id}`,
    category: 'Tailoring',
    level: 'Beginner',
    thumbnailUrl: null,
    status: 'ACTIVE',
    totalLessons: 10,
    price: 0,
    ...over,
  });

  const pathCourse = (id: string, position: number, over: Record<string, any> = {}) => ({
    courseId: id,
    position,
    course: course(id, over),
  });

  const path = (over: Record<string, any> = {}) => ({
    id: 'path-1',
    title: 'Fashion Design Track',
    slug: 'fashion-design-track',
    description: 'Learn tailoring from scratch',
    thumbnailUrl: null,
    status: LearningPathStatus.DRAFT,
    createdById: 'admin-1',
    publishedAt: null,
    courses: [],
    ...over,
  });

  let paths: any[];
  let courses: any[];
  let prerequisites: any[];
  let enrollments: any[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearningPathsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LearningPathsService>(LearningPathsService);

    jest.clearAllMocks();

    paths = [path({ slug: 'existing-path' })];
    courses = [course('c1'), course('c2'), course('c3')];
    prerequisites = [];
    enrollments = [];

    mockPrisma.learningPath.findUnique.mockImplementation(async (args: any) => {
      if (args?.where?.slug) {
        return paths.find((p) => p.slug === args.where.slug) ?? null;
      }
      return paths.find((p) => p.id === args?.where?.id) ?? null;
    });
    mockPrisma.learningPath.findMany.mockImplementation(async () => paths);
    mockPrisma.learningPath.count.mockImplementation(async () => paths.length);
    mockPrisma.learningPath.update.mockImplementation(async (args: any) => ({
      ...paths.find((p) => p.id === args.where.id),
      ...args.data,
    }));
    mockPrisma.learningPath.delete.mockImplementation(async (args: any) => {
      const found = paths.find((p) => p.id === args.where.id);
      paths = paths.filter((p) => p.id !== args.where.id);
      return found;
    });
    mockPrisma.course.findMany.mockImplementation(async (args: any) => {
      const ids = args?.where?.id?.in ?? [];
      return courses.filter((c) => ids.includes(c.id)).map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
      }));
    });
    mockPrisma.coursePrerequisite.findMany.mockImplementation(async (args: any) => {
      const courseIds = args?.where?.courseId?.in;
      const prerequisiteIds = args?.where?.prerequisiteId?.in;
      return prerequisites.filter(
        (p) =>
          (!courseIds || courseIds.includes(p.courseId)) &&
          (!prerequisiteIds || prerequisiteIds.includes(p.prerequisiteId)),
      );
    });
    mockPrisma.enrollment.findMany.mockImplementation(async (args: any) => {
      const ids = args?.where?.courseId?.in ?? [];
      return enrollments.filter((e) => ids.includes(e.courseId));
    });
    mockPrisma.learningPathCourse.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.learningPathCourse.deleteMany.mockResolvedValue({ count: 0 });
    tx.learningPath.create.mockImplementation(async (args: any) => ({
      ...path(),
      ...args.data,
    }));
    tx.learningPathCourse.createMany.mockResolvedValue({ count: 0 });
    tx.learningPathCourse.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
  });

  describe('create()', () => {
    const dto = (over: Partial<CreatePathDto> = {}) =>
      Object.assign(new CreatePathDto(), {
        title: 'Fashion Design Track',
        description: 'Learn tailoring from scratch',
        ...over,
      });

    it('creates a path with a normalised slug and returns it', async () => {
      const result = await service.create('admin-1', dto({ title: 'Fashion & Design Track' }));

      expect(tx.learningPath.create).toHaveBeenCalledWith({
        data: {
          title: 'Fashion & Design Track',
          slug: 'fashion-design-track',
          description: 'Learn tailoring from scratch',
          thumbnailUrl: undefined,
          createdById: 'admin-1',
        },
      });
      expect(result.id).toBe('path-1');
    });

    it('rejects a title that collides with an existing path', async () => {
      paths = [path({ slug: 'fashion-design-track' })];

      await expect(service.create('admin-1', dto())).rejects.toThrow(ConflictException);
      expect(tx.learningPath.create).not.toHaveBeenCalled();
    });

    it('attaches the initial courses with their positions', async () => {
      await service.create('admin-1', dto({ courseIds: ['c1', 'c2'] }));

      expect(tx.learningPathCourse.createMany).toHaveBeenCalledWith({
        data: [
          { pathId: 'path-1', courseId: 'c1', position: 0 },
          { pathId: 'path-1', courseId: 'c2', position: 1 },
        ],
      });
    });

    it('keeps only the first occurrence of a duplicated course', async () => {
      await service.create('admin-1', dto({ courseIds: ['c1', 'c1', 'c2'] }));

      expect(tx.learningPathCourse.createMany).toHaveBeenCalledWith({
        data: [
          { pathId: 'path-1', courseId: 'c1', position: 0 },
          { pathId: 'path-1', courseId: 'c2', position: 1 },
        ],
      });
    });

    it('rejects an unknown course id', async () => {
      await expect(
        service.create('admin-1', dto({ courseIds: ['c1', 'missing'] })),
      ).rejects.toThrow(NotFoundException);
      expect(tx.learningPath.create).not.toHaveBeenCalled();
    });

    it('rejects a course that is not active', async () => {
      courses = [course('c1'), course('c2', { status: 'DRAFT', title: 'Draft course' })];

      await expect(
        service.create('admin-1', dto({ courseIds: ['c1', 'c2'] })),
      ).rejects.toThrow(BadRequestException);
      expect(tx.learningPath.create).not.toHaveBeenCalled();
    });

    it('rejects a curriculum whose prerequisites are out of order', async () => {
      prerequisites = [{ courseId: 'c2', prerequisiteId: 'c1' }];

      await expect(
        service.create('admin-1', dto({ courseIds: ['c2', 'c1'] })),
      ).rejects.toThrow(BadRequestException);
      expect(tx.learningPath.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll()', () => {
    it('limits students to published paths', async () => {
      await service.findAll({}, false);

      expect(mockPrisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: LearningPathStatus.PUBLISHED },
        }),
      );
    });

    it('returns every status to admins', async () => {
      await service.findAll({}, true);

      expect(mockPrisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters by status for admins', async () => {
      await service.findAll({ status: LearningPathStatus.ARCHIVED }, true);

      expect(mockPrisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: LearningPathStatus.ARCHIVED },
        }),
      );
    });

    it('searches by title case-insensitively', async () => {
      await service.findAll({ search: 'fashion' }, true);

      expect(mockPrisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { title: { contains: 'fashion', mode: 'insensitive' } },
        }),
      );
    });

    it('clamps the page size and reports the pagination meta', async () => {
      const result = await service.findAll({ page: 2, limit: 500 }, true);

      expect(mockPrisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 50, take: 50 }),
      );
      expect(result.meta).toEqual({ total: 1, page: 2, limit: 50, totalPages: 1 });
    });

    it('never allows a page size below one', async () => {
      await service.findAll({ limit: 0 }, true);

      expect(mockPrisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });

  describe('findOne()', () => {
    it('returns the path with its ordered courses', async () => {
      paths = [path({ courses: [pathCourse('c1', 0), pathCourse('c2', 1)] })];

      const result = await service.findOne('path-1');

      expect(result.courses).toHaveLength(2);
      expect(result.courses[0].courseId).toBe('c1');
    });

    it('rejects an unknown path', async () => {
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update()', () => {
    const dto = (over: Partial<UpdatePathDto> = {}) =>
      Object.assign(new UpdatePathDto(), over);

    it('updates the title and re-slugs the path', async () => {
      const result = await service.update('path-1', dto({ title: 'Tailoring Mastery' }));

      expect(mockPrisma.learningPath.update).toHaveBeenCalledWith({
        where: { id: 'path-1' },
        data: { title: 'Tailoring Mastery', slug: 'tailoring-mastery' },
      });
      expect(result.slug).toBe('tailoring-mastery');
    });

    it('keeps the slug when the title is unchanged', async () => {
      paths = [path({ slug: 'fashion-design-track' })];

      await service.update('path-1', dto({ title: 'Fashion Design Track' }));

      expect(mockPrisma.learningPath.update).toHaveBeenCalledWith({
        where: { id: 'path-1' },
        data: { title: 'Fashion Design Track', slug: 'fashion-design-track' },
      });
    });

    it('leaves the description untouched when it is not supplied', async () => {
      await service.update('path-1', dto({ thumbnailUrl: 'https://cdn.test/a.png' }));

      expect(mockPrisma.learningPath.update).toHaveBeenCalledWith({
        where: { id: 'path-1' },
        data: { thumbnailUrl: 'https://cdn.test/a.png' },
      });
    });

    it('clears the description when an empty value is supplied', async () => {
      await service.update('path-1', dto({ description: '' }));

      expect(mockPrisma.learningPath.update).toHaveBeenCalledWith({
        where: { id: 'path-1' },
        data: { description: '' },
      });
    });

    it('rejects a title that collides with another path', async () => {
      paths = [
        path({ id: 'path-1', slug: 'fashion-design-track' }),
        path({ id: 'path-2', slug: 'tailoring-mastery' }),
      ];

      await expect(
        service.update('path-1', dto({ title: 'Tailoring Mastery' })),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.learningPath.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown path', async () => {
      await expect(service.update('missing', dto({ title: 'Tailoring' }))).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('replaceCourses()', () => {
    it('replaces the curriculum of a draft path', async () => {
      paths = [path({ courses: [pathCourse('c1', 0)] })];

      const result = await service.replaceCourses('path-1', ['c1', 'c2']);

      expect(tx.learningPathCourse.deleteMany).toHaveBeenCalledWith({
        where: { pathId: 'path-1' },
      });
      expect(tx.learningPathCourse.createMany).toHaveBeenCalledWith({
        data: [
          { pathId: 'path-1', courseId: 'c1', position: 0 },
          { pathId: 'path-1', courseId: 'c2', position: 1 },
        ],
      });
      expect(result.id).toBe('path-1');
    });

    it('refuses to modify an archived path', async () => {
      paths = [path({ status: LearningPathStatus.ARCHIVED })];

      await expect(service.replaceCourses('path-1', ['c1', 'c2'])).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.learningPathCourse.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses to drop a published path below two courses', async () => {
      paths = [path({ status: LearningPathStatus.PUBLISHED })];

      await expect(service.replaceCourses('path-1', ['c1'])).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.learningPathCourse.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects an unknown course id', async () => {
      await expect(service.replaceCourses('path-1', ['c1', 'missing'])).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('publish()', () => {
    it('publishes a path that has at least two courses', async () => {
      paths = [path({ courses: [pathCourse('c1', 0), pathCourse('c2', 1)] })];

      const result = await service.publish('path-1');

      expect(mockPrisma.learningPath.update).toHaveBeenCalledWith({
        where: { id: 'path-1' },
        data: { status: LearningPathStatus.PUBLISHED, publishedAt: expect.any(Date) },
      });
      expect(result.status).toBe(LearningPathStatus.PUBLISHED);
    });

    it('rejects a path that is already published', async () => {
      paths = [
        path({
          status: LearningPathStatus.PUBLISHED,
          courses: [pathCourse('c1', 0), pathCourse('c2', 1)],
        }),
      ];

      await expect(service.publish('path-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.learningPath.update).not.toHaveBeenCalled();
    });

    it('rejects a path with fewer than two courses', async () => {
      paths = [path({ courses: [pathCourse('c1', 0)] })];

      await expect(service.publish('path-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.learningPath.update).not.toHaveBeenCalled();
    });

    it('re-validates the prerequisite order before publishing', async () => {
      paths = [path({ courses: [pathCourse('c2', 0), pathCourse('c1', 1)] })];
      prerequisites = [{ courseId: 'c2', prerequisiteId: 'c1' }];

      await expect(service.publish('path-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.learningPath.update).not.toHaveBeenCalled();
    });
  });

  describe('unpublish()', () => {
    it('moves a published path back to draft', async () => {
      paths = [path({ status: LearningPathStatus.PUBLISHED })];

      const result = await service.unpublish('path-1');

      expect(mockPrisma.learningPath.update).toHaveBeenCalledWith({
        where: { id: 'path-1' },
        data: { status: LearningPathStatus.DRAFT, publishedAt: null },
      });
      expect(result.status).toBe(LearningPathStatus.DRAFT);
    });

    it('rejects a path that is not published', async () => {
      await expect(service.unpublish('path-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.learningPath.update).not.toHaveBeenCalled();
    });
  });

  describe('remove()', () => {
    it('deletes the path and confirms the removal', async () => {
      const result = await service.remove('path-1');

      expect(mockPrisma.learningPath.delete).toHaveBeenCalledWith({
        where: { id: 'path-1' },
      });
      expect(result).toEqual({
        message: 'Learning path "Fashion Design Track" deleted successfully',
      });
    });

    it('rejects an unknown path', async () => {
      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPathProgress()', () => {
    it('reports the per-course progress of a student', async () => {
      paths = [
        path({
          status: LearningPathStatus.PUBLISHED,
          courses: [
            pathCourse('c1', 0),
            pathCourse('c2', 1),
            pathCourse('c3', 2),
          ],
        }),
      ];
      enrollments = [
        {
          courseId: 'c1',
          status: 'COMPLETED',
          progressPercent: 100,
          enrolledAt: new Date('2026-01-01'),
          completedAt: new Date('2026-01-05'),
        },
        {
          courseId: 'c2',
          status: 'IN_PROGRESS',
          progressPercent: 40,
          enrolledAt: new Date('2026-01-06'),
          completedAt: null,
        },
      ];
      prerequisites = [{ courseId: 'c3', prerequisiteId: 'c2' }];

      const result = await service.getPathProgress('path-1', 'student-1');

      expect(result.path).toEqual(
        expect.objectContaining({ id: 'path-1', status: LearningPathStatus.PUBLISHED }),
      );
      expect(result.summary).toEqual({
        totalCourses: 3,
        completedCount: 1,
        percentComplete: 33,
        enrolledCount: 2,
        nextAvailableCourseId: 'c2',
      });
      expect(result.courses[0]).toEqual(
        expect.objectContaining({
          courseId: 'c1',
          enrolled: true,
          completed: true,
          progressPercent: 100,
          missingPrerequisiteIds: [],
        }),
      );
      expect(result.courses[2]).toEqual(
        expect.objectContaining({
          courseId: 'c3',
          enrolled: false,
          completed: false,
          progressPercent: 0,
          missingPrerequisiteIds: ['c2'],
        }),
      );
    });

    it('exposes the first course as the next available one for a fresh student', async () => {
      paths = [
        path({
          status: LearningPathStatus.PUBLISHED,
          courses: [pathCourse('c1', 0), pathCourse('c2', 1)],
        }),
      ];

      const result = await service.getPathProgress('path-1', 'student-1');

      expect(result.summary.nextAvailableCourseId).toBe('c1');
      expect(result.summary.percentComplete).toBe(0);
    });

    it('reports no next course once every course is completed', async () => {
      paths = [
        path({
          status: LearningPathStatus.PUBLISHED,
          courses: [pathCourse('c1', 0), pathCourse('c2', 1)],
        }),
      ];
      enrollments = [
        {
          courseId: 'c1',
          status: 'COMPLETED',
          progressPercent: 100,
          enrolledAt: new Date('2026-01-01'),
          completedAt: new Date('2026-01-05'),
        },
        {
          courseId: 'c2',
          status: 'COMPLETED',
          progressPercent: 100,
          enrolledAt: new Date('2026-01-02'),
          completedAt: new Date('2026-01-08'),
        },
      ];

      const result = await service.getPathProgress('path-1', 'student-1');

      expect(result.summary.completedCount).toBe(2);
      expect(result.summary.percentComplete).toBe(100);
      expect(result.summary.nextAvailableCourseId).toBeNull();
    });

    it('hides a draft path from other students', async () => {
      paths = [path({ status: LearningPathStatus.DRAFT })];

      await expect(service.getPathProgress('path-1', 'student-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets the creator see their own draft path', async () => {
      paths = [
        path({
          status: LearningPathStatus.DRAFT,
          createdById: 'admin-1',
          courses: [pathCourse('c1', 0)],
        }),
      ];

      const result = await service.getPathProgress('path-1', 'admin-1');

      expect(result.summary.totalCourses).toBe(1);
    });

    it('rejects a path that has no courses yet', async () => {
      paths = [path({ status: LearningPathStatus.PUBLISHED, courses: [] })];

      await expect(service.getPathProgress('path-1', 'student-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
