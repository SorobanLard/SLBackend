import { BadRequestException } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/pdf',
];

export async function validateFileMimeType(buffer: Buffer, filename: string): Promise<void> {
  const fileType = await fileTypeFromBuffer(buffer);

  if (!fileType) {
    throw new BadRequestException(
      `Unable to determine file type for ${filename}. Only PNG, JPEG, and PDF files are allowed.`,
    );
  }

  if (!ALLOWED_MIME_TYPES.includes(fileType.mime)) {
    throw new BadRequestException(
      `Invalid file type ${fileType.mime} for ${filename}. Only PNG, JPEG, and PDF files are allowed.`,
    );
  }
}
