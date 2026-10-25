import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CronJobStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryCronRunsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by job name' })
  @IsOptional()
  @IsString()
  jobName?: string;

  @ApiPropertyOptional({ enum: CronJobStatus, description: 'Filter by run status' })
  @IsOptional()
  @IsEnum(CronJobStatus)
  status?: CronJobStatus;

  @ApiPropertyOptional({ description: 'ISO date-time lower bound for startedAt' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date-time upper bound for startedAt' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
