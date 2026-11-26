import { Test, TestingModule } from '@nestjs/testing';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';

describe('ReviewsService', () => {
  let service: ReviewsService;
  let prisma: any;
  let enrollmentsService: any;

  const mockPrisma = {
    course: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    courseReview: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockEnrollmentsService = {
    isEnrolled: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EnrollmentsService, useValue: mockEnrollmentsService },
      ],
    }).compile();

    service = module.get<ReviewsService>(ReviewsService);
    prisma = module.get(PrismaService);
    enrollmentsService = module.get(EnrollmentsService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const studentId = 'student-1';
    const courseId = 'course-1';
    const dto = {
      rating: 5,
      comment: 'Excellent course!',
    };

    it('should create a review and recompute course rating', async () => {
      const mockCourse = { id: courseId, title: 'React Course' };
      const mockReview = {
        id: 'review-1',
        courseId,
        studentId,
        rating: 5,
        comment: 'Excellent course!',
        createdAt: new Date(),
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);
      mockEnrollmentsService.isEnrolled.mockResolvedValue(true);
      mockPrisma.courseReview.findUnique.mockResolvedValue(null);
      mockPrisma.courseReview.create.mockResolvedValue(mockReview);
      mockPrisma.courseReview.aggregate.mockResolvedValue({
        _avg: { rating: 5 },
        _count: { _all: 1 },
      });
      mockPrisma.course.update.mockResolvedValue({});

      const result = await service.create(studentId, courseId, dto);

      expect(result).toEqual(mockReview);
      expect(mockPrisma.courseReview.create).toHaveBeenCalledWith({
        data: { courseId, studentId, rating: 5, comment: 'Excellent course!' },
      });
      expect(mockPrisma.course.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(service.create(studentId, courseId, dto))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if student is not enrolled', async () => {
      const mockCourse = { id: courseId, title: 'React Course' };

      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);
      mockEnrollmentsService.isEnrolled.mockResolvedValue(false);

      await expect(service.create(studentId, courseId, dto))
        .rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException if review already exists', async () => {
      const mockCourse = { id: courseId, title: 'React Course' };
      const existingReview = {
        id: 'review-1',
        courseId,
        studentId,
        rating: 4,
        comment: 'Good',
      };

      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);
      mockEnrollmentsService.isEnrolled.mockResolvedValue(true);
      mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);

      await expect(service.create(studentId, courseId, dto))
        .rejects.toThrow(ConflictException);
    });
  });

  describe('findForCourse', () => {
    const courseId = 'course-1';

    it('should return paginated reviews for a course', async () => {
      const mockReviews = [
        {
          id: 'review-1',
          courseId,
          studentId: 'student-1',
          rating: 5,
          comment: 'Great!',
          createdAt: new Date(),
          student: { id: 'student-1', name: 'John Doe', avatarUrl: null },
        },
        {
          id: 'review-2',
          courseId,
          studentId: 'student-2',
          rating: 4,
          comment: 'Good',
          createdAt: new Date(),
          student: { id: 'student-2', name: 'Jane Smith', avatarUrl: null },
        },
      ];

      mockPrisma.$transaction.mockResolvedValue([mockReviews, 2]);

      const result = await service.findForCourse(courseId, 1, 20);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it('should handle pagination correctly', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      const result = await service.findForCourse(courseId, 2, 10);

      expect(result.data).toHaveLength(0);
      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
    });
  });

  describe('updateMyReview', () => {
    const studentId = 'student-1';
    const courseId = 'course-1';
    const dto = {
      rating: 4,
      comment: 'Updated review',
    };

    it('should update an existing review and recompute rating', async () => {
      const existingReview = {
        id: 'review-1',
        courseId,
        studentId,
        rating: 5,
        comment: 'Old comment',
      };

      const updatedReview = {
        ...existingReview,
        rating: 4,
        comment: 'Updated review',
      };

      mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);
      mockPrisma.courseReview.update.mockResolvedValue(updatedReview);
      mockPrisma.courseReview.aggregate.mockResolvedValue({
        _avg: { rating: 4 },
        _count: { _all: 1 },
      });
      mockPrisma.course.update.mockResolvedValue({});

      const result = await service.updateMyReview(studentId, courseId, dto);

      expect(result.rating).toBe(4);
      expect(result.comment).toBe('Updated review');
      expect(mockPrisma.course.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if review does not exist', async () => {
      mockPrisma.courseReview.findUnique.mockResolvedValue(null);

      await expect(service.updateMyReview(studentId, courseId, dto))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if trying to update another student\'s review', async () => {
      const existingReview = {
        id: 'review-1',
        courseId,
        studentId: 'other-student',
        rating: 5,
        comment: 'Comment',
      };

      mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);

      await expect(service.updateMyReview(studentId, courseId, dto))
        .rejects.toThrow(ForbiddenException);
    });

    it('should update only provided fields', async () => {
      const existingReview = {
        id: 'review-1',
        courseId,
        studentId,
        rating: 5,
        comment: 'Old comment',
      };

      const updatedReview = {
        ...existingReview,
        rating: 4,
      };

      mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);
      mockPrisma.courseReview.update.mockResolvedValue(updatedReview);
      mockPrisma.courseReview.aggregate.mockResolvedValue({
        _avg: { rating: 4 },
        _count: { _all: 1 },
      });
      mockPrisma.course.update.mockResolvedValue({});

      const result = await service.updateMyReview(studentId, courseId, { rating: 4 });

      expect(result.rating).toBe(4);
      expect(mockPrisma.courseReview.update).toHaveBeenCalled();
    });
  });

  describe('deleteMyReview', () => {
    const studentId = 'student-1';
    const courseId = 'course-1';

    it('should delete review and recompute rating', async () => {
      const existingReview = {
        id: 'review-1',
        courseId,
        studentId,
        rating: 5,
        comment: 'Comment',
      };

      mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);
      mockPrisma.courseReview.delete.mockResolvedValue(existingReview);
      mockPrisma.courseReview.aggregate.mockResolvedValue({
        _avg: { rating: 0 },
        _count: { _all: 0 },
      });
      mockPrisma.course.update.mockResolvedValue({});

      const result = await service.deleteMyReview(studentId, courseId);

      expect(result.message).toBe('Review deleted');
      expect(mockPrisma.courseReview.delete).toHaveBeenCalled();
      expect(mockPrisma.course.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if review does not exist', async () => {
      mockPrisma.courseReview.findUnique.mockResolvedValue(null);

      await expect(service.deleteMyReview(studentId, courseId))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if trying to delete another student\'s review', async () => {
      const existingReview = {
        id: 'review-1',
        courseId,
        studentId: 'other-student',
        rating: 5,
        comment: 'Comment',
      };

      mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);

      await expect(service.deleteMyReview(studentId, courseId))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('adminDeleteReview', () => {
    const reviewId = 'review-1';

    it('should delete review as admin and recompute rating', async () => {
      const existingReview = {
        id: reviewId,
        courseId: 'course-1',
        studentId: 'student-1',
        rating: 5,
        comment: 'Comment',
      };

      mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);
      mockPrisma.courseReview.delete.mockResolvedValue(existingReview);
      mockPrisma.courseReview.aggregate.mockResolvedValue({
        _avg: { rating: 0 },
        _count: { _all: 0 },
      });
      mockPrisma.course.update.mockResolvedValue({});

      const result = await service.adminDeleteReview(reviewId);

      expect(result.message).toBe('Review deleted by admin');
      expect(mockPrisma.courseReview.delete).toHaveBeenCalledWith({ where: { id: reviewId } });
    });

    it('should throw NotFoundException if review does not exist', async () => {
      mockPrisma.courseReview.findUnique.mockResolvedValue(null);

      await expect(service.adminDeleteReview(reviewId))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('rating recomputation', () => {
    it('should correctly compute average rating when reviews exist', async () => {
      const courseId = 'course-1';
      
      mockPrisma.courseReview.aggregate.mockResolvedValue({
        _avg: { rating: 4.5 },
        _count: { _all: 10 },
      });
      mockPrisma.course.update.mockResolvedValue({});

      // Trigger recomputation through create
      const mockCourse = { id: courseId, title: 'Course' };
      const mockReview = { id: 'review-1', courseId, studentId: 'student-1', rating: 5, comment: 'Great!' };

      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);
      mockEnrollmentsService.isEnrolled.mockResolvedValue(true);
      mockPrisma.courseReview.findUnique.mockResolvedValue(null);
      mockPrisma.courseReview.create.mockResolvedValue(mockReview);

      await service.create('student-1', courseId, { rating: 5, comment: 'Great!' });

      expect(mockPrisma.course.update).toHaveBeenCalledWith({
        where: { id: courseId },
        data: {
          avgRating: 4.5,
          totalReviews: 10,
        },
      });
    });

    it('should set rating to 0 when no reviews exist', async () => {
      const courseId = 'course-1';
      const reviewId = 'review-1';
      
      const existingReview = {
        id: reviewId,
        courseId,
        studentId: 'student-1',
        rating: 5,
        comment: 'Comment',
      };

      mockPrisma.courseReview.findUnique.mockResolvedValue(existingReview);
      mockPrisma.courseReview.delete.mockResolvedValue(existingReview);
      mockPrisma.courseReview.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: { _all: 0 },
      });
      mockPrisma.course.update.mockResolvedValue({});

      await service.deleteMyReview('student-1', courseId);

      expect(mockPrisma.course.update).toHaveBeenCalledWith({
        where: { id: courseId },
        data: {
          avgRating: 0,
          totalReviews: 0,
        },
      });
    });
  });
});
