import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { BundlesController } from './bundles.controller';
import { BundlesService } from './bundles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('BundlesController', () => {
  let controller: BundlesController;

  const mockBundlesService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    enroll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BundlesController],
      providers: [{ provide: BundlesService, useValue: mockBundlesService }],
    }).compile();

    controller = module.get<BundlesController>(BundlesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delegates query params to service', async () => {
    mockBundlesService.findAll.mockResolvedValue({ data: [] });
    const result = await controller.findAll('GADDR', 2, 5);
    expect(mockBundlesService.findAll).toHaveBeenCalledWith({ instructorAddress: 'GADDR', page: 2, limit: 5 });
    expect(result).toEqual({ data: [] });
  });

  it('findOne delegates to service', async () => {
    mockBundlesService.findOne.mockResolvedValue({ id: 'b1' });
    expect(await controller.findOne('b1')).toEqual({ id: 'b1' });
    expect(mockBundlesService.findOne).toHaveBeenCalledWith('b1');
  });

  it('create delegates to service', async () => {
    const dto = { title: 'Bundle' } as any;
    mockBundlesService.create.mockResolvedValue({ id: 'b1' });
    expect(await controller.create('inst-1', 'GADDR', dto)).toEqual({ id: 'b1' });
    expect(mockBundlesService.create).toHaveBeenCalledWith('inst-1', 'GADDR', dto);
  });

  it('enroll delegates to service', async () => {
    const dto = {} as any;
    mockBundlesService.enroll.mockResolvedValue({ enrolled: true });
    expect(await controller.enroll('b1', 'stu-1', dto)).toEqual({ enrolled: true });
    expect(mockBundlesService.enroll).toHaveBeenCalledWith('stu-1', 'b1', dto);
  });

  describe('guard metadata', () => {
    it('public routes have no guards', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, BundlesController.prototype.findAll)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, BundlesController.prototype.findOne)).toBeUndefined();
    });

    it('create requires JwtAuthGuard + RolesGuard with INSTRUCTOR/ADMIN', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, BundlesController.prototype.create)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, BundlesController.prototype.create)).toEqual([UserRole.INSTRUCTOR, UserRole.ADMIN]);
    });

    it('enroll requires JwtAuthGuard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, BundlesController.prototype.enroll)).toEqual([JwtAuthGuard]);
    });
  });
});
