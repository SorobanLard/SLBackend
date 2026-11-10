import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RestoreController } from './restore.controller';
import { RestoreService } from './restore.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('RestoreController', () => {
  let controller: RestoreController;

  const mockRestoreService = {
    requestRestore: jest.fn(),
    listJobs: jest.fn(),
    getStatus: jest.fn(),
    executeJob: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RestoreController],
      providers: [
        { provide: RestoreService, useValue: mockRestoreService },
        Reflector,
      ],
    }).compile();

    controller = module.get<RestoreController>(RestoreController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard and RolesGuard(ADMIN) at the controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RestoreController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, RestoreController)).toEqual([
      UserRole.ADMIN,
    ]);

    const rolesGuard = new RolesGuard(new Reflector());
    const instructorCtx = {
      getHandler: () => controller.restore,
      getClass: () => RestoreController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'inst-1', role: UserRole.INSTRUCTOR } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(instructorCtx)).toBe(false);
  });

  it('restore delegates to restoreService.requestRestore with adminId and dto', async () => {
    const dto = { courses: [{ id: 'c-1', title: 'Solar 101' }] } as any;
    const expected = { jobId: 'job-1', status: 'PENDING' };
    mockRestoreService.requestRestore.mockResolvedValue(expected);

    const res = await controller.restore('admin-1', dto);

    expect(mockRestoreService.requestRestore).toHaveBeenCalledWith('admin-1', dto);
    expect(res).toEqual(expected);
  });

  it('listJobs delegates to restoreService.listJobs with defaults when query is empty', () => {
    const expected = { data: [], total: 0, page: 1, limit: 20 };
    mockRestoreService.listJobs.mockReturnValue(expected);

    const res = controller.listJobs({} as any);

    expect(mockRestoreService.listJobs).toHaveBeenCalledWith(1, 20);
    expect(res).toEqual(expected);
  });

  it('getStatus and runJob delegate to restoreService', async () => {
    mockRestoreService.getStatus.mockReturnValue({ id: 'job-1', status: 'RUNNING' });
    mockRestoreService.executeJob.mockResolvedValue({ id: 'job-1', status: 'COMPLETED' });

    expect(controller.getStatus('job-1')).toEqual({ id: 'job-1', status: 'RUNNING' });
    await expect(controller.runJob('job-1')).resolves.toEqual({
      id: 'job-1',
      status: 'COMPLETED',
    });

    expect(mockRestoreService.getStatus).toHaveBeenCalledWith('job-1');
    expect(mockRestoreService.executeJob).toHaveBeenCalledWith('job-1');
  });

  it('propagates NotFoundException / BadRequestException on invalid job or payload', async () => {
    mockRestoreService.executeJob.mockRejectedValue(
      new NotFoundException('Restore job not found'),
    );
    await expect(controller.runJob('missing-job')).rejects.toThrow(
      NotFoundException,
    );

    mockRestoreService.requestRestore.mockRejectedValue(
      new BadRequestException('Courses array cannot be empty'),
    );
    await expect(controller.restore('admin-1', {} as any)).rejects.toThrow(
      BadRequestException,
    );
  });
});
