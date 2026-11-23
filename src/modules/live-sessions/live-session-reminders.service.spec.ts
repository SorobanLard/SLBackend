import { Test, TestingModule } from '@nestjs/testing';
import { LiveSessionStatus, NotificationType } from '@prisma/client';
import { LiveSessionRemindersService } from './live-session-reminders.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('LiveSessionRemindersService', () => {
  let service: LiveSessionRemindersService;

  const mockPrisma = {
    liveSession: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockNotifications = {
    notifyUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveSessionRemindersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<LiveSessionRemindersService>(LiveSessionRemindersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleUpcomingSessionReminders()', () => {
    it('returns zero counts when no upcoming sessions require reminders', async () => {
      mockPrisma.liveSession.findMany.mockResolvedValue([]);

      const result = await service.handleUpcomingSessionReminders();

      expect(result).toEqual({ sessionsProcessed: 0, notificationsSent: 0 });
      expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
      expect(mockPrisma.liveSession.update).not.toHaveBeenCalled();
    });

    it('sends reminders to active enrolled students and marks reminderSent = true', async () => {
      const scheduledAt = new Date(Date.now() + 30 * 60 * 1000);
      mockPrisma.liveSession.findMany.mockResolvedValue([
        {
          id: 'session-1',
          courseId: 'course-1',
          title: 'Deep Dive into Soroban Storage',
          scheduledAt,
          meetingUrl: 'https://meet.sorobanlard.test/live-1',
          status: LiveSessionStatus.SCHEDULED,
          reminderSent: false,
          course: {
            title: 'Soroban Mastery',
            enrollments: [
              { student: { id: 'student-1' } },
              { student: { id: 'student-2' } },
            ],
          },
        },
      ]);
      mockNotifications.notifyUser.mockResolvedValue({});
      mockPrisma.liveSession.update.mockResolvedValue({});

      const result = await service.handleUpcomingSessionReminders();

      expect(result).toEqual({ sessionsProcessed: 1, notificationsSent: 2 });
      expect(mockNotifications.notifyUser).toHaveBeenCalledTimes(2);
      expect(mockNotifications.notifyUser).toHaveBeenCalledWith(
        'student-1',
        NotificationType.LIVE_SESSION_REMINDER,
        '⏰ Upcoming Live Session Reminder',
        expect.stringContaining('Deep Dive into Soroban Storage'),
        expect.objectContaining({
          sessionId: 'session-1',
          courseId: 'course-1',
          meetingUrl: 'https://meet.sorobanlard.test/live-1',
        }),
      );
      expect(mockPrisma.liveSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { reminderSent: true },
      });
    });

    it('continues notifying remaining students and marks session updated even if one notification fails', async () => {
      const scheduledAt = new Date(Date.now() + 20 * 60 * 1000);
      mockPrisma.liveSession.findMany.mockResolvedValue([
        {
          id: 'session-2',
          courseId: 'course-1',
          title: 'Rescheduled Workshop',
          scheduledAt,
          meetingUrl: 'https://meet.sorobanlard.test/live-2',
          status: LiveSessionStatus.RESCHEDULED,
          reminderSent: false,
          course: {
            title: 'Soroban Mastery',
            enrollments: [
              { student: { id: 'student-fail' } },
              { student: { id: 'student-ok' } },
            ],
          },
        },
      ]);
      mockNotifications.notifyUser
        .mockRejectedValueOnce(new Error('Notification service timeout'))
        .mockResolvedValueOnce({});
      mockPrisma.liveSession.update.mockResolvedValue({});

      const result = await service.handleUpcomingSessionReminders();

      expect(result).toEqual({ sessionsProcessed: 1, notificationsSent: 1 });
      expect(mockNotifications.notifyUser).toHaveBeenCalledTimes(2);
      expect(mockPrisma.liveSession.update).toHaveBeenCalledWith({
        where: { id: 'session-2' },
        data: { reminderSent: true },
      });
    });

    it('skips sessions whose status is CANCELLED', async () => {
      mockPrisma.liveSession.findMany.mockResolvedValue([
        {
          id: 'session-cancelled',
          courseId: 'course-1',
          title: 'Cancelled Session',
          scheduledAt: new Date(),
          status: LiveSessionStatus.CANCELLED,
          course: { title: 'Course', enrollments: [{ student: { id: 's1' } }] },
        },
      ]);

      const result = await service.handleUpcomingSessionReminders();

      expect(result).toEqual({ sessionsProcessed: 1, notificationsSent: 0 });
      expect(mockNotifications.notifyUser).not.toHaveBeenCalled();
      expect(mockPrisma.liveSession.update).not.toHaveBeenCalled();
    });
  });
});
