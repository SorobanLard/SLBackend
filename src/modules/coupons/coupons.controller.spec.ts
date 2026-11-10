import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CouponsController', () => {
  let controller: CouponsController;

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
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CouponsController],
      providers: [
        { provide: CouponsService, useValue: mockCouponsService },
        Reflector,
      ],
    }).compile();

    controller = module.get<CouponsController>(CouponsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard at controller level and RolesGuard(ADMIN, INSTRUCTOR) on management endpoints', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CouponsController)).toEqual([
      JwtAuthGuard,
    ]);

    const managementHandlers = [
      controller.create,
      controller.findAll,
      controller.findOne,
      controller.update,
      controller.deactivate,
      controller.getRedemptions,
    ];
    for (const handler of managementHandlers) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        UserRole.ADMIN,
        UserRole.INSTRUCTOR,
      ]);
    }

    const rolesGuard = new RolesGuard(new Reflector());
    const studentCtx = {
      getHandler: () => controller.create,
      getClass: () => CouponsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'stu-1', role: UserRole.STUDENT } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(studentCtx)).toBe(false);
  });

  it('create, findAll, findOne, update, deactivate, and getRedemptions delegate to couponsService', async () => {
    const createDto = { code: 'SOLAR20', discountPercent: 20 } as any;
    mockCouponsService.create.mockResolvedValue({ id: 'cp-1', ...createDto });
    mockCouponsService.findAll.mockResolvedValue({ data: [], total: 0 });
    mockCouponsService.findOne.mockResolvedValue({ id: 'cp-1' });
    mockCouponsService.update.mockResolvedValue({ id: 'cp-1', discountPercent: 25 });
    mockCouponsService.deactivate.mockResolvedValue({ id: 'cp-1', isActive: false });
    mockCouponsService.getRedemptions.mockResolvedValue({ data: [], total: 0 });

    await expect(controller.create('inst-1', createDto)).resolves.toEqual({
      id: 'cp-1',
      ...createDto,
    });
    await controller.findAll({ page: 1, limit: 10, isActive: true } as any);
    await controller.findOne('cp-1');
    await controller.update('cp-1', { discountPercent: 25 } as any);
    await controller.deactivate('cp-1');
    await controller.getRedemptions('cp-1', { page: 1, limit: 5 } as any);

    expect(mockCouponsService.create).toHaveBeenCalledWith('inst-1', createDto);
    expect(mockCouponsService.findAll).toHaveBeenCalledWith(1, 10, true);
    expect(mockCouponsService.findOne).toHaveBeenCalledWith('cp-1');
    expect(mockCouponsService.update).toHaveBeenCalledWith('cp-1', {
      discountPercent: 25,
    });
    expect(mockCouponsService.deactivate).toHaveBeenCalledWith('cp-1');
    expect(mockCouponsService.getRedemptions).toHaveBeenCalledWith('cp-1', 1, 5);
  });

  it('validate and redeem delegate to couponsService for checkout users', async () => {
    const validateDto = { code: 'SOLAR20', courseId: 'c-1', originalPrice: 100 } as any;
    mockCouponsService.validate.mockResolvedValue({
      valid: true,
      finalPrice: 80,
      discountAmount: 20,
    });
    mockCouponsService.redeem.mockResolvedValue({ id: 'red-1' });

    await expect(controller.validate('stu-1', validateDto)).resolves.toEqual({
      valid: true,
      finalPrice: 80,
      discountAmount: 20,
    });
    await expect(
      controller.redeem('stu-1', {
        couponId: 'cp-1',
        courseId: 'c-1',
        discountAmount: 20,
      }),
    ).resolves.toEqual({ id: 'red-1' });

    expect(mockCouponsService.validate).toHaveBeenCalledWith('stu-1', validateDto);
    expect(mockCouponsService.redeem).toHaveBeenCalledWith(
      'stu-1',
      'cp-1',
      'c-1',
      20,
    );
  });

  it('propagates BadRequestException / ForbiddenException on expired coupon or unauthorized creation', async () => {
    mockCouponsService.validate.mockRejectedValue(
      new BadRequestException('Coupon is expired or usage limit reached'),
    );
    await expect(
      controller.validate('stu-1', { code: 'EXPIRED' } as any),
    ).rejects.toThrow(BadRequestException);

    mockCouponsService.create.mockRejectedValue(
      new ForbiddenException('Instructors can only create coupons for their own courses'),
    );
    await expect(
      controller.create('inst-2', { code: 'HACK' } as any),
    ).rejects.toThrow(ForbiddenException);
  });
});
