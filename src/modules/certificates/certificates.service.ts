import {
  Injectable, NotFoundException, ForbiddenException, Logger,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ExamsService } from '../exams/exams.service';
import { NotificationType } from '@prisma/client';
import { CertificateRenderData } from './certificate-template.types';
import { v4 as uuidv4 } from 'uuid';
import { CertificatePdfService } from '../certificates/certificate-pdf.service';

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
    private readonly pdfService: CertificatePdfService,
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

    // Generate PDF certificate using the course's category for template lookup
    const renderData: CertificateRenderData = {
      studentName:       enrollment.student.name,
      courseTitle:       enrollment.course.title,
      certificateId,
      issuedAt:          certificate.issuedAt,
      category:          enrollment.course.category,
    };

    const pdfBuffer = await this.pdfService.renderForCategory(
      enrollment.course.category,
      renderData,
    );

    // Store PDF file reference (in production this would be uploaded to S3/cloud storage)
    const pdfUrl = `certificates/${certificateId}.pdf`;
    const updatedCert = await this.prisma.certificate.update({
      where: { id: certificateId },
      data: { pdfUrl },
    });

    this.logger.log(`Certificate issued: ${certificateId} for student ${studentId}, PDF: ${pdfUrl}`);

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

    return updatedCert;
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
   * Returns the certificate details if valid, or an error if revoked/not found.
   */
  async verify(certificateId: string) {
    const cert = await this.findById(certificateId);

    if (cert.isRevoked) {
      return { valid: false, reason: 'Certificate has been revoked', certificate: null };
    }

    // Cross-check with on-chain state
    const onChainValid = await this.stellar.verifyCertificateOnChain(certificateId);
    if (!onChainValid) {
      return {
        valid: false,
        reason: 'Certificate not found or revoked on-chain',
        certificate: null,
      };
    }

    return { valid: true, certificate: cert };
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
