import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query parameters for the instructor's pending-assignment submissions list.
 * Inherits validated `page`/`limit` bounds from {@link PaginationQueryDto}.
 */
export class PendingSubmissionsQueryDto extends PaginationQueryDto {}
