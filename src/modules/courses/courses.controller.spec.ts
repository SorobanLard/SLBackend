import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

describe('CoursesController', () => {
  let controller: CoursesController;
  let service: jest.Mocked<CoursesService>;

  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CoursesController],
      providers: [
        { provide: CoursesService, useValue: mockService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CoursesController>(CoursesController);
    service = module.get(CoursesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('delegates to service.create with the dto', async () => {
      const dto = { title: 'Course' } as any;
      const expected = { id: '1', ...dto };
      mockService.create.mockResolvedValue(expected);

      await expect(controller.create(dto)).resolves.toBe(expected);
      expect(mockService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('delegates to service.findAll', async () => {
      const expected = [{ id: '1' }];
      mockService.findAll.mockResolvedValue(expected as any);

      await expect(controller.findAll()).resolves.toBe(expected);
      expect(mockService.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('delegates to service.findOne with the id', async () => {
      const expected = { id: '1' };
      mockService.findOne.mockResolvedValue(expected as any);

      await expect(controller.findOne('1')).resolves.toBe(expected);
      expect(mockService.findOne).toHaveBeenCalledWith('1');
    });
  });

  describe('update', () => {
    it('delegates to service.update with the id and dto', async () => {
      const dto = { title: 'Updated' } as any;
      const expected = { id: '1', ...dto };
      mockService.update.mockResolvedValue(expected as any);

      await expect(controller.update('1', dto)).resolves.toBe(expected);
      expect(mockService.update).toHaveBeenCalledWith('1', dto);
    });
  });

  describe('remove', () => {
    it('delegates to service.remove with the id', async () => {
      const expected = { id: '1' };
      mockService.remove.mockResolvedValue(expected as any);

      await expect(controller.remove('1')).resolves.toBe(expected);
      expect(mockService.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('guard and role wiring', () => {
    const reflector = new Reflector();

    it('applies JwtAuthGuard and RolesGuard to the controller', () => {
      const guards = Reflect.getMetadata('__guards__', CoursesController) || [];
      expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    });

    it('declares @Roles metadata on protected routes', () => {
      const roles = reflector.get<string[]>('roles', CoursesController);
      expect(roles).toBeDefined();
      expect(Array.isArray(roles)).toBe(true);
    });
  });
});
