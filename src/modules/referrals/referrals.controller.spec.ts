import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('ReferralsController', () => {
  let controller: ReferralsController;

  const mockReferralsService = {
    validateCode: jest.fn(),
    getOrCreateCode: jest.fn(),
    getPerformanceStatus: jest.fn(),
    listMyRewards: jest.fn(),
    previewReward: jest.fn(),
    redeemReward: jest.fn(),
    deactivateCode: jest.fn(),
    getRewardRules: jest.fn(),
    updateRewardRules: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReferralsController],
      providers: [{ provide: ReferralsService, useValue: mockReferralsService }],
    }).compile();

    controller = module.get<ReferralsController>(ReferralsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('validate passes the code to service', async () => {
    mockReferralsService.validateCode.mockResolvedValue({ valid: true });
    expect(await controller.validate({ code: 'ABC' } as any)).toEqual({ valid: true });
    expect(mockReferralsService.validateCode).toHaveBeenCalledWith('ABC');
  });

  it('generateCode and getCode delegate to getOrCreateCode', async () => {
    mockReferralsService.getOrCreateCode.mockResolvedValue({ code: 'ABC' });
    await controller.generateCode('u1');
    await controller.getCode('u1');
    expect(mockReferralsService.getOrCreateCode).toHaveBeenCalledTimes(2);
    expect(mockReferralsService.getOrCreateCode).toHaveBeenCalledWith('u1');
  });

  it('getStatus delegates to service', async () => {
    await controller.getStatus('u1');
    expect(mockReferralsService.getPerformanceStatus).toHaveBeenCalledWith('u1');
  });

  it('listRewards delegates to service', async () => {
    await controller.listRewards('u1');
    expect(mockReferralsService.listMyRewards).toHaveBeenCalledWith('u1');
  });

  it('previewReward passes price and rewardId', async () => {
    await controller.previewReward('u1', { originalPrice: 100, rewardId: 'r1' } as any);
    expect(mockReferralsService.previewReward).toHaveBeenCalledWith('u1', 100, 'r1');
  });

  it('redeemReward passes rewardId and enrollmentId', async () => {
    await controller.redeemReward('u1', { rewardId: 'r1', enrollmentId: 'e1' });
    expect(mockReferralsService.redeemReward).toHaveBeenCalledWith('u1', 'r1', 'e1');
  });

  it('deactivate delegates to service', async () => {
    await controller.deactivate('u1');
    expect(mockReferralsService.deactivateCode).toHaveBeenCalledWith('u1');
  });

  it('getRules and updateRules delegate to service', async () => {
    const dto = { enabled: true } as any;
    await controller.getRules();
    await controller.updateRules(dto);
    expect(mockReferralsService.getRewardRules).toHaveBeenCalled();
    expect(mockReferralsService.updateRewardRules).toHaveBeenCalledWith(dto);
  });

  describe('guard metadata', () => {
    it('validate is public', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, ReferralsController.prototype.validate)).toBeUndefined();
    });

    it.each([
      'generateCode', 'getCode', 'getStatus', 'listRewards', 'previewReward', 'redeemReward', 'deactivate',
    ] as const)('%s requires JwtAuthGuard', (method) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, ReferralsController.prototype[method])).toEqual([JwtAuthGuard]);
    });

    it.each(['getRules', 'updateRules'] as const)('%s is restricted to ADMIN', (method) => {
      const handler = ReferralsController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    });
  });
});
