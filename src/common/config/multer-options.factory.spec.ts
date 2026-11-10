import { BadRequestException } from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import {
  createMulterOptions,
  DEFAULT_ALLOWED_DOCUMENT_MIMES,
  DEFAULT_MAX_DOCUMENT_SIZE_BYTES,
} from './multer-options.factory';

jest.mock('../../modules/certificates/mime-validator', () => ({
  validateFileMimeType: jest.fn(),
}));

import { CertificateTemplatesController } from '../../modules/certificates/certificate-templates.controller';
import { KycController } from '../../modules/kyc/kyc.controller';

describe('createMulterOptions()', () => {
  it('applies default 10 MB fileSize limit and allowed document MIME types', () => {
    const options = createMulterOptions();

    expect(options.limits?.fileSize).toBe(DEFAULT_MAX_DOCUMENT_SIZE_BYTES);
    expect(options.storage).toBeDefined();
    expect(typeof options.fileFilter).toBe('function');
  });

  it('supports custom maxFileSizeBytes and allowedMimeTypes overrides', () => {
    const options = createMulterOptions({
      maxFileSizeBytes: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/png'],
    });

    expect(options.limits?.fileSize).toBe(5 * 1024 * 1024);

    const cb = jest.fn();
    options.fileFilter!(
      {},
      { mimetype: 'image/jpeg' } as Express.Multer.File,
      cb,
    );
    expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
  });

  it.each(DEFAULT_ALLOWED_DOCUMENT_MIMES)(
    'accepts allowed MIME type %s in fileFilter',
    (mimetype) => {
      const options = createMulterOptions();
      const cb = jest.fn();

      options.fileFilter!(
        {},
        { mimetype: mimetype.toUpperCase() } as Express.Multer.File,
        cb,
      );

      expect(cb).toHaveBeenCalledWith(null, true);
    },
  );

  it.each([
    'application/x-msdownload',
    'text/html',
    'application/javascript',
    '',
  ])('rejects disallowed MIME type "%s" with BadRequestException', (mimetype) => {
    const options = createMulterOptions();
    const cb = jest.fn();

    options.fileFilter!(
      {},
      { mimetype } as Express.Multer.File,
      cb,
    );

    expect(cb).toHaveBeenCalledWith(expect.any(BadRequestException), false);
  });

  it('attaches Multer interceptors to CertificateTemplatesController.uploadTemplateFile and KycController.submit', () => {
    const certInterceptors = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      CertificateTemplatesController.prototype.uploadTemplateFile,
    );
    const kycInterceptors = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      KycController.prototype.submit,
    );

    expect(certInterceptors).toHaveLength(1);
    expect(kycInterceptors).toHaveLength(1);
  });
});
