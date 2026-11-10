import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FraudFlagStatus, FraudRiskLevel, UserRole } from '@prisma/client';
import { FraudController } from './fraud.controller';
import { FraudDetectionService } from './fraud-detection.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('FraudController', () => {
  let controller: FraudController;

  const mockFraudDetectionService = {
    getFraudReviewQueue: jest.fn(),
    getStudentRiskProfile: jest.fn(),
    getFlagById: jest.fn(),
    reviewFlag: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FraudController],
      providers: [
        { provide: FraudDetectionService, useValue: mockFraudDetectionService },
        Reflector,
      ],
    }).compile();

    controller = module.get<FraudController>(FraudController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard and RolesGuard(ADMIN) at the controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FraudController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, FraudController)).toEqual([
      UserRole.ADMIN,
    ]);

    const rolesGuard = new RolesGuard(new Reflector());
    const studentCtx = {
      getHandler: () => controller.getQueue,
      getClass: () => FraudController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'stu-1', role: UserRole.STUDENT } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(studentCtx)).toBe(false);
  });

  it('getQueue delegates to fraudDetection.getFraudReviewQueue with filter and pagination', async () => {
    const expected = { data: [{ id: 'flag-1' }], total: 1 };
    mockFraudDetectionService.getFraudReviewQueue.mockResolvedValue(expected);

    const res = await controller.getQueue({
      status: FraudFlagStatus.OPEN,
      riskLevel: FraudRiskLevel.HIGH,
      page: 1,
      limit: 20,
    } as any);

    expect(mockFraudDetectionService.getFraudReviewQueue).toHaveBeenCalledWith(
      { status: FraudFlagStatus.OPEN, riskLevel: FraudRiskLevel.HIGH },
      1,
      20,
    );
    expect(res).toEqual(expected);
  });

  it('getStudentProfile and getFlag delegate to fraudDetection', async () => {
    mockFraudDetectionService.getStudentRiskProfile.mockResolvedValue({
      studentId: 'stu-1',
      totalFlags: 2,
      maxRiskScore: 85,
    });
    mockFraudDetectionService.getFlagById.mockResolvedValue({ id: 'flag-1' });

    await expect(controller.getStudentProfile('stu-1')).resolves.toEqual({
      studentId: 'stu-1',
      totalFlags: 2,
      maxRiskScore: 85,
    });
    await expect(controller.getFlag('flag-1')).resolves.toEqual({ id: 'flag-1' });

    expect(mockFraudDetectionService.getStudentRiskProfile).toHaveBeenCalledWith(
      'stu-1',
    );
    expect(mockFraudDetectionService.getFlagById).toHaveBeenCalledWith('flag-1');
  });

  it('reviewFlag delegates to fraudDetection.reviewFlag with flagId, adminId, and dto', async () => {
    const dto = { decision: 'CONFIRMED', reviewNotes: 'Velocity anomaly' } as any;
    mockFraudDetectionService.reviewFlag.mockResolvedValue({
      id: 'flag-1',
      status: FraudFlagStatus.CONFIRMED,
    });

    const res = await controller.reviewFlag('flag-1', 'admin-1', dto);

    expect(mockFraudDetectionService.reviewFlag).toHaveBeenCalledWith(
      'flag-1',
      'admin-1',
      dto,
    );
    expect(res).toEqual({
      id: 'flag-1',
      status: FraudFlagStatus.CONFIRMED,
    });
  });

  it('propagates NotFoundException / BadRequestException on missing or already-resolved flag', async () => {
    mockFraudDetectionService.getFlagById.mockRejectedValue(
      new NotFoundException('Fraud flag not found'),
    );
    await expect(controller.getFlag('missing-flag')).rejects.toThrow(
      NotFoundException,
    );

    mockFraudDetectionService.reviewFlag.mockRejectedValue(
      new BadRequestException('Flag has already been resolved'),
    );
    await expect(
      controller.reviewFlag('flag-1', 'admin-1', { decision: 'CLEARED' } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
