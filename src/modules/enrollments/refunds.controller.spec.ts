import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RefundStatus, UserRole } from '@prisma/client';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('RefundsController', () => {
  let controller: RefundsController;

  const mockRefundsService = {
    create: jest.fn(),
    findByStudent: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    process: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RefundsController],
      providers: [
        { provide: RefundsService, useValue: mockRefundsService },
        Reflector,
      ],
    }).compile();

    controller = module.get<RefundsController>(RefundsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard at controller level and RolesGuard(ADMIN) on admin routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RefundsController)).toEqual([
      JwtAuthGuard,
    ]);

    const adminHandlers = [
      controller.findAll,
      controller.approve,
      controller.reject,
      controller.process,
    ];
    for (const handler of adminHandlers) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    }

    const rolesGuard = new RolesGuard(new Reflector());
    const studentCtx = {
      getHandler: () => controller.approve,
      getClass: () => RefundsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'stu-1', role: UserRole.STUDENT } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(studentCtx)).toBe(false);
  });

  it('create, findMy, and findOne delegate to refundsService', async () => {
    const createDto = { enrollmentId: 'enr-1', reason: 'Schedule conflict' } as any;
    mockRefundsService.create.mockResolvedValue({ id: 'ref-1', ...createDto });
    mockRefundsService.findByStudent.mockResolvedValue({ data: [], total: 0 });
    mockRefundsService.findOne.mockResolvedValue({ id: 'ref-1' });

    await expect(controller.create('stu-1', createDto)).resolves.toEqual({
      id: 'ref-1',
      ...createDto,
    });
    await controller.findMy('stu-1', { page: 1, limit: 10 } as any);
    await controller.findOne('ref-1', 'stu-1', UserRole.STUDENT);

    expect(mockRefundsService.create).toHaveBeenCalledWith('stu-1', createDto);
    expect(mockRefundsService.findByStudent).toHaveBeenCalledWith('stu-1', 1, 10);
    expect(mockRefundsService.findOne).toHaveBeenCalledWith(
      'ref-1',
      'stu-1',
      UserRole.STUDENT,
    );
  });

  it('findAll, approve, reject, and process delegate to refundsService for admins', async () => {
    mockRefundsService.findAll.mockResolvedValue({ data: [], total: 0 });
    mockRefundsService.approve.mockResolvedValue({
      id: 'ref-1',
      status: RefundStatus.APPROVED,
    });
    mockRefundsService.reject.mockResolvedValue({
      id: 'ref-1',
      status: RefundStatus.REJECTED,
    });
    mockRefundsService.process.mockResolvedValue({
      id: 'ref-1',
      status: RefundStatus.PROCESSED,
    });

    await controller.findAll({
      status: RefundStatus.PENDING,
      page: 1,
      limit: 20,
    } as any);
    await controller.approve('ref-1', 'admin-1', { approvedAmount: 50 } as any);
    await controller.reject('ref-1', 'admin-1', { reason: 'Course completed' } as any);
    await controller.process('ref-1', 'admin-1', { txHash: 'stellar_tx_123' } as any);

    expect(mockRefundsService.findAll).toHaveBeenCalledWith({
      status: RefundStatus.PENDING,
      page: 1,
      limit: 20,
    });
    expect(mockRefundsService.approve).toHaveBeenCalledWith('ref-1', 'admin-1', {
      approvedAmount: 50,
    });
    expect(mockRefundsService.reject).toHaveBeenCalledWith('ref-1', 'admin-1', {
      reason: 'Course completed',
    });
    expect(mockRefundsService.process).toHaveBeenCalledWith('ref-1', 'admin-1', {
      txHash: 'stellar_tx_123',
    });
  });

  it('propagates ForbiddenException / BadRequestException on unauthorized access or invalid refund state', async () => {
    mockRefundsService.findOne.mockRejectedValue(
      new ForbiddenException('You can only view your own refund requests'),
    );
    await expect(
      controller.findOne('ref-1', 'other-stu', UserRole.STUDENT),
    ).rejects.toThrow(ForbiddenException);

    mockRefundsService.process.mockRejectedValue(
      new BadRequestException('Refund must be APPROVED before processing'),
    );
    await expect(
      controller.process('ref-1', 'admin-1', { txHash: 'tx' } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
