import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export enum LeaderboardScope {
  GLOBAL = 'global',
  COURSE = 'course',
}

export class LeaderboardQueryDto extends PaginationQueryDto {
  @ApiProperty({ enum: LeaderboardScope, description: 'Scope for leaderboard ranking (global or course)' })
  @IsEnum(LeaderboardScope)
  scope: LeaderboardScope;

  @ApiPropertyOptional({ description: 'Required if scope is course' })
  @IsOptional()
  @IsString()
  courseId?: string;
}
