import { Test, TestingModule } from '@nestjs/testing';
import { LiveSessionRemindersService } from './live-session-reminders.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('LiveSessionRemindersService', () => {
  let service: LiveSessionRemindersService;
  let prisma: {
    liveSession: {
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let notifications: { send: jest.Mock };

  beforeEach(async () => {
    prisma = {
      liveSession: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    notifications = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveSessionRemindersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<LiveSessionRemindersService>(LiveSessionRemindersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendDueReminders', () => {
    it('dispatches reminders for upcoming sessions and marks them as sent', async () => {
      const session = {
        id: 'session-1',
        title: 'Intro to Stellar',
        startsAt: new Date(Date.now() + 15 * 60 * 1000),
        reminderSentAt: null,
        status: 'SCHEDULED',
        attendees: [{ userId: 'user-1' }],
      };
      prisma.liveSession.findMany.mockResolvedValue([session]);
      prisma.liveSession.update.mockResolvedValue({ ...session, reminderSentAt: new Date() });
      notifications.send.mockResolvedValue(undefined);

      await service.sendDueReminders();

      expect(prisma.liveSession.findMany).toHaveBeenCalled();
      expect(notifications.send).toHaveBeenCalledTimes(1);
      expect(prisma.liveSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: session.id },
          data: expect.objectContaining({ reminderSentAt: expect.any(Date) }),
        }),
      );
    });

    it('does nothing when there are no due sessions', async () => {
      prisma.liveSession.findMany.mockResolvedValue([]);

      await service.sendDueReminders();

      expect(notifications.send).not.toHaveBeenCalled();
      expect(prisma.liveSession.update).not.toHaveBeenCalled();
    });

    it('skips sessions that already had a reminder sent', async () => {
      const session = {
        id: 'session-2',
        title: 'Advanced Soroban',
        startsAt: new Date(Date.now() + 10 * 60 * 1000),
        reminderSentAt: new Date(),
        status: 'SCHEDULED',
        attendees: [{ userId: 'user-2' }],
      };
      prisma.liveSession.findMany.mockResolvedValue([session]);

      await service.sendDueReminders();

      expect(notifications.send).not.toHaveBeenCalled();
      expect(prisma.liveSession.update).not.toHaveBeenCalled();
    });

    it('propagates errors from the notification service', async () => {
      const session = {
        id: 'session-3',
        title: 'Error Case',
        startsAt: new Date(Date.now() + 5 * 60 * 1000),
        reminderSentAt: null,
        status: 'SCHEDULED',
        attendees: [{ userId: 'user-3' }],
      };
      prisma.liveSession.findMany.mockResolvedValue([session]);
      notifications.send.mockRejectedValue(new Error('notification failure'));

      await expect(service.sendDueReminders()).rejects.toThrow('notification failure');
      expect(prisma.liveSession.update).not.toHaveBeenCalled();
    });
  });
});
