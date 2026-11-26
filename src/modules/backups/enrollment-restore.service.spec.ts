import { Test, TestingModule } from '@nestjs/testing';
import { EnrollmentRestoreService } from './enrollment-restore.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import {
  EnrollmentConflictStrategy,
  RestoreEnrollmentRecordDto,
  RestoreEnrollmentsDto,
} from './dto/restore-enrollments.dto';

describe('EnrollmentRestoreService', () => {
  let service: EnrollmentRestoreService;
  let prisma: {
    user: { findUnique: jest.Mock };
    course: { findUnique: jest.Mock };
  };
  let enrollments: { upsertFromBackup: jest.Mock };

  const buildRecord = (
    overrides: Partial<RestoreEnrollmentRecordDto> = {},
  ): RestoreEnrollmentRecordDto =>
    ({
      id: 'enr-1',
      studentId: 'student-1',
      courseId: 'course-1',
      amountPaid: 100,
      txHash: 'tx-1',
      status: 'ACTIVE',
      progressPercent: 50,
      completedAt: null,
      enrolledAt: '2024-01-01T00:00:00.000Z',
      lessonProgress: [],
      ...overrides,
    }) as RestoreEnrollmentRecordDto;

  const buildDto = (
    overrides: Partial<RestoreEnrollmentsDto> = {},
  ): RestoreEnrollmentsDto =>
    ({
      enrollments: [buildRecord()],
      ...overrides,
    }) as RestoreEnrollmentsDto;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      course: { findUnique: jest.fn() },
    };
    enrollments = { upsertFromBackup: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentRestoreService,
        { provide: PrismaService, useValue: prisma },
        { provide: EnrollmentsService, useValue: enrollments },
      ],
    }).compile();

    service = module.get<EnrollmentRestoreService>(EnrollmentRestoreService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('restore', () => {
    it('restores enrollments on the happy path', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'student-1' });
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        modules: [{ lessons: [{ id: 'lesson-1' }] }],
      });
      enrollments.upsertFromBackup.mockResolvedValue({
        action: 'created',
        enrollment: { id: 'enr-1' },
      });

      const report = await service.restore('admin-1', buildDto());

      expect(enrollments.upsertFromBackup).toHaveBeenCalledTimes(1);
      expect(report.counts.enrollmentsRequested).toBe(1);
      expect(report.counts.enrollmentsRestored).toBe(1);
      expect(report.counts.enrollmentsFailed).toBe(0);
      expect(report.succeeded).toEqual(['enr-1']);
      expect(report.failed).toEqual([]);
      expect(report.requestedBy).toBe('admin-1');
      expect(report.conflictStrategy).toBe(EnrollmentConflictStrategy.SKIP);
    });

    it('skips records that fail course-structure validation', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'student-1' });
      prisma.course.findUnique.mockResolvedValue(null);

      const report = await service.restore('admin-1', buildDto());

      expect(enrollments.upsertFromBackup).not.toHaveBeenCalled();
      expect(report.counts.validationFailures).toBe(1);
      expect(report.counts.enrollmentsSkipped).toBe(1);
      expect(report.counts.enrollmentsRestored).toBe(0);
      expect(report.failed).toHaveLength(1);
      expect(report.failed[0].id).toBe('enr-1');
      expect(report.issues[0].reason).toContain('Course does not exist');
    });

    it('records failures without aborting the batch (best-effort)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'student-1' });
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        modules: [],
      });
      enrollments.upsertFromBackup.mockRejectedValueOnce(
        new Error('FK violation'),
      );

      const report = await service.restore('admin-1', buildDto());

      expect(report.counts.enrollmentsFailed).toBe(1);
      expect(report.failed[0].reason).toBe('FK violation');
      expect(report.succeeded).toEqual([]);
    });

    it('counts overwritten enrollments when strategy is OVERWRITE', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'student-1' });
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        modules: [],
      });
      enrollments.upsertFromBackup.mockResolvedValue({
        action: 'overwritten',
        enrollment: { id: 'enr-1' },
      });

      const report = await service.restore(
        'admin-1',
        buildDto({ conflictStrategy: EnrollmentConflictStrategy.OVERWRITE }),
      );

      expect(report.counts.enrollmentsOverwritten).toBe(1);
      expect(report.counts.enrollmentsRestored).toBe(1);
      expect(report.conflictStrategy).toBe(EnrollmentConflictStrategy.OVERWRITE);
    });
  });

  describe('reports', () => {
    it('stores and retrieves reports by id', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'student-1' });
      prisma.course.findUnique.mockResolvedValue({
        id: 'course-1',
        modules: [],
      });
      enrollments.upsertFromBackup.mockResolvedValue({
        action: 'created',
        enrollment: { id: 'enr-1' },
      });

      const report = await service.restore('admin-1', buildDto());

      expect(service.getReport(report.id)).toBe(report);
      expect(service.listReports()).toContain(report);
    });
  });
});
