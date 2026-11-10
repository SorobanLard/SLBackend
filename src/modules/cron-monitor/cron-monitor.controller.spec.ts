import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { CronMonitorController } from './cron-monitor.controller';
import { CronMonitorService } from './cron-monitor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CronMonitorController', () => {
  let controller: CronMonitorController;

  const mockCronMonitorService = {
    findAll: jest.fn(),
    getStats: jest.fn(),
    findStaleRuns: jest.fn(),
    markStaleRunsFailed: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CronMonitorController],
      providers: [
        { provide: CronMonitorService, useValue: mockCronMonitorService },
        Reflector,
      ],
    }).compile();

    controller = module.get<CronMonitorController>(CronMonitorController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard and RolesGuard(ADMIN) at the controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CronMonitorController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, CronMonitorController)).toEqual([
      UserRole.ADMIN,
    ]);

    const rolesGuard = new RolesGuard(new Reflector());
    const nonAdminCtx = {
      getHandler: () => controller.getStats,
      getClass: () => CronMonitorController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'u-1', role: UserRole.INSTRUCTOR } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(nonAdminCtx)).toBe(false);
  });

  it('findAll and getStats delegate to cronMonitorService', async () => {
    mockCronMonitorService.findAll.mockResolvedValue({ data: [], total: 0 });
    mockCronMonitorService.getStats.mockResolvedValue([{ jobName: 'sync', successRate: 100 }]);

    await expect(controller.findAll({ page: 1, limit: 10 } as any)).resolves.toEqual({
      data: [],
      total: 0,
    });
    await expect(controller.getStats()).resolves.toEqual([
      { jobName: 'sync', successRate: 100 },
    ]);

    expect(mockCronMonitorService.findAll).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
    });
    expect(mockCronMonitorService.getStats).toHaveBeenCalledTimes(1);
  });

  it('findStale and markStaleFailed parse thresholdMinutes when provided or pass undefined', async () => {
    mockCronMonitorService.findStaleRuns.mockResolvedValue([]);
    mockCronMonitorService.markStaleRunsFailed.mockResolvedValue({ markedFailed: 2 });

    await controller.findStale('45');
    expect(mockCronMonitorService.findStaleRuns).toHaveBeenCalledWith(45);

    await controller.findStale(undefined);
    expect(mockCronMonitorService.findStaleRuns).toHaveBeenCalledWith(undefined);

    await controller.markStaleFailed('60');
    expect(mockCronMonitorService.markStaleRunsFailed).toHaveBeenCalledWith(60);

    await controller.markStaleFailed(undefined);
    expect(mockCronMonitorService.markStaleRunsFailed).toHaveBeenCalledWith(undefined);
  });

  it('findOne delegates to cronMonitorService.findOne and propagates NotFoundException', async () => {
    mockCronMonitorService.findOne.mockResolvedValueOnce({ id: 'run-1' });
    await expect(controller.findOne('run-1')).resolves.toEqual({ id: 'run-1' });

    mockCronMonitorService.findOne.mockRejectedValueOnce(
      new NotFoundException('Cron run not found'),
    );
    await expect(controller.findOne('missing-run')).rejects.toThrow(
      NotFoundException,
    );
  });
});
