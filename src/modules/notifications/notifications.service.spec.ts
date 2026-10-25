import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../../common/queue/queue.service';
import { NotificationsService } from './notifications.service';

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: (...args: unknown[]) => mockSendMail(...args),
  })),
}));

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrisma = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    notificationPreference: {
      findMany: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    notificationDeviceToken: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    notificationDigestPreference: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockQueueService = {
    enqueueNotificationEmail: jest.fn(),
  };

  const configValues: Record<string, unknown> = {
    SMTP_HOST: 'smtp.test.local',
    SMTP_PORT: 587,
    SMTP_USER: 'mailer',
    SMTP_PASS: 'secret',
    PLATFORM_NAME: 'SorobanLard',
    EMAIL_FROM: 'noreply@sorobanlard.com',
    FIREBASE_FCM_URL: 'https://fcm.test.local/send',
  };

  const configGet = jest.fn((key: string, defaultValue?: unknown) =>
    configValues[key] !== undefined ? configValues[key] : defaultValue,
  );

  const mockFetch = jest.fn();
  const originalFetch = global.fetch;

  const allTypes = Object.values(NotificationType);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: QueueService, useValue: mockQueueService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);

    jest.clearAllMocks();

    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    configGet.mockImplementation((key: string, defaultValue?: unknown) =>
      configValues[key] !== undefined ? configValues[key] : defaultValue,
    );

    mockPrisma.notification.create.mockResolvedValue({ id: 'notif-1', read: false });
    mockPrisma.notification.findMany.mockResolvedValue([]);
    mockPrisma.notification.findUnique.mockResolvedValue(null);
    mockPrisma.notification.update.mockResolvedValue({ id: 'notif-1', read: true });
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.notification.count.mockResolvedValue(0);

    // `findMany` is used twice: once to discover existing types (with `select`)
    // and once to read the full preference rows.
    mockPrisma.notificationPreference.findMany.mockImplementation(
      async (args: any) =>
        args?.select
          ? allTypes.map((type) => ({ type }))
          : allTypes.map((type) => ({ type, email: true, push: true, inApp: true })),
    );
    mockPrisma.notificationPreference.create.mockResolvedValue({});
    mockPrisma.notificationPreference.upsert.mockResolvedValue({});
    mockPrisma.notificationDeviceToken.findUnique.mockResolvedValue(null);
    mockPrisma.notificationDeviceToken.findMany.mockResolvedValue([]);
    mockPrisma.notificationDeviceToken.update.mockResolvedValue({});
    mockPrisma.notificationDeviceToken.upsert.mockResolvedValue({});
    mockPrisma.notificationDigestPreference.findUnique.mockResolvedValue({ id: 'digest-1' });
    mockPrisma.notificationDigestPreference.create.mockResolvedValue({});
    mockPrisma.notificationDigestPreference.upsert.mockResolvedValue({});
    mockPrisma.notificationDigestPreference.findMany.mockResolvedValue([]);
    mockPrisma.notificationDigestPreference.update.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    mockPrisma.$transaction.mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg,
    );
    mockQueueService.enqueueNotificationEmail.mockResolvedValue({ id: 'job-1' });
    mockSendMail.mockResolvedValue({ messageId: 'mail-1' });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('notifyUser()', () => {
    it('creates the notification and enqueues an email job', async () => {
      const result = await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
        { courseId: 'course-1' },
      );

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: NotificationType.COURSE_APPROVED,
          title: 'Course approved',
          message: 'Your course is live',
          data: { courseId: 'course-1' },
        },
      });
      expect(mockQueueService.enqueueNotificationEmail).toHaveBeenCalledWith({
        userId: 'user-1',
        notificationId: 'notif-1',
        to: 'user@example.com',
        subject: 'Course approved',
        text: 'Your course is live',
        type: NotificationType.COURSE_APPROVED,
      });
      expect(result).toEqual({ id: 'notif-1', read: false, emailJobId: 'job-1' });
    });

    it('defaults the data payload to an empty object', async () => {
      await service.notifyUser('user-1', NotificationType.COURSE_APPROVED, 'T', 'M');

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ data: {} }),
      });
    });

    it('falls back to every channel enabled when the type has no stored preference', async () => {
      mockPrisma.notificationPreference.findMany.mockImplementation(async (args: any) =>
        args?.select
          ? allTypes.map((type) => ({ type }))
          : [
              {
                type: NotificationType.COURSE_REJECTED,
                email: false,
                push: false,
                inApp: false,
              },
            ],
      );

      await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(mockQueueService.enqueueNotificationEmail).toHaveBeenCalled();
    });

    it('skips the email job when the email channel is disabled', async () => {
      mockPrisma.notificationPreference.findMany.mockImplementation(async (args: any) =>
        args?.select
          ? allTypes.map((type) => ({ type }))
          : [
              {
                type: NotificationType.COURSE_APPROVED,
                email: false,
                push: true,
                inApp: true,
              },
            ],
      );

      const result = await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(mockQueueService.enqueueNotificationEmail).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'notif-1', read: false, emailJobId: undefined });
    });

    it('skips the email job when the user has no email address', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: null });

      const result = await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(mockQueueService.enqueueNotificationEmail).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'notif-1', read: false, emailJobId: undefined });
    });

    it('still returns the notification when the email job cannot be enqueued', async () => {
      mockQueueService.enqueueNotificationEmail.mockRejectedValueOnce(
        new Error('queue unavailable'),
      );

      const result = await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(result).toEqual({ id: 'notif-1', read: false, emailJobId: undefined });
    });

    it('swallows persistence errors instead of throwing', async () => {
      mockPrisma.notification.create.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.notifyUser('user-1', NotificationType.COURSE_APPROVED, 'T', 'M'),
      ).resolves.toBeUndefined();
    });

    it('pushes to registered devices when the push channel is enabled', async () => {
      configValues.FIREBASE_SERVER_KEY = 'server-key';
      mockPrisma.notificationDeviceToken.findMany.mockResolvedValueOnce([
        { token: 'device-token-1', platform: 'android' },
      ]);

      await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://fcm.test.local/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'key=server-key' }),
        }),
      );
      delete configValues.FIREBASE_SERVER_KEY;
    });

    it('skips push delivery when no device tokens are registered', async () => {
      configValues.FIREBASE_SERVER_KEY = 'server-key';

      await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(mockFetch).not.toHaveBeenCalled();
      delete configValues.FIREBASE_SERVER_KEY;
    });

    it('skips push delivery when the firebase server key is not configured', async () => {
      mockPrisma.notificationDeviceToken.findMany.mockResolvedValueOnce([
        { token: 'device-token-1', platform: 'android' },
      ]);

      await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not fail the notification when push delivery errors', async () => {
      configValues.FIREBASE_SERVER_KEY = 'server-key';
      mockPrisma.notificationDeviceToken.findMany.mockResolvedValueOnce([
        { token: 'device-token-1', platform: 'android' },
      ]);
      mockFetch.mockRejectedValueOnce(new Error('network down'));

      const result = await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(result).toEqual({ id: 'notif-1', read: false, emailJobId: 'job-1' });
      delete configValues.FIREBASE_SERVER_KEY;
    });

    it('does not fail the notification when the push provider rejects the request', async () => {
      configValues.FIREBASE_SERVER_KEY = 'server-key';
      mockPrisma.notificationDeviceToken.findMany.mockResolvedValueOnce([
        { token: 'device-token-1', platform: 'android' },
      ]);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(result).toEqual({ id: 'notif-1', read: false, emailJobId: 'job-1' });
      delete configValues.FIREBASE_SERVER_KEY;
    });

    it('defaults the push platform to mobile when the token has none', async () => {
      configValues.FIREBASE_SERVER_KEY = 'server-key';
      mockPrisma.notificationDeviceToken.findMany.mockResolvedValueOnce([
        { token: 'device-token-1' },
      ]);

      await service.notifyUser(
        'user-1',
        NotificationType.COURSE_APPROVED,
        'Course approved',
        'Your course is live',
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      delete configValues.FIREBASE_SERVER_KEY;
    });
  });

  describe('findForUser()', () => {
    it('returns paginated notifications with meta', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([{ id: 'notif-1' }]);
      mockPrisma.notification.count.mockResolvedValueOnce(1);

      const result = await service.findForUser('user-1');

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({
        data: [{ id: 'notif-1' }],
        meta: { total: 1, page: 1, limit: 20 },
      });
    });

    it('filters to unread notifications and honours pagination', async () => {
      await service.findForUser('user-1', true, 3, 5);

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', read: false },
          skip: 10,
          take: 5,
        }),
      );
    });
  });

  describe('getUnreadCount()', () => {
    it('counts the unread notifications of a user', async () => {
      mockPrisma.notification.count.mockResolvedValueOnce(4);

      await expect(service.getUnreadCount('user-1')).resolves.toEqual({
        count: 4,
        unreadCount: 4,
      });
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
      });
    });
  });

  describe('processEmailJob()', () => {
    it('sends the email and flags the notification as emailed', async () => {
      await service.processEmailJob({
        notificationId: 'notif-1',
        to: 'user@example.com',
        subject: 'Course approved',
        text: 'Your course is live',
        type: NotificationType.COURSE_APPROVED,
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('Course approved'),
          text: 'Your course is live',
        }),
      );
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { emailSent: true },
      });
    });

    it('does not flag the notification when the email send fails', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('smtp down'));

      await expect(
        service.processEmailJob({
          notificationId: 'notif-1',
          to: 'user@example.com',
          subject: 'Course approved',
          text: 'Your course is live',
          type: NotificationType.COURSE_APPROVED,
        }),
      ).rejects.toThrow('smtp down');
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });

    it('uses the generic emoji for a notification type without a dedicated one', async () => {
      await service.processEmailJob({
        notificationId: 'notif-1',
        to: 'user@example.com',
        subject: 'Lesson unlocked',
        text: 'A new lesson is ready',
        type: NotificationType.LESSON_UNLOCKED,
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringContaining('Lesson unlocked') }),
      );
    });
  });

  describe('markRead()', () => {
    it('rejects an unknown notification', async () => {
      mockPrisma.notification.findUnique.mockResolvedValueOnce(null);

      await expect(service.markRead('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('rejects a notification owned by another user', async () => {
      mockPrisma.notification.findUnique.mockResolvedValueOnce({
        id: 'notif-1',
        userId: 'user-2',
        read: false,
      });

      await expect(service.markRead('notif-1', 'user-1')).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });

    it('marks an unread notification as read and returns the unread count', async () => {
      mockPrisma.notification.findUnique.mockResolvedValueOnce({
        id: 'notif-1',
        userId: 'user-1',
        read: false,
      });
      mockPrisma.notification.count.mockResolvedValueOnce(3);

      const result = await service.markRead('notif-1', 'user-1');

      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { read: true },
      });
      expect(result).toEqual({
        success: true,
        notification: { id: 'notif-1', read: true },
        count: 3,
        unreadCount: 3,
      });
    });

    it('does not write again when the notification is already read', async () => {
      mockPrisma.notification.findUnique.mockResolvedValueOnce({
        id: 'notif-1',
        userId: 'user-1',
        read: true,
      });

      const result = await service.markRead('notif-1', 'user-1');

      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
      expect(result.notification).toEqual({ id: 'notif-1', userId: 'user-1', read: true });
    });
  });

  describe('markAllRead()', () => {
    it('marks every unread notification of the user as read', async () => {
      mockPrisma.notification.count.mockResolvedValueOnce(0);

      const result = await service.markAllRead('user-1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
        data: { read: true },
      });
      expect(result).toEqual({
        success: true,
        markedCount: 2,
        count: 0,
        unreadCount: 0,
      });
    });
  });

  describe('registerDeviceToken()', () => {
    it('rejects a malformed device token', async () => {
      await expect(service.registerDeviceToken('user-1', 'short')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.notificationDeviceToken.upsert).not.toHaveBeenCalled();
    });

    it('upserts a new device token', async () => {
      const result = await service.registerDeviceToken('user-1', 'device-token-1');

      expect(mockPrisma.notificationDeviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'device-token-1' },
        update: { userId: 'user-1', isActive: true, platform: 'mobile' },
        create: {
          userId: 'user-1',
          token: 'device-token-1',
          platform: 'mobile',
          isActive: true,
        },
      });
      expect(result).toEqual({
        registered: true,
        token: 'device-token-1',
        userId: 'user-1',
      });
    });

    it('reassigns a token that belongs to another user', async () => {
      mockPrisma.notificationDeviceToken.findUnique.mockResolvedValueOnce({
        id: 'token-1',
        userId: 'user-2',
      });

      const result = await service.registerDeviceToken('user-1', 'device-token-1', 'web');

      expect(mockPrisma.notificationDeviceToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: { userId: 'user-1', isActive: true, platform: 'web' },
      });
      expect(mockPrisma.notificationDeviceToken.upsert).not.toHaveBeenCalled();
      expect(result).toEqual({
        registered: true,
        token: 'device-token-1',
        userId: 'user-1',
      });
    });
  });

  describe('listActiveTokens()', () => {
    it('returns only the active tokens of the user', async () => {
      mockPrisma.notificationDeviceToken.findMany.mockResolvedValueOnce([
        { token: 'device-token-1', platform: 'android' },
      ]);

      await expect(service.listActiveTokens('user-1')).resolves.toEqual([
        { token: 'device-token-1', platform: 'android' },
      ]);
      expect(mockPrisma.notificationDeviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isActive: true },
        select: { token: true, platform: true },
      });
    });
  });

  describe('getPreferences()', () => {
    it('returns the stored channel preferences per notification type', async () => {
      const prefs = await service.getPreferences('user-1');

      expect(prefs[NotificationType.COURSE_APPROVED]).toEqual({
        email: true,
        push: true,
        inApp: true,
      });
    });

    it('creates the missing preference rows and the digest preference', async () => {
      mockPrisma.notificationPreference.findMany.mockImplementation(async (args: any) =>
        args?.select ? [{ type: NotificationType.COURSE_APPROVED }] : [],
      );
      mockPrisma.notificationDigestPreference.findUnique.mockResolvedValueOnce(null);

      await service.getPreferences('user-1');

      expect(mockPrisma.notificationPreference.create).toHaveBeenCalledTimes(
        allTypes.length - 1,
      );
      expect(mockPrisma.notificationDigestPreference.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', emailEnabled: true },
      });
    });
  });

  describe('updatePreference()', () => {
    it('rejects an unknown notification type', async () => {
      await expect(
        service.updatePreference('user-1', 'NOT_A_TYPE' as NotificationType, {}),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });

    it('upserts the preference with the supplied channels', async () => {
      await service.updatePreference('user-1', NotificationType.COURSE_APPROVED, {
        email: false,
      });

      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: { userId_type: { userId: 'user-1', type: NotificationType.COURSE_APPROVED } },
        update: { email: false, push: true, inApp: true },
        create: {
          userId: 'user-1',
          type: NotificationType.COURSE_APPROVED,
          email: false,
          push: true,
          inApp: true,
        },
      });
    });

    it('enables every channel that is not explicitly provided', async () => {
      await service.updatePreference('user-1', NotificationType.COURSE_APPROVED, {});

      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { email: true, push: true, inApp: true },
          create: expect.objectContaining({ email: true, push: true, inApp: true }),
        }),
      );
    });
  });

  describe('getCurrentPreferenceSettings()', () => {
    it('delegates to getPreferences()', async () => {
      const prefs = await service.getCurrentPreferenceSettings('user-1');

      expect(prefs[NotificationType.COURSE_APPROVED]).toEqual({
        email: true,
        push: true,
        inApp: true,
      });
    });
  });

  describe('updateDigestPreference()', () => {
    it('upserts the digest preference for the user', async () => {
      await service.updateDigestPreference('user-1', false);

      expect(mockPrisma.notificationDigestPreference.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { emailEnabled: false },
        create: { userId: 'user-1', emailEnabled: false },
      });
    });
  });

  describe('sendDailyDigest()', () => {
    it('emails a digest to users with unread notifications and stamps lastDigestAt', async () => {
      mockPrisma.notificationDigestPreference.findMany.mockResolvedValueOnce([
        {
          id: 'digest-1',
          userId: 'user-1',
          lastDigestAt: null,
          user: { name: 'Ada', email: 'user@example.com' },
        },
      ]);
      mockPrisma.notification.findMany.mockResolvedValueOnce([
        { title: 'Course approved', message: 'Your course is live' },
      ]);

      await service.sendDailyDigest();

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Your daily SorobanLard digest',
          text: 'You have 1 unread updates.',
        }),
      );
      expect(mockPrisma.notificationDigestPreference.update).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
        data: { lastDigestAt: expect.any(Date) },
      });
    });

    it('skips users without unread notifications', async () => {
      mockPrisma.notificationDigestPreference.findMany.mockResolvedValueOnce([
        {
          id: 'digest-1',
          userId: 'user-1',
          lastDigestAt: null,
          user: { name: 'Ada', email: 'user@example.com' },
        },
      ]);
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);

      await service.sendDailyDigest();

      expect(mockSendMail).not.toHaveBeenCalled();
      expect(mockPrisma.notificationDigestPreference.update).not.toHaveBeenCalled();
    });

    it('skips users without an email address', async () => {
      mockPrisma.notificationDigestPreference.findMany.mockResolvedValueOnce([
        {
          id: 'digest-1',
          userId: 'user-1',
          lastDigestAt: null,
          user: { name: null, email: null },
        },
      ]);
      mockPrisma.notification.findMany.mockResolvedValueOnce([
        { title: 'Course approved', message: 'Your course is live' },
      ]);

      await service.sendDailyDigest();

      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('keeps going when the digest email fails', async () => {
      mockPrisma.notificationDigestPreference.findMany.mockResolvedValueOnce([
        {
          id: 'digest-1',
          userId: 'user-1',
          lastDigestAt: null,
          user: { name: 'Ada', email: 'user@example.com' },
        },
      ]);
      mockPrisma.notification.findMany.mockResolvedValueOnce([
        { title: 'Course approved', message: 'Your course is live' },
      ]);
      mockSendMail.mockRejectedValueOnce(new Error('smtp down'));

      await expect(service.sendDailyDigest()).resolves.toBeUndefined();
      expect(mockPrisma.notificationDigestPreference.update).not.toHaveBeenCalled();
    });
  });

  describe('sendInvoiceEmail()', () => {
    it('sends the invoice with its PDF attachment', async () => {
      const buffer = Buffer.from('pdf');

      await expect(
        service.sendInvoiceEmail('user@example.com', 42, 'Tailoring Basics', buffer),
      ).resolves.toBe(true);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('Invoice #42'),
          attachments: [
            {
              filename: 'invoice-42.pdf',
              content: buffer,
              contentType: 'application/pdf',
            },
          ],
        }),
      );
    });

    it('returns false when the email cannot be sent', async () => {
      mockSendMail.mockRejectedValueOnce(new Error('smtp down'));

      await expect(
        service.sendInvoiceEmail('user@example.com', 42, 'Tailoring Basics', Buffer.from('pdf')),
      ).resolves.toBe(false);
    });
  });
});
