import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { DiscountType, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { QueryCouponsDto } from './dto/query-coupons.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CouponsController', () => {
  let controller: CouponsController;
  let rolesGuard: RolesGuard;

  const mockCouponsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    getRedemptions: jest.fn(),
    validate: jest.fn(),
    redeem: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CouponsController],
      providers: [
        { provide: CouponsService, useValue: mockCouponsService },
        Reflector,
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<CouponsController>(CouponsController);
    rolesGuard = moduleRef.get<RolesGuard>(RolesGuard);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create (POST /coupons)', () => {
    it('delegates to CouponsService.create with userId and dto', async () => {
      const dto: CreateCouponDto = {
        code: 'SAVE20',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 20,
        maxRedemptions: 100,
      };
      const expected = {
        id: 'coupon-1',
        ...dto,
        createdById: 'admin-1',
        isActive: true,
      };
      mockCouponsService.create.mockResolvedValue(expected);

      const result = await controller.create('admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockCouponsService.create).toHaveBeenCalledWith('admin-1', dto);
    });

    it('declares HTTP 201 CREATED status code metadata', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          CouponsController.prototype.create,
        ),
      ).toBe(HttpStatus.CREATED);
    });
  });

  describe('findAll (GET /coupons)', () => {
    it('delegates to CouponsService.findAll with pagination and active filter', async () => {
      const query: QueryCouponsDto = { page: 2, limit: 15, isActive: true };
      const expected = {
        data: [{ id: 'coupon-1', code: 'SAVE20' }],
        meta: { page: 2, limit: 15, total: 1 },
      };
      mockCouponsService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query);

      expect(result).toEqual(expected);
      expect(mockCouponsService.findAll).toHaveBeenCalledWith(2, 15, true);
    });

    it('handles undefined query parameters gracefully', async () => {
      const expected = { data: [], meta: { page: 1, limit: 20, total: 0 } };
      mockCouponsService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll({} as QueryCouponsDto);

      expect(result).toEqual(expected);
      expect(mockCouponsService.findAll).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('findOne (GET /coupons/:id)', () => {
    it('delegates to CouponsService.findOne with coupon id', async () => {
      const expected = { id: 'coupon-1', code: 'SAVE20', discountValue: 20 };
      mockCouponsService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('coupon-1');

      expect(result).toEqual(expected);
      expect(mockCouponsService.findOne).toHaveBeenCalledWith('coupon-1');
    });

    it('propagates NotFoundException when coupon does not exist', async () => {
      mockCouponsService.findOne.mockRejectedValue(
        new NotFoundException('Coupon not found'),
      );

      await expect(controller.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update (PATCH /coupons/:id)', () => {
    it('delegates to CouponsService.update with id and dto', async () => {
      const dto: UpdateCouponDto = { discountValue: 25, isActive: false };
      const expected = { id: 'coupon-1', discountValue: 25, isActive: false };
      mockCouponsService.update.mockResolvedValue(expected);

      const result = await controller.update('coupon-1', dto);

      expect(result).toEqual(expected);
      expect(mockCouponsService.update).toHaveBeenCalledWith('coupon-1', dto);
    });
  });

  describe('deactivate (DELETE /coupons/:id)', () => {
    it('delegates to CouponsService.deactivate with id and returns 200 OK metadata', async () => {
      const expected = { id: 'coupon-1', isActive: false };
      mockCouponsService.deactivate.mockResolvedValue(expected);

      const result = await controller.deactivate('coupon-1');

      expect(result).toEqual(expected);
      expect(mockCouponsService.deactivate).toHaveBeenCalledWith('coupon-1');
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          CouponsController.prototype.deactivate,
        ),
      ).toBe(HttpStatus.OK);
    });
  });

  describe('getRedemptions (GET /coupons/:id/redemptions)', () => {
    it('delegates to CouponsService.getRedemptions with id, page, and limit', async () => {
      const expected = {
        data: [{ id: 'redemption-1', couponId: 'coupon-1', userId: 'u-1' }],
        meta: { page: 1, limit: 10, total: 1 },
      };
      mockCouponsService.getRedemptions.mockResolvedValue(expected);

      const result = await controller.getRedemptions('coupon-1', {
        page: 1,
        limit: 10,
      });

      expect(result).toEqual(expected);
      expect(mockCouponsService.getRedemptions).toHaveBeenCalledWith(
        'coupon-1',
        1,
        10,
      );
    });
  });

  describe('validate (POST /coupons/validate)', () => {
    it('delegates to CouponsService.validate with userId and dto', async () => {
      const dto: ValidateCouponDto = {
        code: 'SAVE20',
        courseId: 'course-1',
        originalPrice: 100,
      };
      const expected = {
        valid: true,
        couponId: 'coupon-1',
        discountAmount: 20,
        finalPrice: 80,
      };
      mockCouponsService.validate.mockResolvedValue(expected);

      const result = await controller.validate('student-1', dto);

      expect(result).toEqual(expected);
      expect(mockCouponsService.validate).toHaveBeenCalledWith(
        'student-1',
        dto,
      );
    });

    it('propagates BadRequestException when coupon is expired or invalid', async () => {
      mockCouponsService.validate.mockRejectedValue(
        new BadRequestException('Coupon has expired'),
      );

      await expect(
        controller.validate('student-1', {
          code: 'EXPIRED',
          courseId: 'course-1',
          originalPrice: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('redeem (POST /coupons/redeem)', () => {
    it('delegates to CouponsService.redeem with userId, couponId, courseId, and discountAmount', async () => {
      const body = {
        couponId: 'coupon-1',
        courseId: 'course-1',
        discountAmount: 20,
      };
      const expected = {
        id: 'redemption-1',
        userId: 'student-1',
        ...body,
      };
      mockCouponsService.redeem.mockResolvedValue(expected);

      const result = await controller.redeem('student-1', body);

      expect(result).toEqual(expected);
      expect(mockCouponsService.redeem).toHaveBeenCalledWith(
        'student-1',
        'coupon-1',
        'course-1',
        20,
      );
    });
  });

  describe('role guards and invalid input validation', () => {
    const createMockExecutionContext = (
      handler: (...args: any[]) => any,
      role: UserRole,
    ): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => CouponsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'user-1', role } }),
        }),
      }) as unknown as ExecutionContext;

    it('applies JwtAuthGuard at controller level and restricts management endpoints to ADMIN and INSTRUCTOR', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, CouponsController)).toEqual([
        JwtAuthGuard,
      ]);

      const protectedHandlers = [
        CouponsController.prototype.create,
        CouponsController.prototype.findAll,
        CouponsController.prototype.findOne,
        CouponsController.prototype.update,
        CouponsController.prototype.deactivate,
        CouponsController.prototype.getRedemptions,
      ];

      for (const handler of protectedHandlers) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
          UserRole.ADMIN,
          UserRole.INSTRUCTOR,
        ]);
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.STUDENT),
          ),
        ).toBe(false);
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.ADMIN),
          ),
        ).toBe(true);
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.INSTRUCTOR),
          ),
        ).toBe(true);
      }
    });

    it('allows STUDENT role on checkout validate and redeem endpoints', () => {
      expect(
        rolesGuard.canActivate(
          createMockExecutionContext(
            CouponsController.prototype.validate,
            UserRole.STUDENT,
          ),
        ),
      ).toBe(true);
      expect(
        rolesGuard.canActivate(
          createMockExecutionContext(
            CouponsController.prototype.redeem,
            UserRole.STUDENT,
          ),
        ),
      ).toBe(true);
    });

    it('rejects invalid CreateCouponDto and ValidateCouponDto payloads', async () => {
      const invalidCreateDto = plainToInstance(CreateCouponDto, {
        code: 'A!',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 150,
      });
      const createErrors = await validate(invalidCreateDto);
      expect(createErrors.length).toBeGreaterThan(0);

      const invalidValidateDto = plainToInstance(ValidateCouponDto, {
        code: '',
        courseId: '',
        originalPrice: -10,
      });
      const validateErrors = await validate(invalidValidateDto);
      expect(validateErrors.length).toBeGreaterThan(0);
    });
  });
});
