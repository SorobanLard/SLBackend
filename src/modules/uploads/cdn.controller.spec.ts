import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { CdnController } from './cdn.controller';
import { CdnService } from './cdn.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

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
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CdnController],
      providers: [
        { provide: CdnService, useValue: mockCdnService },
        Reflector,
      ],
    }).compile();

    controller = module.get<CdnController>(CdnController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard and RolesGuard(ADMIN) at the controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CdnController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, CdnController)).toEqual([
      UserRole.ADMIN,
    ]);

    const rolesGuard = new RolesGuard(new Reflector());
    const instructorCtx = {
      getHandler: () => controller.invalidate,
      getClass: () => CdnController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'inst-1', role: UserRole.INSTRUCTOR } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(instructorCtx)).toBe(false);
  });

  it('invalidate delegates to cdnService.invalidateCache with dto.paths', () => {
    const expected = { id: 'inv-1', paths: ['/uploads/a.mp4'], status: 'PENDING' };
    mockCdnService.invalidateCache.mockReturnValue(expected);

    const res = controller.invalidate({ paths: ['/uploads/a.mp4'] });

    expect(mockCdnService.invalidateCache).toHaveBeenCalledWith(['/uploads/a.mp4']);
    expect(res).toEqual(expected);
  });

  it('listInvalidations delegates to cdnService.listInvalidationRequests', () => {
    const expected = [{ id: 'inv-1' }];
    mockCdnService.listInvalidationRequests.mockReturnValue(expected);

    expect(controller.listInvalidations()).toEqual(expected);
    expect(mockCdnService.listInvalidationRequests).toHaveBeenCalledTimes(1);
  });

  it('getInvalidation returns the request when found and throws NotFoundException when missing', () => {
    const expected = { id: 'inv-1', status: 'COMPLETED' };
    mockCdnService.getInvalidationRequest.mockReturnValueOnce(expected);

    expect(controller.getInvalidation('inv-1')).toEqual(expected);

    mockCdnService.getInvalidationRequest.mockReturnValueOnce(undefined);
    expect(() => controller.getInvalidation('missing-id')).toThrow(
      NotFoundException,
    );
  });

  it('validateSignedUrl delegates to cdnService.validateSignedUrl', () => {
    const expected = { valid: true, expired: false };
    mockCdnService.validateSignedUrl.mockReturnValue(expected);

    const res = controller.validateSignedUrl({
      url: 'https://cdn.sorobanlard.com/uploads/x.mp4?expires=999999&signature=abc',
    });

    expect(mockCdnService.validateSignedUrl).toHaveBeenCalledWith(
      'https://cdn.sorobanlard.com/uploads/x.mp4?expires=999999&signature=abc',
    );
    expect(res).toEqual(expected);
  });

  it('resolve delegates to cdnService.resolveWithOriginFallback', async () => {
    const expected = { resolvedUrl: 'http://localhost:3000/uploads/x.mp4', source: 'origin' };
    mockCdnService.resolveWithOriginFallback.mockResolvedValue(expected);

    const res = await controller.resolve({
      cdnUrl: 'https://cdn.sorobanlard.com/uploads/x.mp4',
      originUrl: 'http://localhost:3000/uploads/x.mp4',
    });

    expect(mockCdnService.resolveWithOriginFallback).toHaveBeenCalledWith(
      'https://cdn.sorobanlard.com/uploads/x.mp4',
      'http://localhost:3000/uploads/x.mp4',
    );
    expect(res).toEqual(expected);
  });
});
