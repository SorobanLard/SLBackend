import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DisputeStatus, DisputeReferenceType, NotificationType } from '@prisma/client';
import { FileDisputeDto } from './dto/file-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----------------------------------------------------------
  // FILE A DISPUTE (student)
  // ----------------------------------------------------------

  async file(studentId: string, dto: FileDisputeDto) {
    // Validate the referenced record belongs to this student
    await this.validateReference(studentId, dto.referenceType, dto.referenceId);

    const dispute = await this.prisma.dispute.create({
      data: {
        filedById: studentId,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        subject: dto.subject,
        description: dto.description,
        status: DisputeStatus.OPEN,
      },
      include: {
        filedBy: { select: { id: true, name: true, stellarAddress: true } },
      },
    });

    this.logger.log(`Dispute filed: ${dispute.id} by student ${studentId}`);
    return dispute;
  }

  // ----------------------------------------------------------
  // READ
  // ----------------------------------------------------------

  /** Get all disputes — admin only */
  async findAll(
    page = 1,
    limit = 20,
    status?: DisputeStatus,
  ) {
    const where: any = {};
    if (status) where.status = status;

    const [disputes, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where,
        include: {
          filedBy: { select: { id: true, name: true, stellarAddress: true } },
          resolvedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return { data: disputes, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Get a single dispute by ID */
  async findOne(id: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        filedBy: { select: { id: true, name: true, stellarAddress: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });
    if (!dispute) throw new NotFoundException(`Dispute ${id} not found`);
    return dispute;
  }

  /** Get disputes filed by the authenticated student */
  async findMyDisputes(studentId: string, page = 1, limit = 20) {
    const [disputes, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({
        where: { filedById: studentId },
        include: {
          resolvedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dispute.count({ where: { filedById: studentId } }),
    ]);

    return { data: disputes, meta: { total, page, limit } };
  }

  // ----------------------------------------------------------
  // STATUS TRANSITION — admin moves dispute through stages
  // ----------------------------------------------------------

  async markUnderReview(id: string) {
    const dispute = await this.findOne(id);

    if (dispute.status !== DisputeStatus.OPEN) {
      throw new BadRequestException('Only OPEN disputes can be moved to UNDER_REVIEW');
    }

    return this.prisma.dispute.update({
      where: { id },
      data: { status: DisputeStatus.UNDER_REVIEW },
    });
  }

  // ----------------------------------------------------------
  // RESOLVE (admin)
  // ----------------------------------------------------------

  async resolve(id: string, adminId: string, dto: ResolveDisputeDto) {
    const dispute = await this.findOne(id);

    const allowedTransitions = this.getAllowedDisputeTransitions(dispute.status);
    if (!allowedTransitions.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition dispute from ${dispute.status} to ${dto.status}. Allowed transitions: ${allowedTransitions.join(', ')}`,
      );
    }

    const updated = await this.prisma.dispute.update({
      where: { id },
      data: {
        status: dto.status,
        adminNotes: dto.adminNotes,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });

    await this.notifications.notifyUser(
      dispute.filedById,
      NotificationType.DISPUTE_RESOLVED,
      `Your dispute has been ${dto.status.toLowerCase()}`,
      `Your dispute "${dispute.subject}" has been reviewed. Admin notes: ${dto.adminNotes}`,
      { disputeId: id, status: dto.status },
    );

    this.logger.log(`Dispute ${id} resolved as ${dto.status} by admin ${adminId}`);
    return updated;
  }

  private getAllowedDisputeTransitions(currentStatus: DisputeStatus): DisputeStatus[] {
    const transitions: Record<DisputeStatus, DisputeStatus[]> = {
      [DisputeStatus.OPEN]: [DisputeStatus.UNDER_REVIEW, DisputeStatus.RESOLVED, DisputeStatus.REJECTED, DisputeStatus.CLOSED],
      [DisputeStatus.UNDER_REVIEW]: [DisputeStatus.RESOLVED, DisputeStatus.REJECTED, DisputeStatus.CLOSED],
      [DisputeStatus.RESOLVED]: [],
      [DisputeStatus.REJECTED]: [],
      [DisputeStatus.CLOSED]: [],
    };
    return transitions[currentStatus] || [];
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  /**
   * Ensures the referenced enrollment or payment belongs to the student
   * before allowing them to file a dispute.
   */
  private async validateReference(
    studentId: string,
    referenceType: DisputeReferenceType,
    referenceId: string,
  ) {
    if (referenceType === DisputeReferenceType.ENROLLMENT) {
      const enrollment = await this.prisma.enrollment.findUnique({
        where: { id: referenceId },
      });
      if (!enrollment) {
        throw new NotFoundException(`Enrollment ${referenceId} not found`);
      }
      if (enrollment.studentId !== studentId) {
        throw new ForbiddenException('You can only dispute your own enrollments');
      }
      return enrollment;
    }

    // PAYMENT — referenceId is a txHash stored on an enrollment
    if (referenceType === DisputeReferenceType.PAYMENT) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: { txHash: referenceId, studentId },
      });
      if (!enrollment) {
        throw new NotFoundException(
          `No enrollment found with payment txHash "${referenceId}" for your account`,
        );
      }
      return enrollment;
    }

    throw new BadRequestException('Invalid reference type');
  }
}
