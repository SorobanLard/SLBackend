import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { NotificationType } from '@prisma/client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('NotificationsController', () => {
  let controller: NotificationsController;

  const mockNotificationsService = {
    findForUser: jest.fn(),
    getUnreadCount: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    registerDeviceToken: jest.fn(),
    getCurrentPreferenceSettings: jest.fn(),
    updatePreference: jest.fn(),
    updateDigestPreference: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: mockNotificationsService }],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll delegates to findForUser with query params', async () => {
    mockNotificationsService.findForUser.mockResolvedValue({ data: [] });

    const res = await controller.findAll('user-1', true, 2, 10);

    expect(mockNotificationsService.findForUser).toHaveBeenCalledWith('user-1', true, 2, 10);
    expect(res).toEqual({ data: [] });
  });

  it('getUnreadCount and its alias both delegate to getUnreadCount', async () => {
    mockNotificationsService.getUnreadCount.mockResolvedValue({ count: 3 });

    expect(await controller.getUnreadCount('user-1')).toEqual({ count: 3 });
    expect(await controller.getUnreadCountAlias('user-1')).toEqual({ count: 3 });
    expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledTimes(2);
    expect(mockNotificationsService.getUnreadCount).toHaveBeenCalledWith('user-1');
  });

  it('markRead delegates with notification id and user id', async () => {
    mockNotificationsService.markRead.mockResolvedValue({ id: 'n-1', read: true });

    const res = await controller.markRead('n-1', 'user-1');

    expect(mockNotificationsService.markRead).toHaveBeenCalledWith('n-1', 'user-1');
    expect(res).toEqual({ id: 'n-1', read: true });
  });

  it('markAllRead delegates with user id', async () => {
    mockNotificationsService.markAllRead.mockResolvedValue({ count: 5 });

    await controller.markAllRead('user-1');

    expect(mockNotificationsService.markAllRead).toHaveBeenCalledWith('user-1');
  });

  it('registerDeviceToken delegates with token and platform', async () => {
    mockNotificationsService.registerDeviceToken.mockResolvedValue({ id: 'd-1' });

    await controller.registerDeviceToken('user-1', 'tok', 'ios');

    expect(mockNotificationsService.registerDeviceToken).toHaveBeenCalledWith('user-1', 'tok', 'ios');
  });

  it('getPreferences delegates to getCurrentPreferenceSettings', async () => {
    mockNotificationsService.getCurrentPreferenceSettings.mockResolvedValue([]);

    await controller.getPreferences('user-1');

    expect(mockNotificationsService.getCurrentPreferenceSettings).toHaveBeenCalledWith('user-1');
  });

  it('updatePreference delegates with type and preferences', async () => {
    const type = Object.values(NotificationType)[0] as NotificationType;
    const prefs = { email: false, push: true };
    mockNotificationsService.updatePreference.mockResolvedValue({ type, ...prefs });

    await controller.updatePreference('user-1', type, prefs);

    expect(mockNotificationsService.updatePreference).toHaveBeenCalledWith('user-1', type, prefs);
  });

  it('updateDigestPreference delegates with emailEnabled flag', async () => {
    mockNotificationsService.updateDigestPreference.mockResolvedValue({ emailEnabled: false });

    await controller.updateDigestPreference('user-1', false);

    expect(mockNotificationsService.updateDigestPreference).toHaveBeenCalledWith('user-1', false);
  });

  it('is protected by JwtAuthGuard at the controller level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, NotificationsController)).toEqual([JwtAuthGuard]);
  });
});
