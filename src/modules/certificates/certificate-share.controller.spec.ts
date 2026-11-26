import { Test, TestingModule } from '@nestjs/testing';
import { StreamableFile } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CertificateShareController } from './certificate-share.controller';
import { CertificateShareService } from './certificate-share.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

describe('CertificateShareController', () => {
  let controller: CertificateShareController;

  const mockShareService = {
    generateShareLink: jest.fn(),
    getShareMetadata: jest.fn(),
    renderSharePage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertificateShareController],
      providers: [
        { provide: CertificateShareService, useValue: mockShareService },
      ],
    }).compile();

    controller = module.get<CertificateShareController>(CertificateShareController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── Route delegation ─────────────────────────────────────────────────────

  describe('generate', () => {
    it('delegates to generateShareLink with the certificate and student ids', async () => {
      mockShareService.generateShareLink.mockResolvedValue({ url: 'https://x/share/tok' });

      const result = await controller.generate('cert-1', 'student-1');

      expect(mockShareService.generateShareLink).toHaveBeenCalledTimes(1);
      expect(mockShareService.generateShareLink).toHaveBeenCalledWith('cert-1', 'student-1');
      expect(result).toEqual({ url: 'https://x/share/tok' });
    });

    it('propagates service errors', async () => {
      mockShareService.generateShareLink.mockRejectedValue(new Error('not found'));
      await expect(controller.generate('bad', 'student-1')).rejects.toThrow('not found');
    });
  });

  describe('metadata', () => {
    it('delegates to getShareMetadata with the token', async () => {
      mockShareService.getShareMetadata.mockResolvedValue({ title: 'My Cert' });

      const result = await controller.metadata('tok-abc');

      expect(mockShareService.getShareMetadata).toHaveBeenCalledTimes(1);
      expect(mockShareService.getShareMetadata).toHaveBeenCalledWith('tok-abc');
      expect(result).toEqual({ title: 'My Cert' });
    });
  });

  describe('view', () => {
    it('delegates to renderSharePage and returns a StreamableFile wrapping the HTML', async () => {
      const html = '<html><body>Certificate</body></html>';
      mockShareService.renderSharePage.mockResolvedValue({ html });

      const result = await controller.view('tok-abc');

      expect(mockShareService.renderSharePage).toHaveBeenCalledTimes(1);
      expect(mockShareService.renderSharePage).toHaveBeenCalledWith('tok-abc');
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('StreamableFile carries the correct HTML bytes', async () => {
      const html = '<html>ok</html>';
      mockShareService.renderSharePage.mockResolvedValue({ html });

      const result = await controller.view('tok-abc');

      // StreamableFile exposes the underlying Readable; collect its chunks.
      const readable = result.getStream();
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        readable.on('data', (chunk: Buffer) => chunks.push(chunk));
        readable.on('end', resolve);
        readable.on('error', reject);
      });
      expect(Buffer.concat(chunks).toString('utf8')).toBe(html);
    });
  });

  // ─── Guard / decorator wiring ─────────────────────────────────────────────

  describe('guard wiring', () => {
    it('requires JwtAuthGuard on generate (the only protected route)', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        CertificateShareController.prototype.generate,
      );
      expect(guards).toEqual([JwtAuthGuard]);
    });

    it('leaves the controller class itself unguarded', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, CertificateShareController);
      expect(guards).toBeUndefined();
    });

    it('leaves the public metadata route unguarded', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        CertificateShareController.prototype.metadata,
      );
      expect(guards).toBeUndefined();
    });

    it('leaves the public view route unguarded', () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        CertificateShareController.prototype.view,
      );
      expect(guards).toBeUndefined();
    });
  });
});
