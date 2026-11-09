import { BadRequestException } from '@nestjs/common';
import {
  CERTIFICATE_TEMPLATE_ALLOWED_MIME_TYPES,
  createMimeFileFilter,
  createMulterOptions,
  DEFAULT_MAX_FILE_SIZE_MB,
  DOCUMENT_ALLOWED_MIME_TYPES,
  resolveMaxFileSizeBytes,
} from './multer-options';

describe('multer-options (shared file upload limits and MIME allow-list)', () => {
  const originalMaxMb = process.env.MAX_FILE_SIZE_MB;

  afterEach(() => {
    if (originalMaxMb === undefined) {
      delete process.env.MAX_FILE_SIZE_MB;
    } else {
      process.env.MAX_FILE_SIZE_MB = originalMaxMb;
    }
  });

  describe('resolveMaxFileSizeBytes()', () => {
    it('returns the default 10 MB limit when MAX_FILE_SIZE_MB is unset', () => {
      delete process.env.MAX_FILE_SIZE_MB;
      expect(resolveMaxFileSizeBytes()).toBe(
        DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024,
      );
    });

    it('reads MAX_FILE_SIZE_MB from environment when configured', () => {
      process.env.MAX_FILE_SIZE_MB = '15';
      expect(resolveMaxFileSizeBytes()).toBe(15 * 1024 * 1024);
    });

    it('prioritizes an explicit maxFileSizeBytes override and ignores invalid env values', () => {
      process.env.MAX_FILE_SIZE_MB = 'invalid';
      expect(resolveMaxFileSizeBytes()).toBe(
        DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024,
      );
      expect(resolveMaxFileSizeBytes(5 * 1024 * 1024)).toBe(5 * 1024 * 1024);
    });
  });

  describe('createMimeFileFilter()', () => {
    it('accepts files whose MIME type is in the allow-list (case-insensitive)', () => {
      const filter = createMimeFileFilter(DOCUMENT_ALLOWED_MIME_TYPES);
      const callback = jest.fn();

      filter({} as any, { mimetype: 'IMAGE/PNG' } as Express.Multer.File, callback);
      expect(callback).toHaveBeenCalledWith(null, true);

      callback.mockClear();
      filter(
        {} as any,
        { mimetype: 'application/pdf' } as Express.Multer.File,
        callback,
      );
      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('rejects disallowed or missing MIME types with BadRequestException', () => {
      const filter = createMimeFileFilter(
        CERTIFICATE_TEMPLATE_ALLOWED_MIME_TYPES,
      );
      const callback = jest.fn();

      filter(
        {} as any,
        { mimetype: 'application/x-msdownload' } as Express.Multer.File,
        callback,
      );
      expect(callback).toHaveBeenCalledWith(
        expect.any(BadRequestException),
        false,
      );

      callback.mockClear();
      filter(
        {} as any,
        { mimetype: 'image/webp' } as Express.Multer.File,
        callback,
      );
      expect(callback).toHaveBeenCalledWith(
        expect.any(BadRequestException),
        false,
      );

      callback.mockClear();
      filter({} as any, { mimetype: '' } as Express.Multer.File, callback);
      expect(callback).toHaveBeenCalledWith(
        expect.any(BadRequestException),
        false,
      );
    });
  });

  describe('createMulterOptions()', () => {
    it('constructs MulterOptions with memoryStorage, limits.fileSize, and fileFilter', () => {
      delete process.env.MAX_FILE_SIZE_MB;
      const options = createMulterOptions({
        maxFileSizeBytes: 2 * 1024 * 1024,
        allowedMimeTypes: CERTIFICATE_TEMPLATE_ALLOWED_MIME_TYPES,
      });

      expect(options.storage).toBeDefined();
      expect(options.limits?.fileSize).toBe(2 * 1024 * 1024);
      expect(typeof options.fileFilter).toBe('function');

      const acceptCb = jest.fn();
      options.fileFilter!(
        {} as any,
        { mimetype: 'application/pdf' } as Express.Multer.File,
        acceptCb,
      );
      expect(acceptCb).toHaveBeenCalledWith(null, true);

      const rejectCb = jest.fn();
      options.fileFilter!(
        {} as any,
        { mimetype: 'text/html' } as Express.Multer.File,
        rejectCb,
      );
      expect(rejectCb).toHaveBeenCalledWith(
        expect.any(BadRequestException),
        false,
      );
    });
  });
});
