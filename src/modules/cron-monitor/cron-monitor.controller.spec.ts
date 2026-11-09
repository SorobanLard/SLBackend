import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { CronJobStatus, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CronMonitorController } from './cron-monitor.controller';
import { CronMonitorService } from './cron-monitor.service';
import { QueryCronRunsDto } from './dto/query-cron-runs.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../common/guards/roles.guard';

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
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CronMonitorController],
      providers: [
        { provide: CronMonitorService, useValue: mockCronMonitorService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<CronMonitorController>(CronMonitorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll (GET /cron-monitor/runs)', () => {
    it('delegates to CronMonitorService.findAll with query filters', async () => {
      const query: QueryCronRunsDto = {
        jobName: 'sync-enrollments',
        status: CronJobStatus.SUCCESS,
        page: 1,
        limit: 10,
      };
      const expected = { items: [{ id: 'run-1', jobName: 'sync-enrollments' }], total: 1 };
      mockCronMonitorService.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query);

      expect(result).toEqual(expected);
      expect(mockCronMonitorService.findAll).toHaveBeenCalledWith(query);
    });
  });

  describe('getStats (GET /cron-monitor/stats)', () => {
    it('delegates to CronMonitorService.getStats and returns aggregated job stats', async () => {
      const expected = [
        { jobName: 'sync-enrollments', successRate: 99.5, avgDurationMs: 420 },
      ];
      mockCronMonitorService.getStats.mockResolvedValue(expected);

      const result = await controller.getStats();

      expect(result).toEqual(expected);
      expect(mockCronMonitorService.getStats).toHaveBeenCalledTimes(1);
    });
  });

  describe('findStale (GET /cron-monitor/stale)', () => {
    it('parses thresholdMinutes as integer and delegates to CronMonitorService.findStaleRuns', async () => {
      const expected = [{ id: 'run-zombie', status: CronJobStatus.RUNNING }];
      mockCronMonitorService.findStaleRuns.mockResolvedValue(expected);

      const result = await controller.findStale('45');

      expect(result).toEqual(expected);
      expect(mockCronMonitorService.findStaleRuns).toHaveBeenCalledWith(45);
    });

    it('passes undefined when thresholdMinutes is omitted', async () => {
      mockCronMonitorService.findStaleRuns.mockResolvedValue([]);

      await controller.findStale(undefined);

      expect(mockCronMonitorService.findStaleRuns).toHaveBeenCalledWith(
        undefined,
      );
    });
  });

  describe('markStaleFailed (POST /cron-monitor/stale/mark-failed)', () => {
    it('parses thresholdMinutes and delegates to CronMonitorService.markStaleRunsFailed', async () => {
      const expected = { markedFailed: 2 };
      mockCronMonitorService.markStaleRunsFailed.mockResolvedValue(expected);

      const result = await controller.markStaleFailed('60');

      expect(result).toEqual(expected);
      expect(mockCronMonitorService.markStaleRunsFailed).toHaveBeenCalledWith(
        60,
      );
    });

    it('declares HTTP 200 OK status code metadata', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          CronMonitorController.prototype.markStaleFailed,
        ),
      ).toBe(HttpStatus.OK);
    });
  });

  describe('findOne (GET /cron-monitor/runs/:id)', () => {
    it('delegates to CronMonitorService.findOne with run id', async () => {
      const expected = { id: 'run-1', jobName: 'sync-enrollments' };
      mockCronMonitorService.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('run-1');

      expect(result).toEqual(expected);
      expect(mockCronMonitorService.findOne).toHaveBeenCalledWith('run-1');
    });

    it('propagates NotFoundException when cron run id does not exist', async () => {
      mockCronMonitorService.findOne.mockRejectedValue(
        new NotFoundException('Cron run not found'),
      );

      await expect(controller.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('invalid input and forbidden-role guard checks', () => {
    it('applies JwtAuthGuard and RolesGuard and restricts controller to ADMIN', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        CronMonitorController,
      );
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, CronMonitorController)).toEqual([
        UserRole.ADMIN,
      ]);
    });

    it('forbids STUDENT and INSTRUCTOR roles via RolesGuard', () => {
      const reflector = new Reflector();
      const rolesGuard = new RolesGuard(reflector);
      const makeContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => CronMonitorController.prototype.markStaleFailed,
          getClass: () => CronMonitorController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(makeContext(UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(makeContext(UserRole.INSTRUCTOR))).toBe(
        false,
      );
      expect(rolesGuard.canActivate(makeContext(UserRole.ADMIN))).toBe(true);
    });

    it('rejects invalid status enum or invalid ISO dates in QueryCronRunsDto', async () => {
      const badDto = plainToInstance(QueryCronRunsDto, {
        status: 'INVALID_STATUS',
        from: 'not-a-date',
      });
      const errors = await validate(badDto);
      const failedProps = errors.map((e) => e.property);
      expect(failedProps).toContain('status');
      expect(failedProps).toContain('from');
    });
  });
});
