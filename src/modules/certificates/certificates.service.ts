import {
  Injectable, NotFoundException, ForbiddenException, Logger,
  BadRequestException, GoneException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExamsService } from '../exams/exams.service';
import { NotificationType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { CERTIFICATE_PDF_QUEUE, CERTIFICATE_PDF_JOB } from '../../common/queue/queue.constants';

/** Max attempts for on-chain issuance before marking the certificate FAILED. */
const MAX_ISSUANCE_ATTEMPTS = 3;
/** Base delay (ms) for exponential backoff between issuance attempts. */
const ISSUANCE_BACKOFF_BASE_MS = 500;

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly notifications: NotificationsService,
    private readonly examsService: ExamsService,
    @InjectQueue(CERTIFICATE_PDF_QUEUE) private readonly pdfQueue: Queue,
  ) {}

  /**
   * Issue a certificate for a student who has completed a course.
   *
   * Flow:
   *  1. Verify the student's enrollment is COMPLETED (100% progress)
   *  2. Verify student passed the required certification exam (if one exists)
   *  3. Verify no certificate already exists
   *  4. Store the certificate record in the DB
   *  5. Generate and store the PDF certificate
   *  6. The frontend/admin wallet then calls issue_certificate() on-chain
   *     and sends back the txHash to update the DB record
   *  7. Notify the student
   */
  async issue(adminId: string, studentId: string, courseId: string): Promise<any> {
    // Verify enrollment exists and is completed
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      include: { course: true, student: true },
    });

    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status !== 'COMPLETED') {
      throw new ForbiddenException('Student has not completed this course yet');
    }

    // Verify certification exam has been passed (if exam exists)
    const passedExam = await this.examsService.hasPassedExam(studentId, courseId);
    if (!passedExam) {
      throw new ForbiddenException('Student has not passed the required certification exam for this course');
    }

    // Check for existing certificate
    const existing = await this.prisma.certificate.findFirst({
      where: { studentId, courseId },
    });
    if (existing) throw new ForbiddenException('Certificate already issued for this enrollment');

    // Generate a unique certificate ID
    const certificateId = `CERT-${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

    // Create DB record
    const certificate = await this.prisma.certificate.create({
      data: {
        id:                certificateId,
        studentId,
        courseId,
        courseTitle:       enrollment.course.title,
        instructorAddress: enrollment.course.instructorAddress,
      },
      include: { student: true, course: true },
    });

    // Durable processing is handled by the BullMQ worker, not the HTTP request.
    // A deterministic job id prevents duplicate PDF jobs on repeated calls.
    await this.pdfQueue.add(
      CERTIFICATE_PDF_JOB,
      { certificateId },
      { jobId: certificateId, attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
    );

    this.logger.log(`Certificate issued: ${certificateId} for student ${studentId}, PDF generation queued`);

    // Trigger on-chain issuance with retry/backoff. On exhausted retries the
    // certificate is persisted as FAILED so the scheduled job can retry it
    // instead of leaving the course complete with no certificate.
    await this.attemptOnChainIssuance(certificateId);

    await this.notifications.notifyUser(
      studentId,
      NotificationType.CERTIFICATE_ISSUED,
      '🎓 Certificate Issued!',
      `Congratulations! Your certificate for "${enrollment.course.title}" has been issued.`,
      { certificateId, courseId },
    );

    return { ...certificate, pdfStatus: 'queued' };
  }

  /**
   * Attempt on-chain issuance with retry-with-backoff. Persists the issuance
   * state (PENDING/FAILED/ISSUED) on the certificate record so transient
   * Stellar RPC downtime never silently drops a certificate.
   */
  private async attemptOnChainIssuance(certificateId: string): Promise<void> {
    await this.prisma.certificate.update({
      where: { id: certificateId },
      data: { issuanceStatus: 'PENDING', issuanceAttempts: 0, lastIssuanceError: null },
    });

    for (let attempt = 1; attempt <= MAX_ISSUANCE_ATTEMPTS; attempt++) {
      try {
        await this.stellar.issueCertificateOnChain(certificateId);
        await this.prisma.certificate.update({
          where: { id: certificateId },
          data: { issuanceStatus: 'ISSUED', issuanceAttempts: attempt, lastIssuanceError: null },
        });
        this.logger.log(`On-chain issuance succeeded for ${certificateId} (attempt ${attempt})`);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `On-chain issuance attempt ${attempt}/${MAX_ISSUANCE_ATTEMPTS} failed for ${certificateId}: ${message}`,
        );

        if (attempt < MAX_ISSUANCE_ATTEMPTS) {
          const delay = ISSUANCE_BACKOFF_BASE_MS * 2 ** (attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          await this.prisma.certificate.update({
            where: { id: certificateId },
            data: { issuanceStatus: 'FAILED', issuanceAttempts: attempt, lastIssuanceError: message },
          });
          this.logger.error(
            `On-chain issuance exhausted retries for ${certificateId}; marked FAILED for scheduled retry`,
          );
        }
      }
    }
  }

  /**
   * Scheduled job that retries certificates whose on-chain issuance is still
   * PENDING or has FAILED, so transient Stellar RPC downtime self-heals.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPendingIssuances(): Promise<void> {
    const pending = await this.prisma.certificate.findMany({
      where: { issuanceStatus: { in: ['PENDING', 'FAILED'] }, isRevoked: false },
      select: { id: true },
      take: 50,
    });

    if (pending.length === 0) return;
    this.logger.log(`Retrying on-chain issuance for ${pending.length} certificate(s)`);

    for (const { id } of pending) {
      await this.attemptOnChainIssuance(id);
    }
  }

  /** Update the txHash after the admin calls issue_certificate() on-chain */
  async updateTxHash(certificateId: string, txHash: string) {
    return this.prisma.certificate.update({
      where: { id: certificateId },
      data: { txHash, issuanceStatus: 'ISSUED' },
    });
  }

  async findByStudent(studentId: string) {
    return this.prisma.certificate.findMany({
      where: { studentId },
      include: { course: { include: { instructor: { select: { name: true } } } } },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async findById(certificateId: string) {
    const cert = await this.prisma.certificate.findUnique({
      where: { id: certificateId },
      include: {
        student: { select: { id: true, name: true, stellarAddress: true } },
        course:  { include: { instructor: { select: { name: true, stellarAddress: true } } } },
        revokedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    return cert;
  }

  /**
   * Public verification endpoint — checks both DB and on-chain state.
   *
   * Returns a distinct state for each outcome:
   *  - VALID:       certificate exists, is not revoked/fraud-held, and is valid on-chain
   *  - REVOKED:     certificate exists but has been revoked (410 Gone)
   *  - FRAUD_HELD:  certificate exists but is flagged as fraud-held (410 Gone)
   *  - NOT_FOUND:   certificate does not exist (404)
   */
  async verify(certificateId: string) {
    const cert = await this.findById(certificateId);

    if (cert.isRevoked) {
      throw new GoneException({
        status: 'REVOKED',
        valid: false,
        reason: 'Certificate has been revoked',
        revokedAt: cert.revokedAt ?? null,
        revokeReason: cert.revokeReason ?? null,
        certificate: null,
      });
    }

    if (cert.isFraudHeld) {
      throw new GoneException({
        status: 'FRAUD_HELD',
        valid: false,
        reason: 'Certificate is held pending fraud investigation',
        certificate: null,
      });
    }

    // Cross-check with on-chain state
    const onChainValid = await this.stellar.verifyCertificateOnChain(certificateId);
    if (!onChainValid) {
      throw new GoneException({
        status: 'REVOKED',
        valid: false,
        reason: 'Certificate not found or revoked on-chain',
        certificate: null,
      });
    }

    return { status: 'VALID', valid: true, certificate: cert };
  }

  async revoke(certificateId: string, adminId: string, reason?: string) {
    const cert = await this.findById(certificateId);
    if (cert.isRevoked) throw new ForbiddenException('Certificate already revoked');

    const updated = await this.prisma.certificate.update({
      where: { id: certificateId },
      data: {
        isRevoked: true,
        revokedById: adminId,
        revokedAt: new Date(),
        revokeReason: reason ?? null,
      },
    });

    await this.notifications.notifyUser(
      cert.studentId,
      NotificationType.CERTIFICATE_REVOKED,
      'Certificate Revoked',
      `Your certificate for "${cert.course?.title ?? 'your course'}" has been revoked.${reason ? ` Reason: ${reason}` : ''}`,
      { certificateId, reason },
    );

    return updated;
  }
}
