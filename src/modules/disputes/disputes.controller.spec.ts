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
import { DisputeReferenceType, DisputeStatus, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { FileDisputeDto } from './dto/file-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputeQueryDto } from './dto/dispute-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../common/guards/roles.guard';

describe('DisputesController', () => {
  let controller: DisputesController;

  const mockDisputesService = {
    file: jest.fn(),
    findMyDisputes: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    markUnderReview: jest.fn(),
    resolve: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DisputesController],
      providers: [
        { provide: DisputesService, useValue: mockDisputesService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<DisputesController>(DisputesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('student dispute endpoints', () => {
    it('file (POST /disputes) delegates to DisputesService.file and declares 201 CREATED', async () => {
      const dto: FileDisputeDto = {
        referenceType: DisputeReferenceType.ENROLLMENT,
        referenceId: 'enr-1',
        subject: 'Course content mismatch',
        description: 'Missing promised modules.',
      };
      const expected = { id: 'disp-1', studentId: 'student-1', ...dto };
      mockDisputesService.file.mockResolvedValue(expected);

      const result = await controller.file('student-1', dto);

      expect(result).toEqual(expected);
      expect(mockDisputesService.file).toHaveBeenCalledWith('student-1', dto);
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          DisputesController.prototype.file,
        ),
      ).toBe(HttpStatus.CREATED);
    });

    it('findMy (GET /disputes/my) delegates to DisputesService.findMyDisputes', async () => {
      const expected = { items: [{ id: 'disp-1' }], total: 1 };
      mockDisputesService.findMyDisputes.mockResolvedValue(expected);

      const result = await controller.findMy('student-1', {
        page: 2,
        limit: 5,
      });

      expect(result).toEqual(expected);
      expect(mockDisputesService.findMyDisputes).toHaveBeenCalledWith(
        'student-1',
        2,
        5,
      );
    });

    it('findMyOne (GET /disputes/my/:id) delegates to DisputesService.findOne', async () => {
      const expected = { id: 'disp-1', status: DisputeStatus.OPEN };
      mockDisputesService.findOne.mockResolvedValue(expected);

      const result = await controller.findMyOne('student-1', 'disp-1');

      expect(result).toEqual(expected);
      expect(mockDisputesService.findOne).toHaveBeenCalledWith('disp-1');
    });
  });

  describe('admin dispute endpoints', () => {
    it('findAll (GET /disputes) delegates to DisputesService.findAll with page, limit, status', async () => {
      const query: DisputeQueryDto = {
        page: 1,
        limit: 20,
        status: DisputeStatus.OPEN,
      };
      const expected = { items: [{ id: 'disp-1' }], total: 1 };
      mockDisputesService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query);

      expect(result).toEqual(expected);
      expect(mockDisputesService.findAll).toHaveBeenCalledWith(
        1,
        20,
        DisputeStatus.OPEN,
      );
    });

    it('findOne (GET /disputes/:id) delegates to DisputesService.findOne and propagates NotFoundException', async () => {
      mockDisputesService.findOne.mockRejectedValue(
        new NotFoundException('Dispute not found'),
      );

      await expect(controller.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('markUnderReview (POST /disputes/:id/review) delegates to DisputesService.markUnderReview', async () => {
      const expected = { id: 'disp-1', status: DisputeStatus.UNDER_REVIEW };
      mockDisputesService.markUnderReview.mockResolvedValue(expected);

      const result = await controller.markUnderReview('disp-1');

      expect(result).toEqual(expected);
      expect(mockDisputesService.markUnderReview).toHaveBeenCalledWith('disp-1');
    });

    it('resolve (POST /disputes/:id/resolve) delegates to DisputesService.resolve with id, adminId, and dto', async () => {
      const dto: ResolveDisputeDto = {
        status: DisputeStatus.RESOLVED,
        adminNotes: 'Refund issued to student.',
      } as any;
      const expected = {
        id: 'disp-1',
        status: DisputeStatus.RESOLVED,
        resolvedBy: 'admin-1',
      };
      mockDisputesService.resolve.mockResolvedValue(expected);

      const result = await controller.resolve('disp-1', 'admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockDisputesService.resolve).toHaveBeenCalledWith(
        'disp-1',
        'admin-1',
        dto,
      );
    });
  });

  describe('invalid input and forbidden-role guard checks', () => {
    it('applies JwtAuthGuard on controller and RolesGuard + @Roles(ADMIN) on admin routes', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, DisputesController),
      ).toEqual([JwtAuthGuard]);

      const adminHandlers = [
        DisputesController.prototype.findAll,
        DisputesController.prototype.findOne,
        DisputesController.prototype.markUnderReview,
        DisputesController.prototype.resolve,
      ];
      for (const handler of adminHandlers) {
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
          RolesGuard,
        ]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
          UserRole.ADMIN,
        ]);
      }
    });

    it('forbids STUDENT and INSTRUCTOR callers on admin routes via RolesGuard', () => {
      const reflector = new Reflector();
      const rolesGuard = new RolesGuard(reflector);
      const makeCtx = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => DisputesController.prototype.resolve,
          getClass: () => DisputesController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(makeCtx(UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(makeCtx(UserRole.INSTRUCTOR))).toBe(false);
      expect(rolesGuard.canActivate(makeCtx(UserRole.ADMIN))).toBe(true);
    });

    it('rejects invalid FileDisputeDto when referenceType or subject is invalid', async () => {
      const invalidDto = plainToInstance(FileDisputeDto, {
        referenceType: 'INVALID_TYPE',
        referenceId: '',
        subject: '',
        description: '',
      });
      const errors = await validate(invalidDto);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
