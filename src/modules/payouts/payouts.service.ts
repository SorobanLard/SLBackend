import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KycService } from '../kyc/kyc.service';
import { PayoutQueryDto } from './dto/payout-query.dto';
import { CreatePayoutDto, UpdatePayoutStatusDto } from './dto/create-payout.dto';
import { PayoutStatus, UserRole } from '@prisma/client';

/**
 * Time window (ms) within which a duplicate idempotency key is treated as a
 * retry of the same payout request rather than a new payout.
 */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kyc: KycService,
  ) {}

  /**
   * Get payout history for an instructor with date range and status filtering.
   * Validates instructor ownership.
   */
  async getInstructorPayoutHistory(
    requestingUser: any,
    instructorId: string,
    query: PayoutQueryDto,
  ) {
    // Validate requesting instructor ownership
    if (
      requestingUser.id !== instructorId &&
      requestingUser.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException(
        'Access denied: You can only view your own payout history',
      );
    }

    const { status, startDate, endDate, page = 1, limit = 20 } = query;
    const where: any = { instructorId };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.payout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payout.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Export summary statement of payouts for an instructor.
   */
  async exportPayoutStatement(
    requestingUser: any,
    instructorId: string,
    query: PayoutQueryDto,
  ) {
    const history = await this.getInstructorPayoutHistory(
      requestingUser,
      instructorId,
      { ...query, limit: 1000, page: 1 },
    );

    const payouts = history.data;

    let totalAmountCompleted = 0;
    let totalAmountPending = 0;

    payouts.forEach((p) => {
      const amt = Number(p.amount);
      if (p.status === PayoutStatus.COMPLETED) {
        totalAmountCompleted += amt;
      } else if (
        p.status === PayoutStatus.PENDING ||
        p.status === PayoutStatus.PROCESSING
      ) {
        totalAmountPending += amt;
      }
    });

    return {
      statementDate: new Date(),
      instructorId,
      period: {
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
      },
      summary: {
        totalPayoutsCount: payouts.length,
        totalCompletedAmount: totalAmountCompleted,
        totalPendingAmount: totalAmountPending,
        currency: 'USDC',
      },
      payouts,
    };
  }

  /**
   * Derive a deterministic idempotency key from the payout schedule and period
   * when the client does not supply one explicitly.
   */
  private deriveIdempotencyKey(dto: CreatePayoutDto): string {
    if (dto.idempotencyKey) {
      return dto.idempotencyKey;
    }

    const periodStart = dto.periodStart ?? '';
    const periodEnd = dto.periodEnd ?? '';
    return `payout:${dto.instructorId}:${periodStart}:${periodEnd}`;
  }

  /**
   * Create a new payout record (Admin or automated platform payout).
   *
   * Idempotent: a duplicate request carrying the same idempotency key within
   * the idempotency window returns the existing payout instead of creating a
   * second one, preventing double-payout on client retries.
   */
  async createPayout(dto: CreatePayoutDto) {
    const idempotencyKey = this.deriveIdempotencyKey(dto);

    const existing = await this.prisma.payout.findFirst({
      where: {
        idempotencyKey,
        createdAt: { gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      this.logger.log(
        `Duplicate payout request detected for idempotency key ${idempotencyKey}; returning existing payout ${existing.id}`,
      );
      return existing;
    }

    const instructor = await this.prisma.user.findUnique({
      where: { id: dto.instructorId },
    });

    if (!instructor) {
      throw new NotFoundException('Instructor not found');
    }

    const verification = await this.kyc.getVerificationStatus(dto.instructorId);
    if (!verification.isVerified) {
      throw new ForbiddenException(
        'Payout cannot be created: instructor has not completed KYC verification. ' +
          'Please submit your KYC documents and wait for approval before requesting payouts.',
      );
    }

    try {
      const payout = await this.prisma.payout.create({
        data: {
          instructorId: dto.instructorId,
          amount: dto.amount,
          currency: dto.currency ?? 'USDC',
          status: PayoutStatus.PENDING,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
          idempotencyKey,
        },
      });

      this.logger.log(
        `Payout record created: ${payout.id} for instructor ${dto.instructorId} (idempotency key ${idempotencyKey})`,
      );
      return payout;
    } catch (error) {
      // Handle a concurrent request that won the race on the unique key.
      if ((error as any)?.code === 'P2002') {
        const raced = await this.prisma.payout.findFirst({
          where: { idempotencyKey },
          orderBy: { createdAt: 'desc' },
        });
        if (raced) {
          this.logger.log(
            `Concurrent duplicate payout request for idempotency key ${idempotencyKey}; returning existing payout ${raced.id}`,
          );
          return raced;
        }
        throw new ConflictException(
          'A payout with this idempotency key already exists',
        );
      }
      throw error;
    }
  }

  /**
   * Track payout status transitions (PENDING -> PROCESSING -> COMPLETED/FAILED).
   */
  async updatePayoutStatus(payoutId: string, dto: UpdatePayoutStatusDto) {
    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      throw new NotFoundException('Payout record not found');
    }

    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: {
        status: dto.status,
        txHash: dto.txHash ?? payout.txHash,
      },
    });

    this.logger.log(
      `Payout status transition: ${payoutId} updated from ${payout.status} to ${dto.status}`,
    );

    return updated;
  }
}
