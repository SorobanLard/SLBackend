import * as fs from 'fs';
import * as path from 'path';
import * as Sentry from '@sentry/node';

const SENSITIVE_FIELD = /authorization|cookie|password|secret|token|api[-_]?key|otp|email|phone/i;

/**
 * Issue #167 — resolve SENTRY_RELEASE at build/run time.
 *
 * Resolution order:
 *   1. process.env.SENTRY_RELEASE (set by CI/deployment)
 *   2. dist/sentry-release.env (written by the `postbuild` script from package.json version)
 *   3. npm_package_version (set by npm while running npm scripts)
 *   4. hardcoded "0.1.0" fallback
 */
function resolveSentryRelease(): string {
  if (process.env.SENTRY_RELEASE) {
    return process.env.SENTRY_RELEASE;
  }

  const envFile = path.resolve(process.cwd(), 'dist', 'sentry-release.env');
  try {
    if (fs.existsSync(envFile)) {
      const match = fs
        .readFileSync(envFile, 'utf8')
        .match(/^SENTRY_RELEASE=(.+)$/m);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  } catch {
    // Ignore unreadable env file; fall through to npm_package_version.
  }

  return `sorobanlard-backend@${process.env.npm_package_version || '0.1.0'}`;
}

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

export function initializeSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: resolveSentryRelease(),
    beforeSend: (event) => scrubSentryEvent(event),
  });
}