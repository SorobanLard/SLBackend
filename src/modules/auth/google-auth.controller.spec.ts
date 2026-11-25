import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { GoogleAuthController } from './google-auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('GoogleAuthController', () => {
    let controller: GoogleAuthController;
    let authService: {
        googleLogin: jest.Mock;
        googleCallback: jest.Mock;
        linkGoogleAccount: jest.Mock;
        unlinkGoogleAccount: jest.Mock;
    };

    beforeEach(async () => {
        authService = {
            googleLogin: jest.fn(),
            googleCallback: jest.fn(),
            linkGoogleAccount: jest.fn(),
            unlinkGoogleAccount: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [GoogleAuthController],
            providers: [{ provide: AuthService, useValue: authService }],
        }).compile();

        controller = module.get<GoogleAuthController>(GoogleAuthController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('googleLogin', () => {
        it('delegates to authService.googleLogin', async () => {
            const result = { url: 'https://accounts.google.com/o/oauth2/auth' };
            authService.googleLogin.mockResolvedValue(result);

            await expect(controller.googleLogin()).resolves.toBe(result);
            expect(authService.googleLogin).toHaveBeenCalledTimes(1);
        });
    });

    describe('googleCallback', () => {
        it('delegates to authService.googleCallback with the code and state', async () => {
            const result = { accessToken: 'access', refreshToken: 'refresh' };
            authService.googleCallback.mockResolvedValue(result);

            await expect(controller.googleCallback('auth-code', 'state-value')).resolves.toBe(result);
            expect(authService.googleCallback).toHaveBeenCalledWith('auth-code', 'state-value');
        });
    });

    describe('linkGoogleAccount', () => {
        it('delegates to authService.linkGoogleAccount with the user and code', async () => {
            const user = { id: 'user-1' } as any;
            const result = { success: true };
            authService.linkGoogleAccount.mockResolvedValue(result);

            await expect(controller.linkGoogleAccount(user, 'auth-code')).resolves.toBe(result);
            expect(authService.linkGoogleAccount).toHaveBeenCalledWith(user, 'auth-code');
        });
    });

    describe('unlinkGoogleAccount', () => {
        it('delegates to authService.unlinkGoogleAccount with the user', async () => {
            const user = { id: 'user-1' } as any;
            const result = { success: true };
            authService.unlinkGoogleAccount.mockResolvedValue(result);

            await expect(controller.unlinkGoogleAccount(user)).resolves.toBe(result);
            expect(authService.unlinkGoogleAccount).toHaveBeenCalledWith(user);
        });
    });

    describe('guard and role wiring', () => {
        const reflector = new Reflector();

        const getGuards = (method: string) =>
            Reflect.getMetadata('__guards__', (GoogleAuthController.prototype as any)[method]) as any[] | undefined;

        it('applies JwtAuthGuard and RolesGuard to protected routes', () => {
            for (const method of ['linkGoogleAccount', 'unlinkGoogleAccount']) {
                const guards = getGuards(method) ?? [];
                expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
            }
        });

        it('does not guard the public OAuth routes', () => {
            expect(getGuards('googleLogin') ?? []).toHaveLength(0);
            expect(getGuards('googleCallback') ?? []).toHaveLength(0);
        });

        it('declares roles metadata on protected routes', () => {
            for (const method of ['linkGoogleAccount', 'unlinkGoogleAccount']) {
                const roles = reflector.get(
                    ROLES_KEY,
                    (GoogleAuthController.prototype as any)[method],
                );
                expect(roles).toBeDefined();
            }
        });
    });
});
