import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('ReviewsController', () => {
  let controller: ReviewsController;
  const mockReviewsService = {
    create: jest.fn(),
    findForCourse: jest.fn(),
    updateMyReview: jest.fn(),
    deleteMyReview: jest.fn(),
    adminDeleteReview: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [{ provide: ReviewsService, useValue: mockReviewsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(ReviewsController);
  });

  it('create delegates with studentId, courseId and dto', () => {
    const dto = { rating: 5, comment: 'Great' } as any;
    controller.create('c1', 'u1', dto);
    expect(mockReviewsService.create).toHaveBeenCalledWith('u1', 'c1', dto);
  });

  it('findForCourse delegates with pagination', () => {
    controller.findForCourse('c1', 2, 10);
    expect(mockReviewsService.findForCourse).toHaveBeenCalledWith('c1', 2, 10);
  });

  it('updateMyReview delegates with studentId, courseId and dto', () => {
    const dto = { rating: 4 } as any;
    controller.updateMyReview('c1', 'u1', dto);
    expect(mockReviewsService.updateMyReview).toHaveBeenCalledWith('u1', 'c1', dto);
  });

  it('deleteMyReview delegates with studentId and courseId', () => {
    controller.deleteMyReview('c1', 'u1');
    expect(mockReviewsService.deleteMyReview).toHaveBeenCalledWith('u1', 'c1');
  });

  it('adminDeleteReview delegates with reviewId', () => {
    controller.adminDeleteReview('r1');
    expect(mockReviewsService.adminDeleteReview).toHaveBeenCalledWith('r1');
  });

  describe('guard wiring', () => {
    it.each(['create', 'updateMyReview', 'deleteMyReview'] as const)(
      '%s is protected by JwtAuthGuard',
      (method) => {
        expect(Reflect.getMetadata(GUARDS_METADATA, ReviewsController.prototype[method])).toEqual([JwtAuthGuard]);
      },
    );

    it('findForCourse is public', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, ReviewsController.prototype.findForCourse)).toBeUndefined();
    });

    it('adminDeleteReview requires JwtAuthGuard, RolesGuard and ADMIN role', () => {
      const handler = ReviewsController.prototype.adminDeleteReview;
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    });
  });
});
