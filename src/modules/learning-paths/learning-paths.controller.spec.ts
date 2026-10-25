import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { LearningPathsController } from './learning-paths.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('LearningPathsController', () => {
  let controller: LearningPathsController;

  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    replaceCourses: jest.fn(),
    publish: jest.fn(),
    unpublish: jest.fn(),
    getPathProgress: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new LearningPathsController(service as any);
  });

  describe('route delegation', () => {
    it('create', () => {
      const dto = { title: 'Path' } as any;
      controller.create('a1', dto);
      expect(service.create).toHaveBeenCalledWith('a1', dto);
    });

    it('findAll passes includeAll=true for admins', () => {
      const query = { page: 1, limit: 10, search: 'x', status: 'DRAFT' } as any;
      controller.findAll(UserRole.ADMIN, query);
      expect(service.findAll).toHaveBeenCalledWith(
        { page: 1, limit: 10, search: 'x', status: 'DRAFT' },
        true,
      );
    });

    it('findAll passes includeAll=false for non-admins', () => {
      controller.findAll(UserRole.STUDENT, { page: 2, limit: 5 } as any);
      expect(service.findAll).toHaveBeenCalledWith(
        { page: 2, limit: 5, search: undefined, status: undefined },
        false,
      );
    });

    it('findOne', () => {
      controller.findOne('p1');
      expect(service.findOne).toHaveBeenCalledWith('p1');
    });

    it('update', () => {
      const dto = { title: 'New' } as any;
      controller.update('p1', dto);
      expect(service.update).toHaveBeenCalledWith('p1', dto);
    });

    it('remove', () => {
      controller.remove('p1');
      expect(service.remove).toHaveBeenCalledWith('p1');
    });

    it('replaceCourses', () => {
      controller.replaceCourses('p1', { courseIds: ['c1', 'c2'] } as any);
      expect(service.replaceCourses).toHaveBeenCalledWith('p1', ['c1', 'c2']);
    });

    it('publish / unpublish', () => {
      controller.publish('p1');
      controller.unpublish('p1');
      expect(service.publish).toHaveBeenCalledWith('p1');
      expect(service.unpublish).toHaveBeenCalledWith('p1');
    });

    it('getProgress', () => {
      controller.getProgress('s1', 'p1');
      expect(service.getPathProgress).toHaveBeenCalledWith('p1', 's1');
    });
  });

  describe('guard and role metadata', () => {
    const rolesOf = (method: keyof LearningPathsController) =>
      Reflect.getMetadata(ROLES_KEY, LearningPathsController.prototype[method]);

    it('applies JwtAuthGuard + RolesGuard at the controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, LearningPathsController)).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    });

    it.each([
      'create',
      'update',
      'remove',
      'replaceCourses',
      'publish',
      'unpublish',
    ] as const)('%s is restricted to ADMIN', (method) => {
      expect(rolesOf(method)).toEqual([UserRole.ADMIN]);
    });

    it.each(['findAll', 'findOne', 'getProgress'] as const)(
      '%s is open to all authenticated roles',
      (method) => {
        expect(rolesOf(method)).toEqual([UserRole.ADMIN, UserRole.INSTRUCTOR, UserRole.STUDENT]);
      },
    );
  });
});
