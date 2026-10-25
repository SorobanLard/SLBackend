import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Default page size used by paginated list endpoints. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Hard upper bound for `limit` on every paginated endpoint.
 *
 * Keeping this in one place prevents clients from requesting unbounded,
 * unindexed scans (for example `?limit=999999`) across list endpoints.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Shared base query DTO for paginated list endpoints.
 *
 * Extend this class in module-specific query DTOs so that every endpoint
 * inherits the same `page`/`limit` validation rules:
 * - `page` must be an integer >= 1
 * - `limit` must be an integer between 1 and {@link MAX_PAGE_SIZE}
 *
 * Values are transformed from query-string strings into numbers before
 * validation, so `?page=2&limit=50` is accepted and bounded correctly.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    default: 1,
    minimum: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: `Number of items per page (max ${MAX_PAGE_SIZE})`,
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    example: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
