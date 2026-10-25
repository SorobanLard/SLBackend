import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryCoursesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter courses by category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter courses by difficulty level' })
  @IsOptional()
  @IsString()
  level?: string;

  @ApiPropertyOptional({ description: 'Search term for course title or description' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter courses by status', enum: CourseStatus })
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;
}
