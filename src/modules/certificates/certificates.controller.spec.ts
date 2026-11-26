import { GoneException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { CertificatesController } from './certificates.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('CertificatesController', () => {
  let controller: CertificatesController;

  const service = {
    verify: jest.fn(),
    findById: jest.fn(),
    findByStudent: jest.fn(),
    issue: jest.fn(),
    updateTxHash: jest.fn(),
    revoke: jest.fn(),
  };
  const pdfQueue = { getJob: jest.fn() };

  const guardsOf = (method: keyof CertificatesController) =>
    Reflect.getMetadata(GUARDS_METADATA, CertificatesController.prototype[method]);
  const rolesOf = (method: keyof CertificatesController) =>
    Reflect.getMetadata(ROLES_KEY, CertificatesController.prototype[method]);

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CertificatesController(service as any, pdfQueue as any);
  });

  // ─── verify ───────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('returns VALID status for a clean certificate', async () => {
      const cert = { id: 'c1', isFraudHeld: false, revokedAt: null };
      service.verify.mockResolvedValue(cert);

      await expect(controller.verify('c1')).resolves.toEqual({
        status: 'VALID',
        valid: true,
        certificate: cert,
      });
      expect(service.verify).toHaveBeenCalledWith('c1');
    });

    it('returns FRAUD_HELD status when certificate is fraud-held', async () => {
      const cert = { id: 'c1', isFraudHeld: true, revokedAt: null };
      service.verify.mockResolvedValue(cert);

      await expect(controller.verify('c1')).resolves.toEqual({
        status: 'FRAUD_HELD',
        valid: false,
        certificate: cert,
      });
    });

    it('throws GoneException for a revoked certificate', async () => {
      const revokedAt = new Date('2024-01-01');
      const cert = { id: 'c1', isFraudHeld: false, revokedAt, revokeReason: 'fraud' };
      service.verify.mockResolvedValue(cert);

      await expect(controller.verify('c1')).rejects.toThrow(GoneException);
    });

    it('throws NotFoundException when certificate does not exist', async () => {
      service.verify.mockResolvedValue(null);

      await expect(controller.verify('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Route delegation ─────────────────────────────────────────────────────

  describe('findOne', () => {
    it('delegates to service.findById', () => {
      const cert = { id: 'c1' };
      service.findById.mockReturnValue(cert);

      expect(controller.findOne('c1')).toBe(cert);
      expect(service.findById).toHaveBeenCalledWith('c1');
    });
  });

  describe('findMy', () => {
    it('delegates to service.findByStudent', () => {
      service.findByStudent.mockReturnValue([]);

      controller.findMy('s1');

      expect(service.findByStudent).toHaveBeenCalledWith('s1');
    });
  });

  describe('issue', () => {
    it('delegates to service.issue with adminId, studentId and courseId', () => {
      const cert = { id: 'c1' };
      service.issue.mockReturnValue(cert);

      const result = controller.issue('a1', { studentId: 's1', courseId: 'co1' } as any);

      expect(service.issue).toHaveBeenCalledWith('a1', 's1', 'co1');
      expect(result).toBe(cert);
    });
  });

  describe('updateTxHash', () => {
    it('delegates to service.updateTxHash with cert id and hash', () => {
      controller.updateTxHash('c1', { txHash: 'abc123' } as any);

      expect(service.updateTxHash).toHaveBeenCalledWith('c1', 'abc123');
    });
  });

  describe('revoke', () => {
    it('delegates with reason when provided', () => {
      controller.revoke('c1', 'a1', { reason: 'fraud' } as any);

      expect(service.revoke).toHaveBeenCalledWith('c1', 'a1', 'fraud');
    });

    it('delegates with undefined reason when dto is omitted', () => {
      controller.revoke('c2', 'a1');

      expect(service.revoke).toHaveBeenCalledWith('c2', 'a1', undefined);
    });
  });

  // ─── getPdfStatus ─────────────────────────────────────────────────────────

  describe('getPdfStatus', () => {
    it('returns not_queued when no job exists', async () => {
      pdfQueue.getJob.mockResolvedValue(undefined);

      await expect(controller.getPdfStatus('c1')).resolves.toEqual({
        certificateId: 'c1',
        status: 'not_queued',
      });
      expect(service.findById).toHaveBeenCalledWith('c1');
    });

    it('returns pdfUrl when job is completed', async () => {
      pdfQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('completed'),
        returnvalue: { pdfUrl: 'https://x/c1.pdf' },
      });

      await expect(controller.getPdfStatus('c1')).resolves.toEqual({
        certificateId: 'c1',
        status: 'completed',
        pdfUrl: 'https://x/c1.pdf',
      });
    });

    it('returns null pdfUrl while job is pending', async () => {
      pdfQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue('active'),
        returnvalue: null,
      });

      await expect(controller.getPdfStatus('c1')).resolves.toEqual({
        certificateId: 'c1',
        status: 'active',
        pdfUrl: null,
      });
    });
  });

  // ─── download ─────────────────────────────────────────────────────────────

  describe('download', () => {
    it('responds with the pdfUrl when it exists', async () => {
      service.findById.mockResolvedValue({ pdfUrl: 'https://x/c1.pdf' });
      const res = { json: jest.fn() };

      await controller.download('c1', res);

      expect(res.json).toHaveBeenCalledWith({
        pdfUrl: 'https://x/c1.pdf',
        message: 'PDF certificate ready for download',
      });
    });

    it('throws NotFoundException when no pdfUrl is stored', async () => {
      service.findById.mockResolvedValue({ pdfUrl: null });

      await expect(controller.download('c1', { json: jest.fn() })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Guard / role metadata ────────────────────────────────────────────────

  describe('guard and role metadata', () => {
    it('leaves public routes unguarded', () => {
      expect(guardsOf('verify')).toBeUndefined();
      expect(guardsOf('findOne')).toBeUndefined();
    });

    it.each(['findMy', 'getPdfStatus', 'download'] as const)(
      '%s requires JwtAuthGuard only',
      (method) => {
        expect(guardsOf(method)).toEqual([JwtAuthGuard]);
      },
    );

    it.each(['issue', 'updateTxHash', 'revoke'] as const)(
      '%s requires JwtAuthGuard + RolesGuard restricted to ADMIN',
      (method) => {
        expect(guardsOf(method)).toEqual([JwtAuthGuard, RolesGuard]);
        expect(rolesOf(method)).toEqual([UserRole.ADMIN]);
      },
    );
  });
});
