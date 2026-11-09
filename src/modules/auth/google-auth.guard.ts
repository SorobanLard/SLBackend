import {
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { GoogleAuthService } from './google-auth.service';

const ALLOWED_OAUTH_ISSUER_ORIGINS = new Set(['https://accounts.google.com']);

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(
    private readonly googleAuth: GoogleAuthService,
    @Optional() private readonly config?: ConfigService,
  ) {
    super();
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.path?.endsWith('/callback')) return {};

    const response = context.switchToHttp().getResponse<Response>();
    const state = this.googleAuth.createOAuthState();
    response.cookie('google_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(request.secure),
      maxAge: 5 * 60 * 1000,
    });
    return { state };
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.path?.endsWith('/callback')) {
      const response = context.switchToHttp().getResponse<Response>();
      this.verifyCallbackOrigin(request);

      const state = request.query?.state;
      const cookies = this.parseCookies(request.headers?.cookie);
      const cookieState = cookies.google_oauth_state;

      response?.clearCookie?.('google_oauth_state');

      if (
        typeof state !== 'string' ||
        !state ||
        typeof cookieState !== 'string' ||
        !this.safeEqual(cookieState, state) ||
        !this.googleAuth.consumeOAuthState(state)
      ) {
        throw new UnauthorizedException(
          'Invalid or expired Google OAuth state',
        );
      }
    }

    return super.canActivate(context);
  }

  private verifyCallbackOrigin(request: {
    headers?: Record<string, string | string[] | undefined>;
    protocol?: string;
    get?: (name: string) => string | undefined;
  }): void {
    const rawOrigin = request.headers?.origin;
    const originHeader = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    if (!originHeader || originHeader === 'null') {
      return;
    }

    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(originHeader).origin;
    } catch {
      throw new UnauthorizedException('Invalid OAuth callback origin');
    }

    const allowedOrigins = this.getAllowedCallbackOrigins(request);
    if (!allowedOrigins.has(normalizedOrigin)) {
      throw new UnauthorizedException('Untrusted OAuth callback origin');
    }
  }

  private getAllowedCallbackOrigins(request: {
    protocol?: string;
    headers?: Record<string, string | string[] | undefined>;
    get?: (name: string) => string | undefined;
  }): Set<string> {
    const allowed = new Set<string>(ALLOWED_OAUTH_ISSUER_ORIGINS);

    const configuredUrls = [
      this.config?.get<string>('FRONTEND_URL'),
      this.config?.get<string>('CORS_ORIGIN'),
      this.config?.get<string>('APP_BASE_URL'),
      this.config?.get<string>('PUBLIC_API_URL'),
      this.config?.get<string>('GOOGLE_CALLBACK_URL'),
    ];

    for (const candidate of configuredUrls) {
      if (!candidate) continue;
      for (const entry of candidate.split(',')) {
        try {
          allowed.add(new URL(entry.trim()).origin);
        } catch {
          // Ignore malformed optional URL entries
        }
      }
    }

    const host =
      request.get?.('host') ??
      (typeof request.headers?.host === 'string'
        ? request.headers.host
        : undefined);
    if (host) {
      const proto = request.protocol || 'http';
      allowed.add(`${proto}://${host}`);
    }

    return allowed;
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuf = Buffer.from(left, 'utf8');
    const rightBuf = Buffer.from(right, 'utf8');
    if (leftBuf.length !== rightBuf.length) {
      return false;
    }
    return timingSafeEqual(leftBuf, rightBuf);
  }

  private parseCookies(header?: string): Record<string, string> {
    return (header ?? '').split(';').reduce(
      (cookies, part) => {
        const separator = part.indexOf('=');
        if (separator === -1) return cookies;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (name) cookies[name] = decodeURIComponent(value);
        return cookies;
      },
      {} as Record<string, string>,
    );
  }
}
