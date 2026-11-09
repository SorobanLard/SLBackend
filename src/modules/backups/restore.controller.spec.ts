import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RestoreController } from './restore.controller';
import { RestoreService } from './restore.service';
import { RestoreCoursesDto } from './dto/restore-course.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
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
      providers: [{ provide: RestoreService, useValue: mockRestoreService }],
    }).compile();

    controller = module.get<RestoreController>(RestoreController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('restore', () => {
    it('delegates to restoreService.requestRestore with adminId and dto', async () => {
      const dto: RestoreCoursesDto = {
        overwriteExisting: true,
        courses: [
          {
            id: 'course-1',
            instructorAddress: 'GINSTRUCTOR123',
            title: 'Intro to Soroban',
            category: 'Blockchain',
            price: 49.99,
          },
        ],
      };
      const expected = { jobId: 'job-1', status: 'PENDING' };
      mockRestoreService.requestRestore.mockResolvedValue(expected);

      const result = await controller.restore('admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockRestoreService.requestRestore).toHaveBeenCalledWith(
        'admin-1',
        dto,
      );
    });
  });

  describe('listJobs', () => {
    it('defaults to page=1 and limit=20 when query parameters are omitted', async () => {
      const expected = { data: [], total: 0, page: 1, limit: 20 };
      mockRestoreService.listJobs.mockResolvedValue(expected);

      const result = await controller.listJobs({} as PaginationQueryDto);

      expect(result).toEqual(expected);
      expect(mockRestoreService.listJobs).toHaveBeenCalledWith(1, 20);
    });

    it('passes custom page and limit to restoreService.listJobs', async () => {
      mockRestoreService.listJobs.mockResolvedValue({
        data: [{ id: 'job-1' }],
        total: 1,
        page: 3,
        limit: 10,
      });

      await controller.listJobs({ page: 3, limit: 10 });

      expect(mockRestoreService.listJobs).toHaveBeenCalledWith(3, 10);
    });
  });

  describe('getStatus', () => {
    it('delegates to restoreService.getStatus with job id', async () => {
      const status = { id: 'job-1', status: 'COMPLETED', restoredCount: 2 };
      mockRestoreService.getStatus.mockResolvedValue(status);

      const result = await controller.getStatus('job-1');

      expect(result).toEqual(status);
      expect(mockRestoreService.getStatus).toHaveBeenCalledWith('job-1');
    });
  });

  describe('runJob', () => {
    it('delegates to restoreService.executeJob with job id', async () => {
      const executed = { id: 'job-1', status: 'COMPLETED' };
      mockRestoreService.executeJob.mockResolvedValue(executed);

      const result = await controller.runJob('job-1');

      expect(result).toEqual(executed);
      expect(mockRestoreService.executeJob).toHaveBeenCalledWith('job-1');
    });
  });

  describe('guard metadata & role enforcement', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level with ADMIN role', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, RestoreController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, RestoreController)).toEqual([
        UserRole.ADMIN,
      ]);
    });

    it('denies access when RolesGuard evaluates non-ADMIN roles', () => {
      const reflector = new Reflector();
      const guard = new RolesGuard(reflector);

      const makeContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => RestoreController.prototype.restore,
          getClass: () => RestoreController,
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

    it('rejects empty courses array in RestoreCoursesDto', async () => {
      await expect(
        pipe.transform(
          { courses: [] },
          { type: 'body', metatype: RestoreCoursesDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects negative course price or invalid scheduledFor ISO date in RestoreCoursesDto', async () => {
      await expect(
        pipe.transform(
          {
            scheduledFor: 'not-a-date',
            courses: [
              {
                id: 'course-1',
                instructorAddress: 'GINSTRUCTOR123',
                title: 'Bad Course',
                category: 'Blockchain',
                price: -10,
              },
            ],
          },
          { type: 'body', metatype: RestoreCoursesDto },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
