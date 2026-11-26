import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('SessionsController', () => {
    let controller: SessionsController;
    let sessionsService: {
        findAllForUser: jest.Mock;
        revoke: jest.Mock;
        revokeAllForUser: jest.Mock;
    };

    const mockUser = { id: 'user-1', email: 'user@example.com', role: 'USER' };

    beforeEach(async () => {
        sessionsService = {
            findAllForUser: jest.fn(),
            revoke: jest.fn(),
            revokeAllForUser: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [SessionsController],
            providers: [
                { provide: SessionsService, useValue: sessionsService },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<SessionsController>(SessionsController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('findAll', () => {
        it('delegates to sessionsService.findAllForUser with the current user id', async () => {
            const sessions = [{ id: 'session-1' }];
            sessionsService.findAllForUser.mockResolvedValue(sessions);

            const result = await controller.findAll(mockUser as any);

            expect(sessionsService.findAllForUser).toHaveBeenCalledWith(mockUser.id);
            expect(result).toBe(sessions);
        });
    });

    describe('revoke', () => {
        it('delegates to sessionsService.revoke with the current user id and session id', async () => {
            sessionsService.revoke.mockResolvedValue({ success: true });

            const result = await controller.revoke('session-1', mockUser as any);

            expect(sessionsService.revoke).toHaveBeenCalledWith(mockUser.id, 'session-1');
            expect(result).toEqual({ success: true });
        });
    });

    describe('revokeAll', () => {
        it('delegates to sessionsService.revokeAllForUser with the current user id', async () => {
            sessionsService.revokeAllForUser.mockResolvedValue({ count: 2 });

            const result = await controller.revokeAll(mockUser as any);

            expect(sessionsService.revokeAllForUser).toHaveBeenCalledWith(mockUser.id);
            expect(result).toEqual({ count: 2 });
        });
    });

    describe('guard and role wiring', () => {
        const reflector = new Reflector();

        const getGuards = (handler: (...args: any[]) => any) =>
            reflector.getAllAndOverride<any[]>(GUARDS_METADATA, [
                handler,
                SessionsController,
            ]) ?? [];

        it('applies JwtAuthGuard and RolesGuard to the controller', () => {
            const guards = getGuards(SessionsController);
            expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
        });

        it.each([
            ['findAll', () => SessionsController.prototype.findAll],
            ['revoke', () => SessionsController.prototype.revoke],
            ['revokeAll', () => SessionsController.prototype.revokeAll],
        ])('protects %s with JwtAuthGuard and RolesGuard', (_name, getHandler) => {
            const guards = getGuards(getHandler());
            expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
        });

        it('declares required roles on protected routes', () => {
            const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
                SessionsController.prototype.findAll,
                SessionsController,
            ]);
            expect(roles).toBeDefined();
            expect(Array.isArray(roles)).toBe(true);
        });
    });
});
