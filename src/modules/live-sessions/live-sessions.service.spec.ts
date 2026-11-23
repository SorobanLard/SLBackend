import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LiveSessionStatus } from '@prisma/client';
import { LiveSessionsService } from './live-sessions.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('LiveSessionsService', () => {
  let service: LiveSessionsService;

  const mockPrisma = {
    course: {
      findUnique: jest.fn(),
    },
    liveSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockCourse = {
    id: 'course-1',
    title: 'Soroban Live Bootcamp',
    instructorAddress: 'GINSTRUCTOR123',
    instructor: { id: 'inst-user-1' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiveSessionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<LiveSessionsService>(LiveSessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scheduleSession()', () => {
    const dto = {
      courseId: 'course-1',
      title: 'Office Hours #1',
      description: 'Live Q&A',
      scheduledAt: '2026-12-01T10:00:00.000Z',
      durationMinutes: 60,
      capacity: 100,
      meetingUrl: 'https://meet.sorobanlard.test/room-1',
    };

    it('schedules a new live session when user is the course instructor and no overlap exists', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);
      mockPrisma.liveSession.findMany.mockResolvedValue([]);
      mockPrisma.liveSession.create.mockResolvedValue({
        id: 'session-1',
        ...dto,
        instructorAddress: 'GINSTRUCTOR123',
        scheduledAt: new Date(dto.scheduledAt),
        status: LiveSessionStatus.SCHEDULED,
      });

      const result = await service.scheduleSession(
        { id: 'inst-user-1', stellarAddress: 'GINSTRUCTOR123' },
        dto as any,
      );

      expect(result.id).toBe('session-1');
      expect(mockPrisma.liveSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courseId: 'course-1',
          instructorAddress: 'GINSTRUCTOR123',
          title: 'Office Hours #1',
          status: LiveSessionStatus.SCHEDULED,
        }),
      });
    });

    it('throws NotFoundException when course does not exist', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(null);

      await expect(
        service.scheduleSession({ id: 'inst-user-1' }, dto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when caller is not the course instructor', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);

      await expect(
        service.scheduleSession(
          { id: 'other-user', stellarAddress: 'GOTHER' },
          dto as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when instructor has an overlapping active session', async () => {
      mockPrisma.course.findUnique.mockResolvedValue(mockCourse);
      mockPrisma.liveSession.findMany.mockResolvedValue([
        {
          id: 'existing-session',
          title: 'Overlapping Session',
          scheduledAt: new Date('2026-12-01T10:30:00.000Z'),
          durationMinutes: 60,
        },
      ]);

      await expect(
        service.scheduleSession(
          { id: 'inst-user-1', stellarAddress: 'GINSTRUCTOR123' },
          dto as any,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateSession() & cancelSession()', () => {
    const existingSession = {
      id: 'session-1',
      courseId: 'course-1',
      instructorAddress: 'GINSTRUCTOR123',
      title: 'Office Hours #1',
      description: 'Live Q&A',
      scheduledAt: new Date('2026-12-01T10:00:00.000Z'),
      durationMinutes: 60,
      capacity: 50,
      meetingUrl: 'https://meet.sorobanlard.test/room-1',
      status: LiveSessionStatus.SCHEDULED,
      course: { instructorAddress: 'GINSTRUCTOR123' },
    };

    it('reschedules session and transitions status to RESCHEDULED when scheduledAt changes', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue(existingSession);
      mockPrisma.liveSession.findMany.mockResolvedValue([]);
      mockPrisma.liveSession.update.mockResolvedValue({
        ...existingSession,
        scheduledAt: new Date('2026-12-02T10:00:00.000Z'),
        status: LiveSessionStatus.RESCHEDULED,
      });

      const result = await service.updateSession(
        { stellarAddress: 'GINSTRUCTOR123' },
        'session-1',
        { scheduledAt: '2026-12-02T10:00:00.000Z' } as any,
      );

      expect(result.status).toBe(LiveSessionStatus.RESCHEDULED);
      expect(mockPrisma.liveSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'session-1' },
          data: expect.objectContaining({
            status: LiveSessionStatus.RESCHEDULED,
          }),
        }),
      );
    });

    it('throws NotFoundException when updating a non-existent session', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSession({ stellarAddress: 'GINSTRUCTOR123' }, 'missing', {} as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when non-instructor attempts to update session', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue(existingSession);

      await expect(
        service.updateSession({ id: 'stranger', stellarAddress: 'GSTRANGER' }, 'session-1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cancels a session via cancelSession()', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValue(existingSession);
      mockPrisma.liveSession.update.mockResolvedValue({
        ...existingSession,
        status: LiveSessionStatus.CANCELLED,
      });

      const result = await service.cancelSession(
        { stellarAddress: 'GINSTRUCTOR123' },
        'session-1',
      );
      expect(result.status).toBe(LiveSessionStatus.CANCELLED);
    });
  });

  describe('getUpcomingSessions() & getSessionById()', () => {
    it('filters upcoming sessions by courseId and instructorAddress', async () => {
      mockPrisma.liveSession.findMany.mockResolvedValue([{ id: 'session-1' }]);

      const res = await service.getUpcomingSessions('course-1', 'GINSTRUCTOR123');
      expect(res).toHaveLength(1);
      expect(mockPrisma.liveSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            courseId: 'course-1',
            instructorAddress: 'GINSTRUCTOR123',
          }),
        }),
      );
    });

    it('returns session by id or throws NotFoundException', async () => {
      mockPrisma.liveSession.findUnique.mockResolvedValueOnce({ id: 'session-1' });
      await expect(service.getSessionById('session-1')).resolves.toEqual({ id: 'session-1' });

      mockPrisma.liveSession.findUnique.mockResolvedValueOnce(null);
      await expect(service.getSessionById('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
