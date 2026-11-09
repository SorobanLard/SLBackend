import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AddToWishlistDto } from './dto/add-to-wishlist.dto';
import { QueryWishlistDto } from './dto/query-wishlist.dto';

describe('WishlistController', () => {
  let controller: WishlistController;

  const mockWishlistService = {
    add: jest.fn(),
    findAll: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [WishlistController],
      providers: [
        { provide: WishlistService, useValue: mockWishlistService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<WishlistController>(WishlistController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('add (POST /wishlist)', () => {
    it('delegates to WishlistService.add with studentId and dto.courseId and returns created item', async () => {
      const dto: AddToWishlistDto = { courseId: 'course-101' };
      const expected = {
        id: 'wl-1',
        studentId: 'student-1',
        courseId: 'course-101',
        createdAt: new Date('2026-10-01T00:00:00Z'),
      };
      mockWishlistService.add.mockResolvedValue(expected);

      const result = await controller.add('student-1', dto);

      expect(result).toEqual(expected);
      expect(mockWishlistService.add).toHaveBeenCalledTimes(1);
      expect(mockWishlistService.add).toHaveBeenCalledWith(
        'student-1',
        'course-101',
      );
    });

    it('declares HTTP 201 CREATED status code metadata', () => {
      const status = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        WishlistController.prototype.add,
      );
      expect(status).toBe(HttpStatus.CREATED);
    });

    it('propagates NotFoundException / BadRequestException when course is missing or inactive', async () => {
      mockWishlistService.add.mockRejectedValue(
        new BadRequestException('Course is not active'),
      );

      await expect(
        controller.add('student-1', { courseId: 'archived-course' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll (GET /wishlist)', () => {
    it('delegates to WishlistService.findAll with studentId, page, and limit', async () => {
      const query: QueryWishlistDto = { page: 2, limit: 15 };
      const expected = {
        items: [{ id: 'wl-1', courseId: 'course-101' }],
        meta: { page: 2, limit: 15, total: 1 },
      };
      mockWishlistService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll('student-1', query);

      expect(result).toEqual(expected);
      expect(mockWishlistService.findAll).toHaveBeenCalledWith(
        'student-1',
        2,
        15,
      );
    });

    it('passes undefined page and limit when query params are omitted', async () => {
      const query: QueryWishlistDto = {};
      mockWishlistService.findAll.mockResolvedValue({ items: [], meta: {} });

      await controller.findAll('student-1', query);

      expect(mockWishlistService.findAll).toHaveBeenCalledWith(
        'student-1',
        undefined,
        undefined,
      );
    });
  });

  describe('remove (DELETE /wishlist/:courseId)', () => {
    it('delegates to WishlistService.remove with studentId and courseId', async () => {
      const expected = { message: 'Removed from wishlist', courseId: 'course-101' };
      mockWishlistService.remove.mockResolvedValue(expected);

      const result = await controller.remove('student-1', 'course-101');

      expect(result).toEqual(expected);
      expect(mockWishlistService.remove).toHaveBeenCalledWith(
        'student-1',
        'course-101',
      );
    });

    it('declares HTTP 200 OK status code metadata', () => {
      const status = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        WishlistController.prototype.remove,
      );
      expect(status).toBe(HttpStatus.OK);
    });

    it('propagates NotFoundException when removing a course not in the wishlist', async () => {
      mockWishlistService.remove.mockRejectedValue(
        new NotFoundException('Wishlist item not found'),
      );

      await expect(
        controller.remove('student-1', 'missing-course'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('invalid input and guard wiring', () => {
    it('applies JwtAuthGuard at the controller level', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, WishlistController);
      expect(guards).toEqual([JwtAuthGuard]);
    });

    it('rejects empty or non-string courseId in AddToWishlistDto validation', async () => {
      const emptyDto = plainToInstance(AddToWishlistDto, { courseId: '' });
      const emptyErrors = await validate(emptyDto);
      expect(emptyErrors.length).toBeGreaterThan(0);
      expect(emptyErrors[0].property).toBe('courseId');

      const invalidTypeDto = plainToInstance(AddToWishlistDto, {
        courseId: 12345,
      });
      const typeErrors = await validate(invalidTypeDto);
      expect(typeErrors.length).toBeGreaterThan(0);
      expect(typeErrors[0].property).toBe('courseId');
    });

    it('propagates ForbiddenException when service rejects unauthorized student access', async () => {
      mockWishlistService.remove.mockRejectedValue(
        new ForbiddenException('Forbidden wishlist modification'),
      );

      await expect(
        controller.remove('unauthorized-user', 'course-101'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
