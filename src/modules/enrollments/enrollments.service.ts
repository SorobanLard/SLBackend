import {
  Injectable, NotFoundException, ConflictException, Logger, HttpException,
  ForbiddenException, Inject, forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from '../invoices/invoices.service';
import { ReferralsService } from '../referrals/referrals.service';
import { NotificationType, Prisma } from '@prisma/client';
import { FraudDetectionService } from './fraud-detection.service';
import { DripScheduleService } from '../lessons/drip-schedule.service';

@Injectable()
export class EnrollmentsService {
  private readonly logger = new Logger(EnrollmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly invoices: InvoicesService,
    private readonly fraudDetection: FraudDetectionService,
    private readonly referrals: ReferralsService,
    @Inject(forwardRef(() => DripScheduleService))
    private readonly dripSchedule: DripScheduleService,
  ) {}

  /**
   * Register an enrollment in the DB after the student has submitted
   * the enroll() transaction on-chain via Freighter.
   * The backend receives the txHash and registers the enrollment.
   */
  async create(studentId: string, courseId: string, txHash: string, amountPaid: number) {
    const existing = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });
    if (existing) throw new ConflictException('Already enrolled in this course');

    // ------------------------------------------------------------------
    // PRE-CHECK #1: Enforce course prerequisites (issue #24). The student
    // must have a COMPLETED enrollment for every configured prerequisite
    // before any on-chain enrollment is registered.
    // ------------------------------------------------------------------
    const prereqCheck = await this.checkPrerequisites(studentId, courseId);
    if (!prereqCheck.eligible) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Prerequisites Not Met',
        message:
          'You must complete the prerequisite courses below before enrolling ' +
          'in this course.',
        missingPrerequisites: prereqCheck.missing,
      });
    }

    // ------------------------------------------------------------------
    // PRE-CHECK #2: Run fraud scoring before writing the enrollment to DB.
    // If the score is CRITICAL the enrollment is blocked entirely (HOLD).
    // We call processFraudCheck with null enrollmentId so a HELD flag row
    // is persisted in the DB for admin review before the 423 is thrown.
    // ------------------------------------------------------------------
    const fraudResult = await this.fraudDetection.processFraudCheck(
      null,
      studentId,
      courseId,
      amountPaid,
    );

    if (fraudResult.action === 'HOLD') {
      this.logger.warn(
        `Enrollment BLOCKED by fraud detection: student=${studentId} ` +
        `course=${courseId} score=${fraudResult.score} reasons=${fraudResult.reasons.join(', ')}`,
      );
      // HTTP 423 Locked — enrollment is on automatic hold
      throw new HttpException(
        {
          statusCode: 423,
          error: 'Enrollment Locked',
          message:
            'Your enrollment has been flagged and placed on hold pending a fraud review. ' +
            'Please contact support if you believe this is an error.',
          riskScore: fraudResult.score,
          reasons:   fraudResult.reasons,
          flagId:    fraudResult.flagId,
        },
        423,
      );
    }

    // ------------------------------------------------------------------
    // Create enrollment record
    // ------------------------------------------------------------------
    let enrollment;
    try {
      enrollment = await this.prisma.enrollment.create({
        data: {
          studentId,
          courseId,
          txHash,
          amountPaid,
        },
        include: { course: true, student: true },
      });
    } catch (error) {
      // ------------------------------------------------------------------
      // Handle concurrent duplicate enrollment attempts (issue #145).
      // The @@unique([studentId, courseId]) constraint on Enrollment guards
      // against races; a losing request surfaces as Prisma P2002. Translate
      // it into a clear 409 Conflict instead of a generic 500.
      // ------------------------------------------------------------------
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          `Duplicate enrollment attempt: student=${studentId} course=${courseId}`,
        );
        throw new ConflictException('Already enrolled in this course');
      }
      throw error;
    }

    // ------------------------------------------------------------------
    // POST-CHECK: Persist fraud flag if score is HIGH (FLAG action).
    // Runs fire-and-forget — a flag failure must not break the enrollment.
    // ------------------------------------------------------------------
    if (fraudResult.action === 'FLAG') {
      this.fraudDetection
        .processFraudCheck(enrollment.id, studentId, courseId, amountPaid)
        .catch((err: Error) =>
          this.logger.error(
            `Fraud flag persistence failed for enrollment ${enrollment.id}: ${err.message}`,
          ),
        );
    }

    // Update course stats
    await this.prisma.course.update({
      where: { id: courseId },
      data: {
        totalEnrollments: { increment: 1 },
        totalRevenue:     { increment: amountPaid },
      },
    });

    // Notify student
    await this.notifications.notifyUser(
      studentId,
      NotificationType.ENROLLMENT_CONFIRMED,
      'Enrollment confirmed!',
      `You are now enrolled in "${enrollment.course.title}". Start learning at your own pace.`,
      { courseId, txHash },
    );

    // Notify instructor
    const instructor = await this.prisma.user.findUnique({
      where: { stellarAddress: enrollment.course.instructorAddress },
    });
    if (instructor) {
      await this.notifications.notifyUser(
        instructor.id,
        NotificationType.NEW_ENROLLMENT,
        'New student enrolled',
        `A new student has enrolled in "${enrollment.course.title}".`,
        { courseId },
      );
    }

    try {
      await this.invoices.generateForEnrollment(enrollment.id);
    } catch (error) {
      this.logger.error(`Invoice generation failed for enrollment ${enrollment.id}`, error.message);
    }

    // Track referral conversion + issue referrer reward (idempotent if not referred)
    try {
      await this.referrals.trackConversion(studentId, enrollment.id);
    } catch (error) {
      this.logger.warn(`Referral conversion tracking failed for ${studentId}: ${error.message}`);
    }

    // Initialize drip content unlock schedule for enrollment
    try {
      await this.dripSchedule.calculateAndSyncUnlockSchedule(enrollment.id);
    } catch (error) {
      this.logger.error(`Drip schedule initialization failed for enrollment ${enrollment.id}`, error.message);
    }

    this.logger.log(`Enrollment created: ${studentId} → ${courseId}`);
    return enrollment;
  }

  async findByStudent(studentId: string, page = 1, limit = 20) {
    const [enrollments, total] = await this.prisma.$transaction([
      this.prisma.enrollment.findMany({
        where: { studentId },
        include: {
          course: {
            include: { instructor: { select: { name: true, avatarUrl: true } } },
          },
        },
        orderBy: { enrolledAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.enrollment.count({ where: { studentId } }),
    ]);
    return { data: enrollments, meta: { total, page, limit } };
  }

  async findOne(studentId: string, courseId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      include: {
        course: {
          include: {
            modules: {
              orderBy: { position: 'asc' },
              include: { lessons: { orderBy: { position: 'asc' } } },
            },
          },
        },
        lessonProgress: true,
      },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    return enrollment;
  }

  async isEnrolled(studentId: string, courseId: string): Promise<boolean> {
    const count = await this.prisma.enrollment.count({
      where: { studentId, courseId },
    });
    return count > 0;
  }

  // ----------------------------------------------------------
 

/* … truncated 4549 chars — edit only what you need near the top … */
