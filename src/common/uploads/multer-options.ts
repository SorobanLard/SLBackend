import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

export const DEFAULT_MAX_FILE_SIZE_MB = 10;

export const DOCUMENT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const CERTIFICATE_TEMPLATE_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/pdf',
] as const;

export interface CreateMulterOptionsConfig {
  /** Explicit max file size in bytes. Defaults to MAX_FILE_SIZE_MB env var or 10 MB. */
  maxFileSizeBytes?: number;
  /** Explicit MIME allow-list. Defaults to DOCUMENT_ALLOWED_MIME_TYPES. */
  allowedMimeTypes?: readonly string[];
}

export function resolveMaxFileSizeBytes(
  explicitMaxBytes?: number,
  envMaxMb: string | undefined = process.env.MAX_FILE_SIZE_MB,
): number {
  if (
    typeof explicitMaxBytes === 'number' &&
    Number.isFinite(explicitMaxBytes) &&
    explicitMaxBytes > 0
  ) {
    return explicitMaxBytes;
  }

  const parsedMb = envMaxMb ? Number(envMaxMb) : NaN;
  const maxMb =
    Number.isFinite(parsedMb) && parsedMb > 0
      ? parsedMb
      : DEFAULT_MAX_FILE_SIZE_MB;

  return Math.floor(maxMb * 1024 * 1024);
}

export function createMimeFileFilter(
  allowedMimeTypes: readonly string[] = DOCUMENT_ALLOWED_MIME_TYPES,
): NonNullable<MulterOptions['fileFilter']> {
  const normalizedAllowed = new Set(
    allowedMimeTypes.map((mime) => mime.toLowerCase()),
  );

  return (_req, file, callback) => {
    const mime = (file?.mimetype ?? '').toLowerCase();
    if (!mime || !normalizedAllowed.has(mime)) {
      return callback(
        new BadRequestException(
          `File type "${file?.mimetype || 'unknown'}" is not allowed. Accepted types: ${Array.from(normalizedAllowed).join(', ')}`,
        ),
        false,
      );
    }

    return callback(null, true);
  };
}

export function createMulterOptions(
  config: CreateMulterOptionsConfig = {},
): MulterOptions {
  const maxFileSizeBytes = resolveMaxFileSizeBytes(config.maxFileSizeBytes);
  const allowedMimeTypes =
    config.allowedMimeTypes ?? DOCUMENT_ALLOWED_MIME_TYPES;

  return {
    storage: memoryStorage(),
    limits: {
      fileSize: maxFileSizeBytes,
    },
    fileFilter: createMimeFileFilter(allowedMimeTypes),
  };
}
