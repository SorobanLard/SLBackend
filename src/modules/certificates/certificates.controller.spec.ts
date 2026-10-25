import { NotFoundException } from '@nestjs/common';
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

  describe('route delegation', () => {
    it('verify delegates to service.verify', () => {
      service.verify.mockReturnValue('ok');
      expect(controller.verify('c1')).toBe('ok');
      expect(service.verify).toHaveBeenCalledWith('c1');
    });

    it('findOne delegates to service.findById', () => {
      controller.findOne('c1');
      expect(service.findById).toHaveBeenCalledWith('c1');
    });

    it('findMy delegates to service.findByStudent', () => {
      controller.findMy('s1');
      expect(service.findByStudent).toHaveBeenCalledWith('s1');
    });

    it('issue delegates to service.issue', () => {
      controller.issue('a1', { studentId: 's1', courseId: 'co1' } as any);
      expect(service.issue).toHaveBeenCalledWith('a1', 's1', 'co1');
    });

    it('updateTxHash delegates to service.updateTxHash', () => {
      controller.updateTxHash('c1', { txHash: '0xabc' } as any);
      expect(service.updateTxHash).toHaveBeenCalledWith('c1', '0xabc');
    });

    it('revoke delegates to service.revoke with optional reason', () => {
      controller.revoke('c1', 'a1', { reason: 'fraud' } as any);
      expect(service.revoke).toHaveBeenCalledWith('c1', 'a1', 'fraud');
      controller.revoke('c2', 'a1');
      expect(service.revoke).toHaveBeenCalledWith('c2', 'a1', undefined);
    });
  });

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
      const result = await controller.getPdfStatus('c1');
      expect(result).toEqual({ certificateId: 'c1', status: 'active', pdfUrl: null });
    });
  });

  describe('download', () => {
    it('responds with the pdfUrl', async () => {
      service.findById.mockResolvedValue({ pdfUrl: 'https://x/c1.pdf' });
      const res = { json: jest.fn() };
      await controller.download('c1', res);
      expect(res.json).toHaveBeenCalledWith({
        pdfUrl: 'https://x/c1.pdf',
        message: 'PDF certificate ready for download',
      });
    });

    it('throws NotFoundException when no pdfUrl', async () => {
      service.findById.mockResolvedValue({ pdfUrl: null });
      await expect(controller.download('c1', { json: jest.fn() })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('guard and role metadata', () => {
    it('leaves public routes unguarded', () => {
      expect(guardsOf('verify')).toBeUndefined();
      expect(guardsOf('findOne')).toBeUndefined();
    });

    it.each(['findMy', 'getPdfStatus', 'download'] as const)(
      '%s requires JwtAuthGuard',
      (method) => {
        expect(guardsOf(method)).toEqual([JwtAuthGuard]);
      },
    );

    it.each(['issue', 'updateTxHash', 'revoke'] as const)(
      '%s requires JwtAuthGuard + RolesGuard with ADMIN role',
      (method) => {
        expect(guardsOf(method)).toEqual([JwtAuthGuard, RolesGuard]);
        expect(rolesOf(method)).toEqual([UserRole.ADMIN]);
      },
    );
  });
});
