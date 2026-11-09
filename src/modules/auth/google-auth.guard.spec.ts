import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { GoogleAuthGuard } from './google-auth.guard';
import { GoogleAuthService } from './google-auth.service';

describe('GoogleAuthGuard (OAuth CSRF state and origin verification)', () => {
  let guard: GoogleAuthGuard;
  let mockGoogleAuthService: jest.Mocked<
    Pick<GoogleAuthService, 'createOAuthState' | 'consumeOAuthState'>
  >;
  let mockConfigService: Partial<ConfigService>;

  const createContext = (
    reqOverrides: Record<string, any> = {},
    resOverrides: Record<string, any> = {},
  ) => {
    const req = {
      path: '/api/v1/auth/google/callback',
      protocol: 'https',
      secure: true,
      query: {},
      headers: { host: 'api.sorobanlard.com' },
      get: (header: string) =>
        header.toLowerCase() === 'host' ? 'api.sorobanlard.com' : undefined,
      ...reqOverrides,
    };
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      ...resOverrides,
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    return { context, req, res };
  };

  beforeEach(() => {
    mockGoogleAuthService = {
      createOAuthState: jest.fn().mockReturnValue('state-token-123'),
      consumeOAuthState: jest.fn().mockReturnValue(true),
    };
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'FRONTEND_URL') return 'https://app.sorobanlard.com';
        return undefined;
      }),
    };

    guard = new GoogleAuthGuard(
      mockGoogleAuthService as unknown as GoogleAuthService,
      mockConfigService as ConfigService,
    );

    jest
      .spyOn(AuthGuard('google').prototype, 'canActivate')
      .mockResolvedValue(true as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getAuthenticateOptions (OAuth initiation)', () => {
    it('creates a state nonce, sets an httpOnly lax cookie, and passes state to Passport', () => {
      const { context, res } = createContext({
        path: '/api/v1/auth/google',
        secure: true,
      });

      const options = guard.getAuthenticateOptions(context);

      expect(mockGoogleAuthService.createOAuthState).toHaveBeenCalledTimes(1);
      expect(res.cookie).toHaveBeenCalledWith(
        'google_oauth_state',
        'state-token-123',
        {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          maxAge: 5 * 60 * 1000,
        },
      );
      expect(options).toEqual({ state: 'state-token-123' });
    });

    it('returns empty options on the callback route without minting a new state', () => {
      const { context, res } = createContext({
        path: '/api/v1/auth/google/callback',
      });

      const options = guard.getAuthenticateOptions(context);

      expect(options).toEqual({});
      expect(mockGoogleAuthService.createOAuthState).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('canActivate (OAuth callback CSRF state & origin checks)', () => {
    it('allows callback when state query matches google_oauth_state cookie and is unconsumed', async () => {
      const { context, res } = createContext({
        query: { state: 'state-token-123', code: 'auth-code' },
        headers: {
          host: 'api.sorobanlard.com',
          cookie: 'google_oauth_state=state-token-123; theme=dark',
          origin: 'https://accounts.google.com',
        },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(mockGoogleAuthService.consumeOAuthState).toHaveBeenCalledWith(
        'state-token-123',
      );
      expect(res.clearCookie).toHaveBeenCalledWith('google_oauth_state');
    });

    it('rejects callback when state query parameter is missing', () => {
      const { context, res } = createContext({
        query: { code: 'auth-code' },
        headers: { cookie: 'google_oauth_state=state-token-123' },
      });

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
      expect(res.clearCookie).toHaveBeenCalledWith('google_oauth_state');
      expect(mockGoogleAuthService.consumeOAuthState).not.toHaveBeenCalled();
    });

    it('rejects callback when google_oauth_state cookie is missing', () => {
      const { context } = createContext({
        query: { state: 'state-token-123', code: 'auth-code' },
        headers: {},
      });

      expect(() => guard.canActivate(context)).toThrow(
        'Invalid or expired Google OAuth state',
      );
      expect(mockGoogleAuthService.consumeOAuthState).not.toHaveBeenCalled();
    });

    it('rejects callback when cookie state and query state do not match', () => {
      const { context } = createContext({
        query: { state: 'forged-state-999', code: 'auth-code' },
        headers: { cookie: 'google_oauth_state=state-token-123' },
      });

      expect(() => guard.canActivate(context)).toThrow(
        'Invalid or expired Google OAuth state',
      );
      expect(mockGoogleAuthService.consumeOAuthState).not.toHaveBeenCalled();
    });

    it('rejects callback when state has expired or already been consumed (replay)', () => {
      mockGoogleAuthService.consumeOAuthState.mockReturnValueOnce(false);
      const { context } = createContext({
        query: { state: 'state-token-123', code: 'auth-code' },
        headers: { cookie: 'google_oauth_state=state-token-123' },
      });

      expect(() => guard.canActivate(context)).toThrow(
        'Invalid or expired Google OAuth state',
      );
      expect(mockGoogleAuthService.consumeOAuthState).toHaveBeenCalledWith(
        'state-token-123',
      );
    });

    it('rejects callback when an untrusted cross-origin Origin header is present', () => {
      const { context } = createContext({
        query: { state: 'state-token-123', code: 'auth-code' },
        headers: {
          host: 'api.sorobanlard.com',
          cookie: 'google_oauth_state=state-token-123',
          origin: 'https://evil-attacker.example.com',
        },
      });

      expect(() => guard.canActivate(context)).toThrow(
        'Untrusted OAuth callback origin',
      );
      expect(mockGoogleAuthService.consumeOAuthState).not.toHaveBeenCalled();
    });
  });
});
