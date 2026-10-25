import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { KycStatus, UserRole } from '@prisma/client';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('KycController', () => {
  let controller: KycController;

  const mockKycService = {
    submit: jest.fn(),
    findMySubmissions: jest.fn(),
    getVerificationStatus: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    review: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KycController],
      providers: [{ provide: KycService, useValue: mockKycService }],
    }).compile();

    controller = module.get<KycController>(KycController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('submit passes the first uploaded document and additional file', async () => {
    const dto = { documentType: 'PASSPORT' } as any;
    const doc = { originalname: 'doc.pdf' } as Express.Multer.File;
    const extra = { originalname: 'selfie.png' } as Express.Multer.File;
    mockKycService.submit.mockResolvedValue({ id: 'k1' });

    expect(await controller.submit('inst-1', dto, { document: [doc], additional: [extra] })).toEqual({ id: 'k1' });
    expect(mockKycService.submit).toHaveBeenCalledWith('inst-1', dto, doc, extra);
  });

  it('submit handles missing files', async () => {
    const dto = {} as any;
    await controller.submit('inst-1', dto, undefined as any);
    expect(mockKycService.submit).toHaveBeenCalledWith('inst-1', dto, undefined, undefined);
  });

  it('findMy delegates to service', async () => {
    mockKycService.findMySubmissions.mockResolvedValue([]);
    expect(await controller.findMy('inst-1')).toEqual([]);
    expect(mockKycService.findMySubmissions).toHaveBeenCalledWith('inst-1');
  });

  it('getMyStatus delegates to service', async () => {
    mockKycService.getVerificationStatus.mockResolvedValue({ verified: true });
    expect(await controller.getMyStatus('inst-1')).toEqual({ verified: true });
    expect(mockKycService.getVerificationStatus).toHaveBeenCalledWith('inst-1');
  });

  it('findAll delegates with page, limit, status order', async () => {
    mockKycService.findAll.mockResolvedValue({ data: [] });
    await controller.findAll(KycStatus.PENDING, 1, 20);
    expect(mockKycService.findAll).toHaveBeenCalledWith(1, 20, KycStatus.PENDING);
  });

  it('findOne delegates to service', async () => {
    mockKycService.findOne.mockResolvedValue({ id: 'k1' });
    expect(await controller.findOne('k1')).toEqual({ id: 'k1' });
    expect(mockKycService.findOne).toHaveBeenCalledWith('k1');
  });

  it('review delegates to service', async () => {
    const dto = { status: 'APPROVED' } as any;
    mockKycService.review.mockResolvedValue({ id: 'k1' });
    await controller.review('k1', 'admin-1', dto);
    expect(mockKycService.review).toHaveBeenCalledWith('k1', 'admin-1', dto);
  });

  describe('guard metadata', () => {
    it('applies JwtAuthGuard at controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, KycController)).toEqual([JwtAuthGuard]);
    });

    it.each(['submit', 'findMy', 'getMyStatus'] as const)('%s is restricted to INSTRUCTOR', (method) => {
      const handler = KycController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.INSTRUCTOR]);
    });

    it.each(['findAll', 'findOne', 'review'] as const)('%s is restricted to ADMIN', (method) => {
      const handler = KycController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    });
  });
});
