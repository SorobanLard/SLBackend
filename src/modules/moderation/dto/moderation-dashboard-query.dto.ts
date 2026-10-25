import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ReportCategory, ReportStatus, ReportTargetType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Filters for the admin moderation dashboard queue. */
export class ModerationDashboardQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;

  @ApiPropertyOptional({ enum: ReportCategory })
  @IsOptional()
  @IsEnum(ReportCategory)
  category?: ReportCategory;
}
