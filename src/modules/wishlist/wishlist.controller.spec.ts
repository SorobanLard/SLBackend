import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('WishlistController', () => {
  let controller: WishlistController;

  const mockWishlistService = {
    add: jest.fn(),
    findAll: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WishlistController],
      providers: [{ provide: WishlistService, useValue: mockWishlistService }],
    }).compile();

    controller = module.get<WishlistController>(WishlistController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('protects all routes with JwtAuthGuard at the controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WishlistController)).toEqual([
      JwtAuthGuard,
    ]);
  });

  it('add delegates to wishlistService.add with studentId and dto.courseId', async () => {
    const expected = { id: 'wl-1', studentId: 'student-1', courseId: 'course-1' };
    mockWishlistService.add.mockResolvedValue(expected);

    const res = await controller.add('student-1', { courseId: 'course-1' } as any);

    expect(mockWishlistService.add).toHaveBeenCalledWith('student-1', 'course-1');
    expect(res).toEqual(expected);
  });

  it('findAll delegates to wishlistService.findAll with studentId, page, and limit', async () => {
    const expected = { data: [], total: 0, page: 2, limit: 10 };
    mockWishlistService.findAll.mockResolvedValue(expected);

    const res = await controller.findAll('student-1', { page: 2, limit: 10 } as any);

    expect(mockWishlistService.findAll).toHaveBeenCalledWith('student-1', 2, 10);
    expect(res).toEqual(expected);
  });

  it('remove delegates to wishlistService.remove with studentId and courseId', async () => {
    const expected = { deleted: true };
    mockWishlistService.remove.mockResolvedValue(expected);

    const res = await controller.remove('student-1', 'course-1');

    expect(mockWishlistService.remove).toHaveBeenCalledWith('student-1', 'course-1');
    expect(res).toEqual(expected);
  });

  it('propagates NotFoundException / BadRequestException on invalid or inactive courseId', async () => {
    mockWishlistService.add.mockRejectedValue(
      new NotFoundException('Course not found or inactive'),
    );

    await expect(
      controller.add('student-1', { courseId: 'invalid-course' } as any),
    ).rejects.toThrow(NotFoundException);

    mockWishlistService.remove.mockRejectedValue(
      new BadRequestException('Course is not in wishlist'),
    );

    await expect(
      controller.remove('student-1', 'missing-course'),
    ).rejects.toThrow(BadRequestException);
  });
});
