import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { LearningPathStatus } from '@prisma/client';
import { LearningPathsService } from './learning-paths.service';
import { PrismaService } from '../../common/prisma/prisma.service';

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

  const mockPathWithCourses = {
    id: 'path-1',
    title: 'Soroban Zero to Hero',
    slug: 'soroban-zero-to-hero',
    description: 'Complete developer track',
    thumbnailUrl: null,
    status: LearningPathStatus.DRAFT,
    createdById: 'admin-1',
    courses: [
      {
        courseId: 'c1',
        position: 0,
        course: {
          id: 'c1',
          title: 'Course 1',
          category: 'DeFi',
          level: 'BEGINNER',
          thumbnailUrl: null,
          status: 'ACTIVE',
          totalLessons: 5,
          price: 0,
        },
      },
      {
        courseId: 'c2',
        position: 1,
        course: {
          id: 'c2',
          title: 'Course 2',
          category: 'DeFi',
          level: 'INTERMEDIATE',
          thumbnailUrl: null,
          status: 'ACTIVE',
          totalLessons: 8,
          price: 25,
        },
      },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearningPathsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LearningPathsService>(LearningPathsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create()', () => {
    it('creates a learning path with ordered active courses when slug is unique', async () => {
      mockPrisma.learningPath.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockPathWithCourses);
      mockPrisma.course.findMany.mockResolvedValue([
        { id: 'c1', title: 'Course 1', status: 'ACTIVE' },
        { id: 'c2', title: 'Course 2', status: 'ACTIVE' },
      ]);
      mockPrisma.coursePrerequisite.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          learningPath: {
            create: jest.fn().mockResolvedValue({ id: 'path-1', title: 'Soroban Zero to Hero' }),
          },
          learningPathCourse: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
        }),
      );

      const res = await service.create('admin-1', {
        title: 'Soroban Zero to Hero',
        description: 'Complete developer track',
        courseIds: ['c1', 'c2'],
      } as any);

      expect(res.id).toBe('path-1');
      expect(res.courses).toHaveLength(2);
    });

    it('throws ConflictException when slug already exists', async () => {
      mockPrisma.learningPath.findUnique.mockResolvedValue(mockPathWithCourses);

      await expect(
        service.create('admin-1', { title: 'Soroban Zero to Hero' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when a non-ACTIVE course is included', async () => {
      mockPrisma.learningPath.findUnique.mockResolvedValue(null);
      mockPrisma.course.findMany.mockResolvedValue([
        { id: 'c1', title: 'Draft Course', status: 'DRAFT' },
      ]);

      await expect(
        service.create('admin-1', { title: 'New Path', courseIds: ['c1'] } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when prerequisite ordering is violated inside the path', async () => {
      mockPrisma.learningPath.findUnique.mockResolvedValue(null);
      mockPrisma.course.findMany.mockResolvedValue([
        { id: 'c1', title: 'Course 1', status: 'ACTIVE' },
        { id: 'c2', title: 'Course 2', status: 'ACTIVE' },
      ]);
      mockPrisma.coursePrerequisite.findMany.mockResolvedValue([
        { courseId: 'c1', prerequisiteId: 'c2' },
      ]);

      await expect(
        service.create('admin-1', { title: 'New Path', courseIds: ['c1', 'c2'] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll() & findOne()', () => {
    it('restricts non-admin listings to PUBLISHED paths', async () => {
      mockPrisma.learningPath.findMany.mockResolvedValue([]);
      mockPrisma.learningPath.count.mockResolvedValue(0);

      const res = await service.findAll({ page: 1, limit: 10 }, false);

      expect(res.meta.total).toBe(0);
      expect(mockPrisma.learningPath.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: LearningPathStatus.PUBLISHED }),
        }),
      );
    });

    it('throws NotFoundException when findOne() targets an unknown id', async () => {
      mockPrisma.learningPath.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('publish(), unpublish(), replaceCourses(), and getPathProgress()', () => {
    it('publishes a valid draft path with at least 2 courses', async () => {
      mockPrisma.learningPath.findUnique.mockResolvedValue(mockPathWithCourses);
      mockPrisma.course.findMany.mockResolvedValue([
        { id: 'c1', title: 'Course 1', status: 'ACTIVE' },
        { id: 'c2', title: 'Course 2', status: 'ACTIVE' },
      ]);
      mockPrisma.coursePrerequisite.findMany.mockResolvedValue([]);
      mockPrisma.learningPath.update.mockResolvedValue({
        ...mockPathWithCourses,
        status: LearningPathStatus.PUBLISHED,
      });

      const res = await service.publish('path-1');
      expect(res.status).toBe(LearningPathStatus.PUBLISHED);
    });

    it('rejects replaceCourses on ARCHIVED paths', async () => {
      mockPrisma.learningPath.findUnique.mockResolvedValue({
        ...mockPathWithCourses,
        status: LearningPathStatus.ARCHIVED,
      });

      await expect(service.replaceCourses('path-1', ['c1', 'c2'])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('computes student path progress and nextAvailableCourseId accurately', async () => {
      mockPrisma.learningPath.findUnique.mockResolvedValue({
        ...mockPathWithCourses,
        status: LearningPathStatus.PUBLISHED,
      });
      mockPrisma.enrollment.findMany.mockResolvedValue([
        {
          courseId: 'c1',
          status: 'COMPLETED',
          progressPercent: 100,
          enrolledAt: new Date(),
          completedAt: new Date(),
        },
      ]);
      mockPrisma.coursePrerequisite.findMany.mockResolvedValue([
        { courseId: 'c2', prerequisiteId: 'c1' },
      ]);

      const progress = await service.getPathProgress('path-1', 'student-1');

      expect(progress.summary.totalCourses).toBe(2);
      expect(progress.summary.completedCount).toBe(1);
      expect(progress.summary.percentComplete).toBe(50);
      expect(progress.summary.nextAvailableCourseId).toBe('c2');
    });
  });
});
