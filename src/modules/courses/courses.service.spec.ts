import { Test, TestingModule } from '@nestjs/testing';
import { CoursesService } from './courses.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FeeCalculatorService } from '../billing/fee-calculator.service';
import { SearchService } from '../search/search.service';
import { CacheService } from '../../common/cache/cache.service';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CourseStatus } from '@prisma/client';

const mockPrisma = {
  course: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    count:      jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    updateMany: jest.fn(),
    groupBy:    jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockNotifications = {
  notifyUser: jest.fn().mockResolvedValue({}),
};

const mockSearchService = {
  indexCourse: jest.fn().mockResolvedValue(undefined),
  removeCourse: jest.fn().mockResolvedValue(undefined),
  bulkIndexCourses: jest.fn().mockResolvedValue(undefined),
  getIndexFreshness: jest.fn().mockResolvedValue(0),
  search: jest.fn().mockResolvedValue({
    hits: [], estimatedTotalHits: 0, page: 1, limit: 20, totalPages: 0, query: '', processingTimeMs: 0,
  }),
};

const mockCacheService = {
  invalidateNamespace: jest.fn().mockResolvedValue(undefined),
};

const MOCK_COURSE = {
  id:                'COURSE-TAILORING-001',
  instructorAddress: 'GABC',
  title:             'Professional Tailoring',
  category:          'Tailoring',
  level:             'Beginner',
  price:             50,
  platformFeePercent:20,
  status:            CourseStatus.ACTIVE,
  totalEnrollments:  0,
  totalRevenue:      0,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

describe('CoursesService', () => {
  let service: CoursesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoursesService,
        { provide: PrismaService,       useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: SearchService, useValue: mockSearchService },
        { provide: CacheService, useValue: mockCacheService },
        FeeCalculatorService,
      ],
    }).compile();

    service = module.get<CoursesService>(CoursesService);
    jest.clearAllMocks();
  });

  // ----------------------------------------------------------
  // CREATE
  // ----------------------------------------------------------

  describe('create()', () => {
    const dto = {
      courseId:    'COURSE-TAILORING-001',
      title:       'Professional Tailoring',
      category:    'Tailoring',
      price:       50,
      description: 'Learn tailoring from scratch',
    };

    it('creates a course draft successfully', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);
      mockPrisma.course.create.mockResolvedValue({
        ...MOCK_COURSE,
        status: CourseStatus.DRAFT,
      });

      const result = await service.create('instructor-id', 'GABC', dto as any);
      expect(result.status).toBe(CourseStatus.DRAFT);
      expect(mockPrisma.course.create).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException if course ID already exists', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(MOCK_COURSE);
      await expect(service.create('instructor-id', 'GABC', dto as any))
        .rejects.toThrow(ConflictException);
    });
  });

  // ----------------------------------------------------------
  // APPROVE
  // ----------------------------------------------------------

  describe('approve()', () => {
    it('approves a pending course and notifies instructor', async () => {
      const pendingCourse = {
        ...MOCK_COURSE,
        status: CourseStatus.PENDING,
        modules: [],
        _count: { enrollments: 0 },
        instructor: { name: 'John', stellarAddress: 'GABC', avatarUrl: null, bio: null },
      };
      mockPrisma.course.findUnique.mockResolvedValue(pendingCourse);
      mockPrisma.course.update.mockResolvedValue({ ...pendingCourse, status: CourseStatus.ACTIVE });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'instructor@test.com' });

      const result = await service.approve('COURSE-TAILORING-001', 'admin-id');
      expect(result.status).toBe(CourseStatus.ACTIVE);
      expect(mockNotifications.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException if course is not pending', async () => {
      const activeCourse = {
        ...MOCK_COURSE,
        status: CourseStatus.ACTIVE,
        modules: [],
        _count: { enrollments: 0 },
        instructor: { name: 'John', stellarAddress: 'GABC', avatarUrl: null, bio: null },
      };
      mockPrisma.course.findUnique.mockResolvedValue(activeCourse);
      await expect(service.approve('COURSE-TAILORING-001', 'admin-id'))
        .rejects.toThrow(ForbiddenException);
    });
  });

  // ----------------------------------------------------------
  // REJECT
  // ----------------------------------------------------------

  describe('reject()', () => {
    it('rejects a pending course and reverts to DRAFT', async () => {
      const pendingCourse = {
        ...MOCK_COURSE,
        status: CourseStatus.PENDING,
        modules: [],
        _count: { enrollments: 0 },
        instructor: { name: 'John', stellarAddress: 'GABC', avatarUrl: null, bio: null },
      };
      mockPrisma.course.findUnique.mockResolvedValue(pendingCourse);
      mockPrisma.course.update.mockResolvedValue({ ...pendingCourse, status: CourseStatus.DRAFT });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'inst@test.com' });

      const result = await service.reject('COURSE-TAILORING-001', 'admin-id', 'Missing intro video');
      expect(result.status).toBe(CourseStatus.DRAFT);
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'COURSE_REJECTED',
        expect.any(String),
        expect.stringContaining('Missing intro video'),
        expect.any(Object),
      );
    });
  });

  // ----------------------------------------------------------
  // FIND ONE
  // ----------------------------------------------------------

  describe('findOne()', () => {
    it('returns course when found', async () => {
      mockPrisma.course.findUnique.mockResolvedValue({
        ...MOCK_COURSE,
        modules: [],
        _count: { enrollments: 5 },
        instructor: { name: 'John', stellarAddress: 'GABC', avatarUrl: null, bio: null },
      });

      const result = await service.findOne('COURSE-TAILORING-001');
      expect(result.id).toBe('COURSE-TAILORING-001');
      expect(result._count.enrollments).toBe(5);
    });

    it('throws NotFoundException when course not found', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);
      await expect(service.findOne('MISSING')).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------
  // FIND ALL
  // ----------------------------------------------------------

  describe('findAll()', () => {
    it('returns paginated active courses', async () => {
      const mockCourses = [MOCK_COURSE];
      mockPrisma.$transaction.mockResolvedValue([mockCourses, 1]);

      const result = await service.findAll({ status: CourseStatus.ACTIVE });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('applies category filter', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
      await service.findAll({ category: 'Baking', status: CourseStatus.ACTIVE });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ----------------------------------------------------------
  // SET PREREQUISITES (cycle detection)
  // ----------------------------------------------------------

  describe('setPrerequisites()', () => {
    it('rejects a direct cycle (A requires B requires A)', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(MOCK_COURSE);
      mockPrisma.course.findMany.mockResolvedValue([
        { id: 'A', prerequisites: [{ prerequisiteId: 'B' }] },
        { id: 'B', prerequisites: [{ prerequisiteId: 'A' }] },
      ]);

      await expect(service.setPrerequisites('A', ['B'] as any))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects an indirect cycle (A->B->C->A)', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(MOCK_COURSE);
      mockPrisma.course.findMany.mockResolvedValue([
        { id: 'A', prerequisites: [{ prerequisiteId: 'B' }] },
        { id: 'B', prerequisites: [{ prerequisiteId: 'C' }] },
        { id: 'C', prerequisites: [{ prerequisiteId: 'A' }] },
      ]);

      await expect(service.setPrerequisites('A', ['B'] as any))
        .rejects.toThrow(BadRequestException);
    });
  });
});
