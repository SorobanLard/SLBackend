import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { RefundStatus, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { ApproveRefundDto } from './dto/approve-refund.dto';
import { RejectRefundDto } from './dto/reject-refund.dto';
import { ProcessRefundDto } from './dto/process-refund.dto';
import { RefundQueryDto } from './dto/refund-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('RefundsController', () => {
  let controller: RefundsController;
  let rolesGuard: RolesGuard;

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
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RefundsController],
      providers: [
        { provide: RefundsService, useValue: mockRefundsService },
        Reflector,
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<RefundsController>(RefundsController);
    rolesGuard = moduleRef.get<RolesGuard>(RolesGuard);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create (POST /refunds)', () => {
    it('delegates to RefundsService.create with studentId and dto', async () => {
      const dto: CreateRefundDto = {
        enrollmentId: 'enroll-1',
        reason: 'Course content did not match description',
        requestedAmount: 45.5,
      };
      const expected = {
        id: 'refund-1',
        studentId: 'student-1',
        ...dto,
        status: RefundStatus.PENDING,
      };
      mockRefundsService.create.mockResolvedValue(expected);

      const result = await controller.create('student-1', dto);

      expect(result).toEqual(expected);
      expect(mockRefundsService.create).toHaveBeenCalledWith('student-1', dto);
    });

    it('declares HTTP 201 CREATED status code metadata', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          RefundsController.prototype.create,
        ),
      ).toBe(HttpStatus.CREATED);
    });
  });

  describe('findMy (GET /refunds/my)', () => {
    it('delegates to RefundsService.findByStudent with studentId, page, and limit', async () => {
      const expected = {
        data: [{ id: 'refund-1', studentId: 'student-1' }],
        meta: { page: 1, limit: 10, total: 1 },
      };
      mockRefundsService.findByStudent.mockResolvedValue(expected);

      const result = await controller.findMy('student-1', {
        page: 1,
        limit: 10,
      });

      expect(result).toEqual(expected);
      expect(mockRefundsService.findByStudent).toHaveBeenCalledWith(
        'student-1',
        1,
        10,
      );
    });
  });

  describe('findOne (GET /refunds/:id)', () => {
    it('delegates to RefundsService.findOne with id, userId, and role', async () => {
      const expected = {
        id: 'refund-1',
        studentId: 'student-1',
        status: RefundStatus.PENDING,
      };
      mockRefundsService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne(
        'refund-1',
        'student-1',
        UserRole.STUDENT,
      );

      expect(result).toEqual(expected);
      expect(mockRefundsService.findOne).toHaveBeenCalledWith(
        'refund-1',
        'student-1',
        UserRole.STUDENT,
      );
    });

    it('propagates ForbiddenException when a non-owner student requests another student refund', async () => {
      mockRefundsService.findOne.mockRejectedValue(
        new ForbiddenException('Access denied to refund request'),
      );

      await expect(
        controller.findOne('refund-1', 'other-student', UserRole.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll (GET /refunds)', () => {
    it('delegates to RefundsService.findAll with status, page, and limit filters', async () => {
      const query: RefundQueryDto = {
        status: RefundStatus.PENDING,
        page: 2,
        limit: 20,
      };
      const expected = {
        data: [{ id: 'refund-1', status: RefundStatus.PENDING }],
        meta: { page: 2, limit: 20, total: 1 },
      };
      mockRefundsService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query);

      expect(result).toEqual(expected);
      expect(mockRefundsService.findAll).toHaveBeenCalledWith({
        status: RefundStatus.PENDING,
        page: 2,
        limit: 20,
      });
    });
  });

  describe('approve (POST /refunds/:id/approve)', () => {
    it('delegates to RefundsService.approve with id, adminId, and dto', async () => {
      const dto: ApproveRefundDto = {
        approvedAmount: 40,
        adminNote: 'Approved partial refund',
      };
      const expected = {
        id: 'refund-1',
        status: RefundStatus.APPROVED,
        approvedAmount: 40,
        reviewedById: 'admin-1',
      };
      mockRefundsService.approve.mockResolvedValue(expected);

      const result = await controller.approve('refund-1', 'admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockRefundsService.approve).toHaveBeenCalledWith(
        'refund-1',
        'admin-1',
        dto,
      );
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          RefundsController.prototype.approve,
        ),
      ).toBe(HttpStatus.OK);
    });
  });

  describe('reject (POST /refunds/:id/reject)', () => {
    it('delegates to RefundsService.reject with id, adminId, and dto', async () => {
      const dto: RejectRefundDto = {
        reason: 'Course completion exceeds refund threshold',
      };
      const expected = {
        id: 'refund-1',
        status: RefundStatus.REJECTED,
        rejectionReason: dto.reason,
      };
      mockRefundsService.reject.mockResolvedValue(expected);

      const result = await controller.reject('refund-1', 'admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockRefundsService.reject).toHaveBeenCalledWith(
        'refund-1',
        'admin-1',
        dto,
      );
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          RefundsController.prototype.reject,
        ),
      ).toBe(HttpStatus.OK);
    });
  });

  describe('process (POST /refunds/:id/process)', () => {
    it('delegates to RefundsService.process with id, adminId, and dto', async () => {
      const dto: ProcessRefundDto = {
        txHash: 'a'.repeat(64),
      };
      const expected = {
        id: 'refund-1',
        status: RefundStatus.PROCESSED,
        txHash: dto.txHash,
      };
      mockRefundsService.process.mockResolvedValue(expected);

      const result = await controller.process('refund-1', 'admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockRefundsService.process).toHaveBeenCalledWith(
        'refund-1',
        'admin-1',
        dto,
      );
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          RefundsController.prototype.process,
        ),
      ).toBe(HttpStatus.OK);
    });

    it('propagates NotFoundException or BadRequestException when refund cannot be processed', async () => {
      mockRefundsService.process.mockRejectedValueOnce(
        new NotFoundException('Refund not found'),
      );
      await expect(
        controller.process('missing-id', 'admin-1', { txHash: '0x123' }),
      ).rejects.toThrow(NotFoundException);

      mockRefundsService.process.mockRejectedValueOnce(
        new BadRequestException('Refund must be approved before processing'),
      );
      await expect(
        controller.process('refund-1', 'admin-1', { txHash: '0x123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('role guards and invalid input validation', () => {
    const createMockExecutionContext = (
      handler: (...args: any[]) => any,
      role: UserRole,
    ): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => RefundsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'user-1', role } }),
        }),
      }) as unknown as ExecutionContext;

    it('restricts admin endpoints (findAll, approve, reject, process) strictly to ADMIN role', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, RefundsController)).toEqual([
        JwtAuthGuard,
      ]);

      const adminHandlers = [
        RefundsController.prototype.findAll,
        RefundsController.prototype.approve,
        RefundsController.prototype.reject,
        RefundsController.prototype.process,
      ];

      for (const handler of adminHandlers) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
          UserRole.ADMIN,
        ]);
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.STUDENT),
          ),
        ).toBe(false);
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.INSTRUCTOR),
          ),
        ).toBe(false);
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.ADMIN),
          ),
        ).toBe(true);
      }
    });

    it('rejects invalid CreateRefundDto, ApproveRefundDto, RejectRefundDto, and ProcessRefundDto inputs', async () => {
      const badCreate = plainToInstance(CreateRefundDto, {
        enrollmentId: '',
        reason: '',
        requestedAmount: -5,
      });
      expect((await validate(badCreate)).length).toBeGreaterThan(0);

      const badApprove = plainToInstance(ApproveRefundDto, {
        approvedAmount: 0,
      });
      expect((await validate(badApprove)).length).toBeGreaterThan(0);

      const badReject = plainToInstance(RejectRefundDto, {
        reason: '',
      });
      expect((await validate(badReject)).length).toBeGreaterThan(0);

      const badProcess = plainToInstance(ProcessRefundDto, {
        txHash: '',
      });
      expect((await validate(badProcess)).length).toBeGreaterThan(0);
    });
  });
});
