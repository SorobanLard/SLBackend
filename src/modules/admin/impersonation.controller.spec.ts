import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('ImpersonationController', () => {
  let controller: ImpersonationController;

  const mockImpersonationService = {
    startImpersonation: jest.fn(),
    getAuditTrail: jest.fn(),
    verifySession: jest.fn(),
    endSession: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ImpersonationController],
      providers: [{ provide: ImpersonationService, useValue: mockImpersonationService }],
    }).compile();

    controller = module.get<ImpersonationController>(ImpersonationController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('startImpersonation delegates to service', async () => {
    const dto = { targetUserId: 'u1' } as any;
    mockImpersonationService.startImpersonation.mockResolvedValue({ sessionId: 's1' });
    expect(await controller.startImpersonation('admin-1', dto)).toEqual({ sessionId: 's1' });
    expect(mockImpersonationService.startImpersonation).toHaveBeenCalledWith('admin-1', dto);
  });

  it('getAuditTrail defaults to page 1, limit 10', async () => {
    await controller.getAuditTrail();
    expect(mockImpersonationService.getAuditTrail).toHaveBeenCalledWith(1, 10);
  });

  it('getAuditTrail coerces page/limit to numbers', async () => {
    await controller.getAuditTrail('3' as any, '25' as any);
    expect(mockImpersonationService.getAuditTrail).toHaveBeenCalledWith(3, 25);
  });

  it('verifySession delegates to service', async () => {
    await controller.verifySession('s1');
    expect(mockImpersonationService.verifySession).toHaveBeenCalledWith('s1');
  });

  it('endSession delegates to service', async () => {
    await controller.endSession('s1', 'admin-1');
    expect(mockImpersonationService.endSession).toHaveBeenCalledWith('s1', 'admin-1');
  });

  describe('guard metadata', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, ImpersonationController)).toEqual([JwtAuthGuard, RolesGuard]);
    });

    it('restricts the whole controller to ADMIN', () => {
      expect(Reflect.getMetadata(ROLES_KEY, ImpersonationController)).toEqual([UserRole.ADMIN]);
    });
  });
});
