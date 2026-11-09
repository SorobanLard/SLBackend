import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CdnController,
  InvalidateCacheDto,
  ResolveMediaDto,
  ValidateSignedUrlDto,
} from './cdn.controller';
import { CdnService } from './cdn.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../common/guards/roles.guard';

describe('CdnController', () => {
  let controller: CdnController;

  const mockCdnService = {
    invalidateCache: jest.fn(),
    listInvalidationRequests: jest.fn(),
    getInvalidationRequest: jest.fn(),
    validateSignedUrl: jest.fn(),
    resolveWithOriginFallback: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CdnController],
      providers: [{ provide: CdnService, useValue: mockCdnService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<CdnController>(CdnController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('invalidate (POST /cdn/invalidate)', () => {
    it('delegates to CdnService.invalidateCache with dto.paths and returns request tracking info', async () => {
      const dto: InvalidateCacheDto = {
        paths: ['/uploads/videos/lesson-1.mp4', '/uploads/videos/lesson-2.mp4'],
      };
      const expected = {
        id: 'inv-1',
        paths: dto.paths,
        status: 'completed' as const,
        requestedAt: new Date('2026-10-01T00:00:00Z'),
      };
      mockCdnService.invalidateCache.mockResolvedValue(expected);

      const result = await controller.invalidate(dto);

      expect(result).toEqual(expected);
      expect(mockCdnService.invalidateCache).toHaveBeenCalledWith(dto.paths);
    });

    it('declares HTTP 202 ACCEPTED status code metadata', () => {
      const status = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CdnController.prototype.invalidate,
      );
      expect(status).toBe(HttpStatus.ACCEPTED);
    });
  });

  describe('listInvalidations (GET /cdn/invalidations)', () => {
    it('delegates to CdnService.listInvalidationRequests and returns list', () => {
      const expected = [
        {
          id: 'inv-1',
          paths: ['/uploads/videos/lesson-1.mp4'],
          status: 'completed',
          requestedAt: new Date('2026-10-01T00:00:00Z'),
        },
      ];
      mockCdnService.listInvalidationRequests.mockReturnValue(expected);

      const result = controller.listInvalidations();

      expect(result).toEqual(expected);
      expect(mockCdnService.listInvalidationRequests).toHaveBeenCalledTimes(1);
    });
  });

  describe('getInvalidation (GET /cdn/invalidations/:id)', () => {
    it('returns the invalidation request when found', () => {
      const expected = {
        id: 'inv-1',
        paths: ['/uploads/videos/lesson-1.mp4'],
        status: 'completed',
        requestedAt: new Date('2026-10-01T00:00:00Z'),
      };
      mockCdnService.getInvalidationRequest.mockReturnValue(expected);

      const result = controller.getInvalidation('inv-1');

      expect(result).toEqual(expected);
      expect(mockCdnService.getInvalidationRequest).toHaveBeenCalledWith('inv-1');
    });

    it('throws NotFoundException when invalidation request id does not exist', () => {
      mockCdnService.getInvalidationRequest.mockReturnValue(undefined);

      expect(() => controller.getInvalidation('missing-id')).toThrow(
        new NotFoundException('Invalidation request missing-id not found'),
      );
    });
  });

  describe('validateSignedUrl (POST /cdn/validate-signed-url)', () => {
    it('delegates to CdnService.validateSignedUrl with dto.url', () => {
      const dto: ValidateSignedUrlDto = {
        url: 'https://cdn.sorobanlard.com/uploads/private/x.mp4?expires=9999999999&signature=abc',
      };
      const expected = {
        valid: true,
        expired: false,
        path: '/uploads/private/x.mp4',
      };
      mockCdnService.validateSignedUrl.mockReturnValue(expected);

      const result = controller.validateSignedUrl(dto);

      expect(result).toEqual(expected);
      expect(mockCdnService.validateSignedUrl).toHaveBeenCalledWith(dto.url);
    });
  });

  describe('resolve (POST /cdn/resolve)', () => {
    it('delegates to CdnService.resolveWithOriginFallback with cdnUrl and originUrl', async () => {
      const dto: ResolveMediaDto = {
        cdnUrl: 'https://cdn.sorobanlard.com/uploads/videos/x.mp4',
        originUrl: 'http://localhost:3000/uploads/videos/x.mp4',
      };
      const expected = { url: dto.cdnUrl, source: 'cdn' as const };
      mockCdnService.resolveWithOriginFallback.mockResolvedValue(expected);

      const result = await controller.resolve(dto);

      expect(result).toEqual(expected);
      expect(mockCdnService.resolveWithOriginFallback).toHaveBeenCalledWith(
        dto.cdnUrl,
        dto.originUrl,
      );
    });
  });

  describe('invalid input and forbidden-role guard checks', () => {
    it('applies JwtAuthGuard and RolesGuard and restricts controller to ADMIN role', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, CdnController);
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, CdnController)).toEqual([
        UserRole.ADMIN,
      ]);
    });

    it('denies non-ADMIN roles via RolesGuard', () => {
      const reflector = new Reflector();
      const rolesGuard = new RolesGuard(reflector);
      const makeContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => CdnController.prototype.invalidate,
          getClass: () => CdnController,
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

    it('rejects empty paths array in InvalidateCacheDto validation', async () => {
      const emptyPathsDto = plainToInstance(InvalidateCacheDto, { paths: [] });
      const errors = await validate(emptyPathsDto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('paths');
    });
  });
});
