import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { FraudFlagStatus, FraudRiskLevel, UserRole } from '@prisma/client';
import { FraudController } from './fraud.controller';
import { FraudDetectionService, ReviewFlagDto } from './fraud-detection.service';
import { FraudQueueQueryDto } from './dto/fraud-queue-query.dto';
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
      ],
    }).compile();

    controller = module.get<FraudController>(FraudController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getQueue', () => {
    it('delegates to fraudDetection.getFraudReviewQueue with filters and pagination', async () => {
      const query: FraudQueueQueryDto = {
        status: FraudFlagStatus.OPEN,
        riskLevel: FraudRiskLevel.CRITICAL,
        page: 2,
        limit: 15,
      };
      const expected = {
        data: [{ id: 'flag-1', riskScore: 95, status: FraudFlagStatus.OPEN }],
        total: 1,
        page: 2,
        limit: 15,
      };
      mockFraudDetectionService.getFraudReviewQueue.mockResolvedValue(expected);

      const result = await controller.getQueue(query);

      expect(result).toEqual(expected);
      expect(mockFraudDetectionService.getFraudReviewQueue).toHaveBeenCalledWith(
        { status: FraudFlagStatus.OPEN, riskLevel: FraudRiskLevel.CRITICAL },
        2,
        15,
      );
    });

    it('passes undefined filters and pagination when query is empty', async () => {
      mockFraudDetectionService.getFraudReviewQueue.mockResolvedValue({
        data: [],
        total: 0,
      });

      await controller.getQueue({} as FraudQueueQueryDto);

      expect(mockFraudDetectionService.getFraudReviewQueue).toHaveBeenCalledWith(
        { status: undefined, riskLevel: undefined },
        undefined,
        undefined,
      );
    });
  });

  describe('getStudentProfile', () => {
    it('delegates to fraudDetection.getStudentRiskProfile with studentId', async () => {
      const profile = {
        studentId: 'student-1',
        totalFlags: 3,
        confirmedCount: 1,
        maxRiskScore: 92,
      };
      mockFraudDetectionService.getStudentRiskProfile.mockResolvedValue(profile);

      const result = await controller.getStudentProfile('student-1');

      expect(result).toEqual(profile);
      expect(mockFraudDetectionService.getStudentRiskProfile).toHaveBeenCalledWith(
        'student-1',
      );
    });
  });

  describe('getFlag', () => {
    it('delegates to fraudDetection.getFlagById with flagId', async () => {
      const flag = {
        id: 'flag-1',
        enrollmentId: 'enr-1',
        status: FraudFlagStatus.HELD,
      };
      mockFraudDetectionService.getFlagById.mockResolvedValue(flag);

      const result = await controller.getFlag('flag-1');

      expect(result).toEqual(flag);
      expect(mockFraudDetectionService.getFlagById).toHaveBeenCalledWith('flag-1');
    });
  });

  describe('reviewFlag', () => {
    it('delegates to fraudDetection.reviewFlag with flagId, adminId, and review payload', async () => {
      const dto: ReviewFlagDto = {
        decision: 'CLEARED',
        reviewNotes: 'Verified legitimate payment receipt',
      };
      const updated = {
        id: 'flag-1',
        status: FraudFlagStatus.CLEARED,
        reviewedById: 'admin-1',
      };
      mockFraudDetectionService.reviewFlag.mockResolvedValue(updated);

      const result = await controller.reviewFlag('flag-1', 'admin-1', dto);

      expect(result).toEqual(updated);
      expect(mockFraudDetectionService.reviewFlag).toHaveBeenCalledWith(
        'flag-1',
        'admin-1',
        dto,
      );
    });
  });

  describe('guard metadata & role enforcement', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level with ADMIN role', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, FraudController);
      const roles = Reflect.getMetadata(ROLES_KEY, FraudController);
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
      expect(roles).toEqual([UserRole.ADMIN]);
    });

    it('denies access when RolesGuard evaluates a non-ADMIN role (STUDENT or INSTRUCTOR)', () => {
      const reflector = new Reflector();
      const guard = new RolesGuard(reflector);

      const makeContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => FraudController.prototype.reviewFlag,
          getClass: () => FraudController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(guard.canActivate(makeContext(UserRole.STUDENT))).toBe(false);
      expect(guard.canActivate(makeContext(UserRole.INSTRUCTOR))).toBe(false);
      expect(guard.canActivate(makeContext(UserRole.ADMIN))).toBe(true);
    });
  });

  describe('DTO input validation', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    it('rejects invalid status or riskLevel enum values in FraudQueueQueryDto', async () => {
      await expect(
        pipe.transform(
          { status: 'INVALID_STATUS' },
          { type: 'query', metatype: FraudQueueQueryDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        pipe.transform(
          { riskLevel: 'EXTREME' },
          { type: 'query', metatype: FraudQueueQueryDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts valid FraudQueueQueryDto filters', async () => {
      const transformed = await pipe.transform(
        {
          status: FraudFlagStatus.HELD,
          riskLevel: FraudRiskLevel.HIGH,
          page: 1,
          limit: 20,
        },
        { type: 'query', metatype: FraudQueueQueryDto },
      );
      expect(transformed).toMatchObject({
        status: FraudFlagStatus.HELD,
        riskLevel: FraudRiskLevel.HIGH,
      });
    });
  });
});
