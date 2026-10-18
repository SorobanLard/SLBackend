import { BadRequestException } from '@nestjs/common';

/**
 * Shared helpers for report controllers/services.
 *
 * These utilities centralise the date-range parsing and response-envelope
 * shaping that was previously duplicated across the individual report
 * controllers. They are pure functions and do not change any public
 * endpoint contract.
 */

export interface DateRange {
  startDate?: Date;
  endDate?: Date;
}

export interface DateRangeQuery {
  startDate?: string | Date;
  endDate?: string | Date;
}

/**
 * Parse an optional date value into a Date instance.
 * Returns undefined when the value is absent.
 */
export function parseOptionalDate(
  value: string | Date | undefined,
  field: string,
): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Invalid ${field} date`);
  }

  return date;
}

/**
 * Resolve a startDate/endDate pair from a query object, validating that the
 * range is coherent. Defaults are left to the caller so behaviour is
 * preserved per endpoint.
 */
export function resolveDateRange(query: DateRangeQuery = {}): DateRange {
  const startDate = parseOptionalDate(query.startDate, 'startDate');
  const endDate = parseOptionalDate(query.endDate, 'endDate');

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new BadRequestException('startDate must be before endDate');
  }

  return { startDate, endDate };
}

/**
 * Shape a report response into the standard envelope used by report
 * endpoints. Keeps the existing `{ data, meta }` payload shape intact.
 */
export function buildReportEnvelope<T>(
  data: T,
  meta: Record<string, unknown> = {},
): { data: T; meta: Record<string, unknown> } {
  return { data, meta };
}
