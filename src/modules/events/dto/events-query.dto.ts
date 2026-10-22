import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Query parameters for the on-chain event feed. */
export class EventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter events by course id' })
  @IsOptional()
  @IsString()
  courseId?: string;
}
