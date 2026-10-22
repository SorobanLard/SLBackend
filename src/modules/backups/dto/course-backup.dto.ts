import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from "class-validator";
import { CourseBackupStatus } from "@prisma/client";
import { PaginationQueryDto } from "../../../common/dto/pagination-query.dto";
import { RestoreCourseBackupDto } from "./restore-course.dto";

export class RequestCourseBackupDto {
  @ApiPropertyOptional({ description: "ID of the course to backup" })
  @IsOptional()
  @IsString()
  courseId?: string;
}

export class QueryCourseBackupsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CourseBackupStatus })
  @IsOptional()
  @IsEnum(CourseBackupStatus)
  status?: CourseBackupStatus;

  @ApiPropertyOptional({ description: "Filter by automatic/scheduled backups" })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isAutomatic?: boolean;
}

export interface MissingElementInfo {
  moduleId: string;
  moduleTitle?: string;
  lessonId: string;
  lessonTitle: string;
  field: string;
  message: string;
}

export interface CourseBackupValidationReport {
  isComplete: boolean;
  errors: string[];
  warnings: string[];
  totalModules: number;
  totalLessons: number;
  totalVideoLessons: number;
  totalTextLessons: number;
  missingContentLessons: MissingElementInfo[];
  missingVideoLessons: MissingElementInfo[];
}

export interface CourseBackupExportPayload {
  formatVersion: string;
  courseBackupVersion: number;
  courseId: string;
  exportedAt: string;
  isAutomatic: boolean;
  requestedBy: string | null;
  checksum: string;
  course: RestoreCourseBackupDto;
  validationReport: CourseBackupValidationReport;
}
