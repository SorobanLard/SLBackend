import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsBoolean,
  IsDateString,
  Min,
  Max,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EnrollmentStatus } from '@prisma/client';

export enum EnrollmentConflictStrategy {
  SKIP = 'SKIP',
  OVERWRITE = 'OVERWRITE',
  MERGE = 'MERGE',
}

export class RestoreLessonProgressDto {
  @ApiProperty()
  @IsString()
  lessonId: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  watchedSecs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}

export class RestoreEnrollmentRecordDto {
  @ApiPropertyOptional({ description: 'Original enrollment id from backup' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsUUID()
  studentId: string;

  @ApiProperty()
  @IsString()
  courseId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amountPaid: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiPropertyOptional({ enum: EnrollmentStatus })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  progressPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  enrolledAt?: string;

  @ApiPropertyOptional({ type: [RestoreLessonProgressDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreLessonProgressDto)
  lessonProgress?: RestoreLessonProgressDto[];
}

export class RestoreEnrollmentsDto {
  @ApiProperty({ type: [RestoreEnrollmentRecordDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RestoreEnrollmentRecordDto)
  enrollments: RestoreEnrollmentRecordDto[];

  @ApiPropertyOptional({
    enum: EnrollmentConflictStrategy,
    default: EnrollmentConflictStrategy.SKIP,
    description:
      'SKIP keeps existing records, OVERWRITE replaces them, MERGE updates fields preferring higher progress',
  })
  @IsOptional()
  @IsEnum(EnrollmentConflictStrategy)
  conflictStrategy?: EnrollmentConflictStrategy;
}

/**
 * A single enrollment record that could not be restored.
 * `recordId` is the original backup id when present, otherwise the index of
 * the record within the submitted `enrollments` array so the admin UI can
 * retry just the failures.
 */
export class RestoreEnrollmentFailureDto {
  @ApiPropertyOptional({ description: 'Original enrollment id from backup, if provided' })
  @IsOptional()
  @IsString()
  recordId?: string;

  @ApiProperty({ description: 'Zero-based index of the record in the submitted batch' })
  @IsNumber()
  index: number;

  @ApiProperty({ description: 'Human-readable reason the record failed' })
  @IsString()
  reason: string;
}

/**
 * Structured result of a best-effort bulk enrollment restore.
 * The restore job is best-effort: each record is processed independently so a
 * single failure (e.g. FK violation on a deleted course) does not roll back the
 * records that succeeded. Callers can retry only the entries in `failed`.
 */
export class RestoreEnrollmentsResultDto {
  @ApiProperty({ description: 'Total number of records submitted' })
  @IsNumber()
  total: number;

  @ApiProperty({ description: 'IDs of records restored successfully', type: [String] })
  @IsArray()
  @IsString({ each: true })
  succeeded: string[];

  @ApiProperty({ type: [RestoreEnrollmentFailureDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreEnrollmentFailureDto)
  failed: RestoreEnrollmentFailureDto[];
}
