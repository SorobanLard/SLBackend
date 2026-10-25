import { Test, TestingModule } from '@nestjs/testing';
import { TopCoursesController } from './top-courses.controller';
import { TopCoursesService } from './top-courses.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';

describe('TopCoursesController', () => {
  let controller: TopCoursesController;
  let service: TopCoursesService;

  const mockTopCoursesService = {
    getTopCourses: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TopCoursesController],
      providers: [
        {
          provide: TopCoursesService,
          useValue: mockTopCoursesService,
        },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<TopCoursesController>(TopCoursesController);
    service = module.get<TopCoursesService>(TopCoursesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getTopCourses', () => {
    it('should call service.getTopCourses with correct params', async () => {
      const query = { limit: 10, sortBy: 'enrollments' };
      const expectedResult = { data: [], total: 0 };
      mockTopCoursesService.getTopCourses.mockResolvedValue(expectedResult);

      const result = await controller.getTopCourses(query);

      expect(service.getTopCourses).toHaveBeenCalledWith(query);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('Guard and Role Decorators', () => {
    it('should have JwtAuthGuard applied', () => {
      const guards = Reflect.getMetadata('__guards__', TopCoursesController);
      expect(guards).toBeDefined();
      expect(guards.some((guard) => guard.name === 'JwtAuthGuard')).toBe(true);
    });

    it('should have RolesGuard applied', () => {
      const guards = Reflect.getMetadata('__guards__', TopCoursesController);
      expect(guards).toBeDefined();
      expect(guards.some((guard) => guard.name === 'RolesGuard')).toBe(true);
    });

    it('should require ADMIN role', () => {
      const roles = Reflect.getMetadata('roles', TopCoursesController);
      expect(roles).toBeDefined();
      expect(roles).toContain(UserRole.ADMIN);
    });
  });
});
