import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { EnrollmentStatus, UserRole } from '@prisma/client';
import {
  EnrollmentConflictStrategy,
  RestoreEnrollmentsDto,
} from './dto/restore-enrollments.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

jest.mock('./enrollment-restore.service', () => ({
  EnrollmentRestoreService: class EnrollmentRestoreService {},
}));

// Load controller and mocked service token via require after jest.mock
// so broken upstream service files are not pulled into the static TS program.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EnrollmentRestoreService } = require('./enrollment-restore.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EnrollmentRestoreController } = require('./enrollment-restore.controller');

describe('EnrollmentRestoreController', () => {
  let controller: any;

  const mockEnrollmentRestoreService = {
    restore: jest.fn(),
    listReports: jest.fn(),
    getReport: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnrollmentRestoreController],
      providers: [
        {
          provide: EnrollmentRestoreService,
          useValue: mockEnrollmentRestoreService,
        },
      ],
    }).compile();

    controller = module.get(EnrollmentRestoreController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('restore', () => {
    it('delegates to enrollmentRestoreService.restore with adminId and dto', async () => {
      const dto: RestoreEnrollmentsDto = {
        conflictStrategy: EnrollmentConflictStrategy.MERGE,
        enrollments: [
          {
            id: 'enr-1',
            studentId: '550e8400-e29b-41d4-a716-446655440000',
            courseId: 'course-1',
            amountPaid: 50,
            status: EnrollmentStatus.ACTIVE,
            progressPercent: 75,
          },
        ],
      };
      const expected = {
        total: 1,
        succeeded: ['enr-1'],
        failed: [],
      };
      mockEnrollmentRestoreService.restore.mockResolvedValue(expected);

      const result = await controller.restore('admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockEnrollmentRestoreService.restore).toHaveBeenCalledWith(
        'admin-1',
        dto,
      );
    });
  });

  describe('listReports', () => {
    it('delegates to enrollmentRestoreService.listReports', () => {
      const reports = [{ id: 'rep-1', total: 5, succeeded: 5, failed: 0 }];
      mockEnrollmentRestoreService.listReports.mockReturnValue(reports);

      expect(controller.listReports()).toEqual(reports);
      expect(mockEnrollmentRestoreService.listReports).toHaveBeenCalledTimes(1);
    });
  });

  describe('getReport', () => {
    it('returns the report when found', () => {
      const report = { id: 'rep-1', total: 2, succeeded: ['e1', 'e2'], failed: [] };
      mockEnrollmentRestoreService.getReport.mockReturnValue(report);

      expect(controller.getReport('rep-1')).toEqual(report);
      expect(mockEnrollmentRestoreService.getReport).toHaveBeenCalledWith('rep-1');
    });

    it('throws NotFoundException when report does not exist', () => {
      mockEnrollmentRestoreService.getReport.mockReturnValue(undefined);

      expect(() => controller.getReport('missing-id')).toThrow(
        new NotFoundException('Restore report missing-id not found'),
      );
    });
  });

  describe('guard metadata & role enforcement', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level with ADMIN role', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, EnrollmentRestoreController),
      ).toEqual([JwtAuthGuard, RolesGuard]);
      expect(
        Reflect.getMetadata(ROLES_KEY, EnrollmentRestoreController),
      ).toEqual([UserRole.ADMIN]);
    });

    it('rejects non-ADMIN roles when evaluated by RolesGuard', () => {
      const reflector = new Reflector();
      const guard = new RolesGuard(reflector);

      const makeContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => EnrollmentRestoreController.prototype.restore,
          getClass: () => EnrollmentRestoreController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u-1', role } }),
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

    it('rejects empty enrollments array in RestoreEnrollmentsDto', async () => {
      await expect(
        pipe.transform(
          { enrollments: [] },
          { type: 'body', metatype: RestoreEnrollmentsDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects invalid studentId UUID or progressPercent > 100 in RestoreEnrollmentsDto', async () => {
      await expect(
        pipe.transform(
          {
            enrollments: [
              {
                studentId: 'not-a-uuid',
                courseId: 'course-1',
                amountPaid: 25,
                progressPercent: 120,
              },
            ],
          },
          { type: 'body', metatype: RestoreEnrollmentsDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
