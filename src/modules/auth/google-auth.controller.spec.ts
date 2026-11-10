import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleAuthGuard } from './google-auth.guard';
import { GoogleAuthService, GoogleIdentity } from './google-auth.service';
import { GoogleStrategy } from './google.strategy';

describe('GoogleAuthController & Google OAuth CSRF state verification', () => {
  const identity: GoogleIdentity = {
    googleId: 'google-123',
    email: 'student@example.com',
    emailVerified: true,
    name: 'Student Example',
  };

  let stateStore: Set<string>;
  let mockGoogleAuthService: {
    createOAuthState: jest.Mock;
    consumeOAuthState: jest.Mock;
    login: jest.Mock;
    loginWithIdToken: jest.Mock;
    verifyIdToken: jest.Mock;
  };
  let controller: GoogleAuthController;
  let guard: GoogleAuthGuard;

  beforeEach(() => {
    stateStore = new Set<string>();
    mockGoogleAuthService = {
      createOAuthState: jest.fn(() => {
        const s = 'valid-oauth-state-token';
        stateStore.add(s);
        return s;
      }),
      consumeOAuthState: jest.fn((state: string) => {
        if (!stateStore.has(state)) return false;
        stateStore.delete(state);
        return true;
      }),
      login: jest.fn().mockResolvedValue({
        accessToken: 'jwt-access',
        refreshToken: 'jwt-refresh',
        user: { id: 'u-1', email: identity.email },
      }),
      loginWithIdToken: jest.fn(),
      verifyIdToken: jest.fn().mockResolvedValue(identity),
    };

    controller = new GoogleAuthController(
      mockGoogleAuthService as unknown as GoogleAuthService,
    );
    guard = new GoogleAuthGuard(
      mockGoogleAuthService as unknown as GoogleAuthService,
    );

    jest
      .spyOn(AuthGuard('google').prototype, 'canActivate')
      .mockReturnValue(true as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const makeCallbackContext = (
    query: Record<string, any>,
    cookieHeader?: string,
  ) => {
    const clearCookie = jest.fn();
    const request: any = {
      path: '/api/v1/auth/google/callback',
      query,
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    };
    const response: any = { clearCookie };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { context, request, clearCookie };
  };

  it('issues a state token and sets an httpOnly cookie when starting OAuth flow', () => {
    const cookie = jest.fn();
    const request: any = { path: '/api/v1/auth/google', secure: true };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ cookie }),
      }),
    } as unknown as ExecutionContext;

    const options = guard.getAuthenticateOptions(context);

    expect(options).toEqual({ state: 'valid-oauth-state-token' });
    expect(cookie).toHaveBeenCalledWith(
      'google_oauth_state',
      'valid-oauth-state-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
      }),
    );
  });

  it('rejects callback when state query parameter is missing', () => {
    const state = mockGoogleAuthService.createOAuthState();
    const { context } = makeCallbackContext(
      {},
      `google_oauth_state=${state}`,
    );

    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Invalid or expired Google OAuth state'),
    );
  });

  it('rejects callback when state cookie is missing', () => {
    const state = mockGoogleAuthService.createOAuthState();
    const { context } = makeCallbackContext({ state }, undefined);

    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Invalid or expired Google OAuth state'),
    );
  });

  it('rejects callback when query state does not match cookie state (CSRF mismatch)', () => {
    const state = mockGoogleAuthService.createOAuthState();
    const { context } = makeCallbackContext(
      { state: 'attacker-forged-state' },
      `google_oauth_state=${state}`,
    );

    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Invalid or expired Google OAuth state'),
    );
  });

  it('rejects callback when state has already been consumed (replay attack)', () => {
    const state = mockGoogleAuthService.createOAuthState();
    const first = makeCallbackContext(
      { state },
      `google_oauth_state=${state}`,
    );

    expect(guard.canActivate(first.context)).toBe(true);
    expect(first.clearCookie).toHaveBeenCalledWith('google_oauth_state');

    const replay = makeCallbackContext(
      { state },
      `google_oauth_state=${state}`,
    );
    expect(() => guard.canActivate(replay.context)).toThrow(
      new UnauthorizedException('Invalid or expired Google OAuth state'),
    );
  });

  it('configures GoogleStrategy with a state verification store that rejects invalid state', () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        const map: Record<string, string> = {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
        };
        return map[key] ?? fallback;
      }),
    } as unknown as ConfigService;

    const strategy = new GoogleStrategy(
      config,
      mockGoogleAuthService as unknown as GoogleAuthService,
    );
    const stateStoreImpl = (strategy as any)._stateStore;

    expect(stateStoreImpl).toBeDefined();

    const verifyCb = jest.fn();
    stateStoreImpl.verify({}, 'unknown-state', verifyCb);
    expect(verifyCb).toHaveBeenCalledWith(
      null,
      false,
      'Invalid or expired Google OAuth state',
    );
  });

  it('completes login in GoogleAuthController.callback when user is authenticated', async () => {
    const req: any = {
      user: identity,
      headers: { 'user-agent': 'jest-test' },
      ip: '127.0.0.1',
    };

    const result = await controller.callback(req);

    expect(mockGoogleAuthService.login).toHaveBeenCalledWith(identity, {
      userAgent: 'jest-test',
      ipAddress: '127.0.0.1',
    });
    expect(result.accessToken).toBe('jwt-access');
  });
});
