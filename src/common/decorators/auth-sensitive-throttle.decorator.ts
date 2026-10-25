import { applyDecorators } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';
import { RoleThrottlerGuard } from '../guards/role-throttler.guard';

/**
 * Shared throttling wiring for auth-adjacent controllers (2FA, OTP, sessions).
 *
 * Composes the rate-limit policy (`@Throttle`) with the role-aware throttler
 * guard (`RoleThrottlerGuard`) so the configuration stays consistent across
 * every sensitive auth controller instead of being copy-pasted per file.
 *
 * Defaults preserve the existing auth rate-limit policy. Callers may override
 * the limit/ttl when a specific endpoint needs a different budget.
 */
export function AuthSensitiveThrottle(
  limit = 5,
  ttl = 60_000,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    Throttle({ default: { limit, ttl } }),
    UseGuards(RoleThrottlerGuard),
  );
}
