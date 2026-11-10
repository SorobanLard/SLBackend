import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DisputeStatus, UserRole } from '@prisma/client';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

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
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisputesController],
      providers: [
        { provide: DisputesService, useValue: mockDisputesService },
        Reflector,
      ],
    }).compile();

    controller = module.get<DisputesController>(DisputesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('enforces JwtAuthGuard at controller level and RolesGuard(ADMIN) on admin routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DisputesController)).toEqual([
      JwtAuthGuard,
    ]);

    const adminRoutes = [
      controller.findAll,
      controller.findOne,
      controller.markUnderReview,
      controller.resolve,
    ];
    for (const handler of adminRoutes) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    }

    const rolesGuard = new RolesGuard(new Reflector());
    const studentCtx = {
      getHandler: () => controller.resolve,
      getClass: () => DisputesController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'student-1', role: UserRole.STUDENT } }),
      }),
    } as any;
    expect(rolesGuard.canActivate(studentCtx)).toBe(false);
  });

  it('file delegates to disputesService.file with studentId and dto', async () => {
    const dto = { enrollmentId: 'enr-1', reason: 'Duplicate charge' } as any;
    mockDisputesService.file.mockResolvedValue({ id: 'disp-1', ...dto });

    const res = await controller.file('student-1', dto);

    expect(mockDisputesService.file).toHaveBeenCalledWith('student-1', dto);
    expect(res).toEqual({ id: 'disp-1', ...dto });
  });

  it('findMy delegates to disputesService.findMyDisputes with pagination', async () => {
    mockDisputesService.findMyDisputes.mockResolvedValue({ data: [], total: 0 });

    const res = await controller.findMy('student-1', { page: 1, limit: 15 } as any);

    expect(mockDisputesService.findMyDisputes).toHaveBeenCalledWith('student-1', 1, 15);
    expect(res).toEqual({ data: [], total: 0 });
  });

  it('findMyOne and findOne delegate to disputesService.findOne', async () => {
    mockDisputesService.findOne.mockResolvedValue({ id: 'disp-1' });

    await expect(controller.findMyOne('student-1', 'disp-1')).resolves.toEqual({
      id: 'disp-1',
    });
    await expect(controller.findOne('disp-1')).resolves.toEqual({ id: 'disp-1' });
    expect(mockDisputesService.findOne).toHaveBeenCalledTimes(2);
  });

  it('findAll delegates to disputesService.findAll with page, limit, and status', async () => {
    mockDisputesService.findAll.mockResolvedValue({ data: [], total: 0 });

    await controller.findAll({
      page: 2,
      limit: 20,
      status: DisputeStatus.OPEN,
    } as any);

    expect(mockDisputesService.findAll).toHaveBeenCalledWith(
      2,
      20,
      DisputeStatus.OPEN,
    );
  });

  it('markUnderReview and resolve delegate to disputesService', async () => {
    mockDisputesService.markUnderReview.mockResolvedValue({
      id: 'disp-1',
      status: DisputeStatus.UNDER_REVIEW,
    });
    const resolveDto = { status: DisputeStatus.RESOLVED, resolutionNotes: 'Refunded' } as any;
    mockDisputesService.resolve.mockResolvedValue({
      id: 'disp-1',
      ...resolveDto,
    });

    await expect(controller.markUnderReview('disp-1')).resolves.toEqual({
      id: 'disp-1',
      status: DisputeStatus.UNDER_REVIEW,
    });
    await expect(controller.resolve('disp-1', 'admin-1', resolveDto)).resolves.toEqual({
      id: 'disp-1',
      ...resolveDto,
    });

    expect(mockDisputesService.markUnderReview).toHaveBeenCalledWith('disp-1');
    expect(mockDisputesService.resolve).toHaveBeenCalledWith('disp-1', 'admin-1', resolveDto);
  });

  it('propagates BadRequestException / ForbiddenException on invalid dispute filing', async () => {
    mockDisputesService.file.mockRejectedValue(
      new BadRequestException('Enrollment does not belong to student'),
    );

    await expect(controller.file('student-1', {} as any)).rejects.toThrow(
      BadRequestException,
    );

    mockDisputesService.resolve.mockRejectedValue(
      new ForbiddenException('Only admins can resolve disputes'),
    );

    await expect(
      controller.resolve('disp-1', 'student-1', {} as any),
    ).rejects.toThrow(ForbiddenException);
  });
});
