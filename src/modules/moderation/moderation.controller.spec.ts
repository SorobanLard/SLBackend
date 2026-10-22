import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ModerationController } from './moderation.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('ModerationController', () => {
  let controller: ModerationController;

  const service = {
    createFlag: jest.fn(),
    getDashboardListing: jest.fn(),
    resolveFlag: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ModerationController(service as any);
  });

  it('createFlag delegates to the service with reporter id', () => {
    const dto = { targetId: 't1' } as any;
    controller.createFlag('u1', dto);
    expect(service.createFlag).toHaveBeenCalledWith('u1', dto);
  });

  it('getDashboardListing applies default pagination', () => {
    controller.getDashboardListing();
    expect(service.getDashboardListing).toHaveBeenCalledWith({
      status: undefined,
      targetType: undefined,
      category: undefined,
      page: 1,
      limit: 10,
    });
  });

  it('getDashboardListing coerces page/limit and passes filters', () => {
    controller.getDashboardListing('PENDING' as any, 'COURSE' as any, 'SPAM' as any, '3' as any, '25' as any);
    expect(service.getDashboardListing).toHaveBeenCalledWith({
      status: 'PENDING',
      targetType: 'COURSE',
      category: 'SPAM',
      page: 3,
      limit: 25,
    });
  });

  it('resolveFlag delegates to the service', () => {
    const dto = { status: 'RESOLVED' } as any;
    controller.resolveFlag('f1', 'a1', dto);
    expect(service.resolveFlag).toHaveBeenCalledWith('f1', 'a1', dto);
  });

  describe('guard and role metadata', () => {
    it('applies JwtAuthGuard at the controller level', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, ModerationController)).toEqual([JwtAuthGuard]);
    });

    it('createFlag is open to any authenticated user', () => {
      const handler = ModerationController.prototype.createFlag;
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    });

    it.each(['getDashboardListing', 'resolveFlag'] as const)(
      '%s requires RolesGuard with ADMIN role',
      (method) => {
        const handler = ModerationController.prototype[method];
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([RolesGuard]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
      },
    );
  });
});
