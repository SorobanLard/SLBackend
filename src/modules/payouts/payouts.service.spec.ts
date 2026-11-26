import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PayoutStatus, UserRole } from '@prisma/client';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KycService } from '../kyc/kyc.service';

describe('PayoutsService', () => {
  let service: PayoutsService;
  let prisma: {
    payout: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let kyc: { getVerificationStatus: jest.Mock };

  beforeEach(async () => {
    prisma = {
      payout: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    kyc = { getVerificationStatus: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: PrismaService, useValue: prisma },
        { provide: KycService, useValue: kyc },
      ],
    }).compile();

    service = module.get<PayoutsService>(PayoutsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getInstructorPayoutHistory', () => {
    it('returns paginated payout history for the owning instructor', async () => {
      const payouts = [{ id: 'p1', amount: 100 }];
      prisma.$transaction.mockResolvedValue([payouts, 1]);

      const result = await service.getInstructorPayoutHistory(
        { id: 'inst-1', role: UserRole.INSTRUCTOR },
        'inst-1',
        { page: 1, limit: 20 } as any,
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toEqual({
        data: payouts,
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('throws ForbiddenException when a non-owner non-admin requests history', async () => {
      await expect(
        service.getInstructorPayoutHistory(
          { id: 'other', role: UserRole.INSTRUCTOR },
          'inst-1',
          {} as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows admins to view any instructor history', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      const result = await service.getInstructorPayoutHistory(
        { id: 'admin-1', role: UserRole.ADMIN },
        'inst-1',
        {} as any,
      );

      expect(result.meta.total).toBe(0);
    });
  });

  describe('exportPayoutStatement', () => {
    it('summarizes completed and pending amounts', async () => {
      prisma.$transaction.mockResolvedValue([
        [
          { id: 'p1', amount: 100, status: PayoutStatus.COMPLETED },
          { id: 'p2', amount: 50, status: PayoutStatus.PENDING },
          { id: 'p3', amount: 25, status: PayoutStatus.PROCESSING },
          { id: 'p4', amount: 10, status: PayoutStatus.FAILED },
        ],
        4,
      ]);

      const result = await service.exportPayoutStatement(
        { id: 'inst-1', role: UserRole.INSTRUCTOR },
        'inst-1',
        {} as any,
      );

      expect(result.summary.totalPayoutsCount).toBe(4);
      expect(result.summary.totalCompletedAmount).toBe(100);
      expect(result.summary.totalPendingAmount).toBe(75);
      expect(result.summary.currency).toBe('USDC');
    });
  });

  describe('createPayout', () => {
    const dto = {
      instructorId: 'inst-1',
      amount: 100,
      periodStart: '2024-01-01',
      periodEnd: '2024-01-31',
    } as any;

    it('creates a payout on the happy path', async () => {
      prisma.payout.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'inst-1' });
      kyc.getVerificationStatus.mockResolvedValue({ isVerified: true });
      const created = { id: 'payout-1', status: PayoutStatus.PENDING };
      prisma.payout.create.mockResolvedValue(created);

      const result = await service.createPayout(dto);

      expect(prisma.payout.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            instructorId: 'inst-1',
            amount: 100,
            currency: 'USDC',
            status: PayoutStatus.PENDING,
          }),
        }),
      );
      expect(result).toBe(created);
    });

    it('returns the existing payout for a duplicate idempotency key', async () => {
      const existing = { id: 'payout-existing' };
      prisma.payout.findFirst.mockResolvedValue(existing);

      const result = await service.createPayout(dto);

      expect(result).toBe(existing);
      expect(prisma.payout.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the instructor does not exist', async () => {
      prisma.payout.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.createPayout(dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.payout.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when KYC is not verified', async () => {
      prisma.payout.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'inst-1' });
      kyc.getVerificationStatus.mockResolvedValue({ isVerified: false });

      await expect(service.createPayout(dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.payout.create).not.toHaveBeenCalled();
    });

    it('returns the raced payout on a unique-constraint conflict', async () => {
      prisma.payout.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'payout-raced' });
      prisma.user.findUnique.mockResolvedValue({ id: 'inst-1' });
      kyc.getVerificationStatus.mockResolvedValue({ isVerified: true });
      prisma.payout.create.mockRejectedValue({ code: 'P2002' });

      const result = await service.createPayout(dto);

      expect(result).toEqual({ id: 'payout-raced' });
    });

    it('throws ConflictException when a P2002 conflict has no raced record', async () => {
      prisma.payout.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({ id: 'inst-1' });
      kyc.getVerificationStatus.mockResolvedValue({ isVerified: true });
      prisma.payout.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.createPayout(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('updatePayoutStatus', () => {
    it('updates the payout status and preserves txHash when not provided', async () => {
      prisma.payout.findUnique.mockResolvedValue({
        id: 'payout-1',
        status: PayoutStatus.PENDING,
        txHash: '0xabc',
      });
      const updated = { id: 'payout-1', status: PayoutStatus.PROCESSING };
      prisma.payout.update.mockResolvedValue(updated);

      const result = await service.updatePayoutStatus('payout-1', {
        status: PayoutStatus.PROCESSING,
      } as any);

      expect(prisma.payout.update).toHaveBeenCalledWith({
        where: { id: 'payout-1' },
        data: { status: PayoutStatus.PROCESSING, txHash: '0xabc' },
      });
      expect(result).toBe(updated);
    });

    it('throws NotFoundException when the payout does not exist', async () => {
      prisma.payout.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePayoutStatus('missing', {
          status: PayoutStatus.COMPLETED,
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.payout.update).not.toHaveBeenCalled();
    });
  });
});
