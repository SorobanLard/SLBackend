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
      providers: [{ provide: CertificateShareService, useValue: mockShareService }],
    }).compile();

    controller = module.get<CertificateShareController>(CertificateShareController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('generate delegates to generateShareLink with certificate and student ids', async () => {
    mockShareService.generateShareLink.mockResolvedValue({ url: 'https://x/share/tok' });

    const res = await controller.generate('cert-1', 'student-1');

    expect(mockShareService.generateShareLink).toHaveBeenCalledWith('cert-1', 'student-1');
    expect(res).toEqual({ url: 'https://x/share/tok' });
  });

  it('metadata delegates to getShareMetadata', async () => {
    mockShareService.getShareMetadata.mockResolvedValue({ title: 'Cert' });

    const res = await controller.metadata('tok');

    expect(mockShareService.getShareMetadata).toHaveBeenCalledWith('tok');
    expect(res).toEqual({ title: 'Cert' });
  });

  it('view renders the share page as a StreamableFile', async () => {
    mockShareService.renderSharePage.mockResolvedValue({ html: '<html>ok</html>' });

    const res = await controller.view('tok');

    expect(mockShareService.renderSharePage).toHaveBeenCalledWith('tok');
    expect(res).toBeInstanceOf(StreamableFile);
    const chunks: Buffer[] = [];
    for await (const chunk of res.getStream()) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('<html>ok</html>');
  });

  describe('guard wiring', () => {
    it('protects share link generation with JwtAuthGuard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, CertificateShareController.prototype.generate)).toEqual([
        JwtAuthGuard,
      ]);
    });

    it('keeps public share routes unguarded', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, CertificateShareController)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, CertificateShareController.prototype.metadata)).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, CertificateShareController.prototype.view)).toBeUndefined();
    });
  });
});
