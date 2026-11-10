import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

export const DEFAULT_ALLOWED_DOCUMENT_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const DEFAULT_MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface SharedMulterOptionsConfig {
  /** Maximum file size in bytes. Defaults to 10 MB (`DEFAULT_MAX_DOCUMENT_SIZE_BYTES`). */
  maxFileSizeBytes?: number;
  /** Explicit allow-list of lowercased MIME types. Defaults to `DEFAULT_ALLOWED_DOCUMENT_MIMES`. */
  allowedMimeTypes?: readonly string[];
}

/**
 * Centralized Multer configuration factory enforcing memoryStorage, explicit
 * `limits.fileSize`, and a strict MIME-type allow-list via `fileFilter`.
 */
export function createMulterOptions(
  config: SharedMulterOptionsConfig = {},
): MulterOptions {
  const maxFileSizeBytes =
    config.maxFileSizeBytes ?? DEFAULT_MAX_DOCUMENT_SIZE_BYTES;
  const allowedMimeTypes = (
    config.allowedMimeTypes ?? DEFAULT_ALLOWED_DOCUMENT_MIMES
  ).map((mime) => mime.toLowerCase());

  return {
    storage: memoryStorage(),
    limits: {
      fileSize: maxFileSizeBytes,
    },
    fileFilter: (_req, file, callback) => {
      const normalizedMime = file?.mimetype?.toLowerCase();
      if (!normalizedMime || !allowedMimeTypes.includes(normalizedMime)) {
        return callback(
          new BadRequestException(
            `Invalid file type "${file?.mimetype ?? 'unknown'}". Allowed MIME types: ${allowedMimeTypes.join(', ')}`,
          ),
          false,
        );
      }
      return callback(null, true);
    },
  };
}
