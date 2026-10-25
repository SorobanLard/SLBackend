import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { LiveSessionsController } from './live-sessions.controller';
import { LiveSessionsService } from './live-sessions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('LiveSessionsController', () => {
  let controller: LiveSessionsController;
  const user = { id: 'instructor-1', role: 'INSTRUCTOR' };
  const req = { user };
  const mockLiveSessionsService = {
    scheduleSession: jest.fn(),
    updateSession: jest.fn(),
    cancelSession: jest.fn(),
    getUpcomingSessions: jest.fn(),
    getSessionById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [LiveSessionsController],
      providers: [{ provide: LiveSessionsService, useValue: mockLiveSessionsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(LiveSessionsController);
  });

  it('scheduleSession delegates with req.user and dto', async () => {
    const dto = { title: 'Intro' } as any;
    mockLiveSessionsService.scheduleSession.mockResolvedValue({ id: 's1' });
    await expect(controller.scheduleSession(req, dto)).resolves.toEqual({ id: 's1' });
    expect(mockLiveSessionsService.scheduleSession).toHaveBeenCalledWith(user, dto);
  });

  it('updateSession delegates with req.user, id and dto', async () => {
    const dto = { title: 'Updated' } as any;
    await controller.updateSession(req, 's1', dto);
    expect(mockLiveSessionsService.updateSession).toHaveBeenCalledWith(user, 's1', dto);
  });

  it('cancelSession delegates with req.user and id', async () => {
    await controller.cancelSession(req, 's1');
    expect(mockLiveSessionsService.cancelSession).toHaveBeenCalledWith(user, 's1');
  });

  it('getUpcomingSessions delegates query filters', async () => {
    await controller.getUpcomingSessions('c1', 'GADDR');
    expect(mockLiveSessionsService.getUpcomingSessions).toHaveBeenCalledWith('c1', 'GADDR');
  });

  it('getSessionById delegates id', async () => {
    await controller.getSessionById('s1');
    expect(mockLiveSessionsService.getSessionById).toHaveBeenCalledWith('s1');
  });

  describe('guard wiring', () => {
    it.each(['scheduleSession', 'updateSession', 'cancelSession'] as const)(
      '%s is protected by JwtAuthGuard',
      (method) => {
        expect(Reflect.getMetadata(GUARDS_METADATA, LiveSessionsController.prototype[method])).toEqual([
          JwtAuthGuard,
        ]);
      },
    );

    it.each(['getUpcomingSessions', 'getSessionById'] as const)('%s is public', (method) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, LiveSessionsController.prototype[method])).toBeUndefined();
    });
  });
});
