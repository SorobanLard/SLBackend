import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Query parameters for browsing course bundles. */
export class QueryBundlesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter bundles by instructor Stellar address' })
  @IsOptional()
  @IsString()
  instructorAddress?: string;
}
