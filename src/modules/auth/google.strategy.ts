import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { GoogleAuthService } from './google-auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google', 6) {
  constructor(
    config: ConfigService,
    private readonly googleAuth: GoogleAuthService,
  ) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.get<string>(
        'GOOGLE_CALLBACK_URL',
        'http://localhost:3000/api/v1/auth/google/callback',
      ),
      scope: ['openid', 'email', 'profile'],
      passReqToCallback: true,
      state: true,
      store: {
        store: (req: any, cb: (err: Error | null, state?: string) => void) => {
          const state = req?.oauthState ?? googleAuth.createOAuthState();
          cb(null, state);
        },
        verify: (
          req: any,
          providedState: string,
          cb: (err: Error | null, ok?: boolean, state?: string) => void,
        ) => {
          if (!providedState || typeof providedState !== 'string') {
            return cb(null, false, 'Missing OAuth state parameter');
          }
          if (req?.oauthStateVerified || googleAuth.consumeOAuthState(providedState)) {
            return cb(null, true);
          }
          return cb(null, false, 'Invalid or expired Google OAuth state');
        },
      },
    } as any);
  }

  async validate(
    request: unknown,
    accessToken: string,
    refreshToken: string,
    params: { id_token?: string },
    profile: Profile,
    done: (error: Error | null, user?: unknown) => void,
  ) {
    if (!params.id_token) {
      throw new UnauthorizedException('Google did not return an ID token');
    }

    const identity = await this.googleAuth.verifyIdToken(params.id_token);
    const email = profile.emails?.[0];
    if (
      !email?.value ||
      !email.verified ||
      identity.googleId !== profile.id ||
      identity.email !== email.value.toLowerCase()
    ) {
      throw new UnauthorizedException('A verified Google email is required');
    }

    return identity;
  }
}