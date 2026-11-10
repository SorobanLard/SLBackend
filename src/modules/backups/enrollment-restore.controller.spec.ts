import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { EnrollmentRestoreController } from './enrollment-restore.controller';
import { EnrollmentRestoreService } from './enrollment-restore.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('EnrollmentRestoreController', () => {
  let controller: EnrollmentRestoreController;

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
        Reflector,
      ],
    }).compile();

    controller = module.get<EnrollmentRestoreController>(
      EnrollmentRestoreController,
    );
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard and RolesGuard(ADMIN) at the controller level', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, EnrollmentRestoreController),
    ).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, EnrollmentRestoreController)).toEqual([
      UserRole.ADMIN,
    ]);

    const rolesGuard = new RolesGuard(new Reflector());
    const studentCtx = {
      getHandler: () => controller.restore,
      getClass: () => EnrollmentRestoreController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'stu-1', role: UserRole.STUDENT } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(studentCtx)).toBe(false);
  });

  it('restore delegates to enrollmentRestoreService.restore with adminId and dto', async () => {
    const dto = { enrollments: [{ studentId: 's-1', courseId: 'c-1' }] } as any;
    const expected = { id: 'rep-1', restoredCount: 1, skippedCount: 0 };
    mockEnrollmentRestoreService.restore.mockResolvedValue(expected);

    const res = await controller.restore('admin-1', dto);

    expect(mockEnrollmentRestoreService.restore).toHaveBeenCalledWith(
      'admin-1',
      dto,
    );
    expect(res).toEqual(expected);
  });

  it('listReports delegates to enrollmentRestoreService.listReports', () => {
    const expected = [{ id: 'rep-1', restoredCount: 3 }];
    mockEnrollmentRestoreService.listReports.mockReturnValue(expected);

    expect(controller.listReports()).toEqual(expected);
    expect(mockEnrollmentRestoreService.listReports).toHaveBeenCalledTimes(1);
  });

  it('getReport returns report when found and throws NotFoundException when missing', () => {
    const expected = { id: 'rep-1', restoredCount: 3 };
    mockEnrollmentRestoreService.getReport.mockReturnValueOnce(expected);

    expect(controller.getReport('rep-1')).toEqual(expected);

    mockEnrollmentRestoreService.getReport.mockReturnValueOnce(undefined);
    expect(() => controller.getReport('missing-report')).toThrow(
      NotFoundException,
    );
  });

  it('propagates BadRequestException when backup payload is malformed', async () => {
    mockEnrollmentRestoreService.restore.mockRejectedValue(
      new BadRequestException('Invalid enrollment backup payload'),
    );

    await expect(controller.restore('admin-1', {} as any)).rejects.toThrow(
      BadRequestException,
    );
  });
});
