import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { LiveSessionStatus } from '@prisma/client';
import { LiveSessionsService } from './live-sessions.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('LiveSessionsService', () => {
  let service: LiveSessionsService;
  let prisma: {
    course: { findUnique: jest.Mock };
    liveSession: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const instructorAddress = 'GINSTRUCTORADDRESS';
  const course = {
    id: 'course-1',
    instructorAddress,
    instructor: { id: 'user-1' },
  };

  beforeEach(async () => {
    prisma = {
      course: { findUnique: jest.fn() },
      liveSession: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveSessionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LiveSessionsService>(LiveSessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scheduleSession', () => {
    const dto = {
      courseId: 'course-1',
      title: 'Intro to Stellar',
      scheduledAt: '2030-01-01T10:00:00.000Z',
      durationMinutes: 60,
    } as any;

    it('schedules a session when the instructor is available', async () => {
      prisma.course.findUnique.mockResolvedValue(course);
      prisma.liveSession.findMany.mockResolvedValue([]);
      const created = { id: 'session-1', ...dto };
      prisma.liveSession.create.mockResolvedValue(created);

      const result = await service.scheduleSession(
        { id: 'user-1', stellarAddress: instructorAddress },
        dto,
      );

      expect(prisma.liveSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            courseId: 'course-1',
            status: LiveSessionStatus.SCHEDULED,
            durationMinutes: 60,
          }),
        }),
      );
      expect(result).toBe(created);
    });

    it('throws NotFoundException when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(
        service.scheduleSession({ id: 'user-1' }, dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when the user is not the instructor', async () => {
      prisma.course.findUnique.mockResolvedValue(course);

      await expect(
        service.scheduleSession(
          { id: 'other-user', stellarAddress: 'GOTHER' },
          dto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ConflictException when the instructor has an overlapping session', async () => {
      prisma.course.findUnique.mockResolvedValue(course);
      prisma.liveSession.findMany.mockResolvedValue([
        {
          id: 'existing',
          title: 'Overlap',
          scheduledAt: new Date('2030-01-01T10:30:00.000Z'),
          durationMinutes: 60,
        },
      ]);

      await expect(
        service.scheduleSession(
          { id: 'user-1', stellarAddress: instructorAddress },
          dto,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updateSession', () => {
    const existing = {
      id: 'session-1',
      title: 'Old title',
      description: 'desc',
      scheduledAt: new Date('2030-01-01T10:00:00.000Z'),
      durationMinutes: 60,
      capacity: 50,
      meetingUrl: 'https://meet.example.com',
      status: LiveSessionStatus.SCHEDULED,
      instructorAddress,
      course: { instructorAddress },
    };

    it('updates session details for the instructor', async () => {
      prisma.liveSession.findUnique.mockResolvedValue(existing);
      prisma.liveSession.update.mockResolvedValue({
        ...existing,
        title: 'New title',
      });

      const result = await service.updateSession(
        { stellarAddress: instructorAddress },
        'session-1',
        { title: 'New title' } as any,
      );

      expect(prisma.liveSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'session-1' } }),
      );
      expect(result.title).toBe('New title');
    });

    it('marks the session as RESCHEDULED when the time changes', async () => {
      prisma.liveSession.findUnique.mockResolvedValue(existing);
      prisma.liveSession.findMany.mockResolvedValue([]);
      prisma.liveSession.update.mockResolvedValue({
        ...existing,
        status: LiveSessionStatus.RESCHEDULED,
      });

      await service.updateSession(
        { stellarAddress: instructorAddress },
        'session-1',
        { scheduledAt: '2030-02-01T10:00:00.000Z' } as any,
      );

      expect(prisma.liveSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LiveSessionStatus.RESCHEDULED,
          }),
        }),
      );
    });

    it('throws NotFoundException when the session does not exist', async () => {
      prisma.liveSession.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSession(
          { stellarAddress: instructorAddress },
          'missing',
          {} as any,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when the user is not the instructor', async () => {
      prisma.liveSession.findUnique.mockResolvedValue(existing);

      await expect(
        service.updateSession(
          { stellarAddress: 'GOTHER', id: 'other-user' },
          'session-1',
          {} as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('cancelSession', () => {
    it('delegates to updateSession with CANCELLED status', async () => {
      const spy = jest
        .spyOn(service, 'updateSession')
        .mockResolvedValue({ id: 'session-1' } as any);

      await service.cancelSession(
        { stellarAddress: instructorAddress },
        'session-1',
      );

      expect(spy).toHaveBeenCalledWith(
        { stellarAddress: instructorAddress },
        'session-1',
        { status: LiveSessionStatus.CANCELLED },
      );
    });
  });

  describe('getUpcomingSessions', () => {
    it('filters by course and instructor when provided', async () => {
      prisma.liveSession.findMany.mockResolvedValue([]);

      await service.getUpcomingSessions('course-1', instructorAddress);

      expect(prisma.liveSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courseId: 'course-1',
            instructorAddress,
            status: {
              in: [
                LiveSessionStatus.SCHEDULED,
                LiveSessionStatus.RESCHEDULED,
              ],
            },
          }),
          orderBy: { scheduledAt: 'asc' },
        }),
      );
    });
  });

  describe('getSessionById', () => {
    it('returns the session when found', async () => {
      const session = { id: 'session-1' };
      prisma.liveSession.findUnique.mockResolvedValue(session);

      await expect(service.getSessionById('session-1')).resolves.toBe(session);
    });

    it('throws NotFoundException when the session does not exist', async () => {
      prisma.liveSession.findUnique.mockResolvedValue(null);

      await expect(service.getSessionById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
