import * as Sentry from '@sentry/node';

const SENSITIVE_FIELD = /authorization|cookie|password|secret|token|api[-_]?key|otp|email|phone/i;

export const CORRELATION_ID_TAG = 'correlation_id';

export function scrubSentryEvent<T>(event: T): T {
  return scrubValue(event) as T;
}

function scrubValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_FIELD.test(key)) {
    return '[Filtered]';
  }

  if (key === 'query_string') {
    return undefined;
  }

  if (key === 'url' && typeof value === 'string') {
    return value.replace(/[?#].*$/, '');
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([entryKey, entryValue]) => {
        const scrubbedValue = scrubValue(entryValue, entryKey);
        return scrubbedValue === undefined ? [] : [[entryKey, scrubbedValue]];
      }),
    );
  }

  return value;
}

/**
 * Attach the request/job correlation ID to the active Sentry scope so it is
 * included as a tag on every event (sync request errors and async job failures).
 */
export function setSentryCorrelationId(correlationId?: string | null): void {
  if (!correlationId) {
    return;
  }

  Sentry.getCurrentScope().setTag(CORRELATION_ID_TAG, correlationId);
}

/**
 * Run `fn` with the correlation ID tagged on an isolated Sentry scope, so
 * concurrent requests/jobs do not leak tags into each other's events.
 */
export function withSentryCorrelationId<T>(correlationId: string | null | undefined, fn: () => T): T {
  if (!correlationId) {
    return fn();
  }

  return Sentry.withScope((scope) => {
    scope.setTag(CORRELATION_ID_TAG, correlationId);
    return fn();
  });
}

export function initializeSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || `sorobanlard-backend@${process.env.npm_package_version || '0.1.0'}`,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}