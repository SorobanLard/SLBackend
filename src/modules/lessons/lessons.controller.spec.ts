import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('LessonsController', () => {
  let controller: LessonsController;
  let service: jest.Mocked<LessonsService>;

  const mockLessonsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LessonsController],
      providers: [
        { provide: LessonsService, useValue: mockLessonsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LessonsController>(LessonsController);
    service = module.get(LessonsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should delegate to lessonsService.create', async () => {
      const dto = { title: 'Lesson 1' } as any;
      const expected = { id: '1', ...dto };
      service.create.mockResolvedValue(expected);

      await expect(controller.create(dto)).resolves.toEqual(expected);
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('should delegate to lessonsService.findAll', async () => {
      const expected = [{ id: '1' }];
      service.findAll.mockResolvedValue(expected as any);

      await expect(controller.findAll()).resolves.toEqual(expected);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should delegate to lessonsService.findOne with the id', async () => {
      const expected = { id: '1' };
      service.findOne.mockResolvedValue(expected as any);

      await expect(controller.findOne('1')).resolves.toEqual(expected);
      expect(service.findOne).toHaveBeenCalledWith('1');
    });
  });

  describe('update', () => {
    it('should delegate to lessonsService.update with id and dto', async () => {
      const dto = { title: 'Updated' } as any;
      const expected = { id: '1', ...dto };
      service.update.mockResolvedValue(expected as any);

      await expect(controller.update('1', dto)).resolves.toEqual(expected);
      expect(service.update).toHaveBeenCalledWith('1', dto);
    });
  });

  describe('remove', () => {
    it('should delegate to lessonsService.remove with the id', async () => {
      const expected = { id: '1' };
      service.remove.mockResolvedValue(expected as any);

      await expect(controller.remove('1')).resolves.toEqual(expected);
      expect(service.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('guards and roles metadata', () => {
    const reflector = new Reflector();

    it('should apply JwtAuthGuard and RolesGuard at the controller level', () => {
      const guards = Reflect.getMetadata('__guards__', LessonsController) || [];
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard]),
      );
    });

    it('should define roles metadata on protected routes', () => {
      const prototype = LessonsController.prototype;
      const methods = ['create', 'update', 'remove'];

      methods.forEach((method) => {
        const roles = reflector.get(ROLES_KEY, prototype[method]);
        expect(roles).toBeDefined();
        expect(Array.isArray(roles)).toBe(true);
        expect(roles.length).toBeGreaterThan(0);
      });
    });
  });
});
