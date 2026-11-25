import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { OtpController } from './otp.controller';
import { OtpService } from './otp.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

describe('OtpController', () => {
    let controller: OtpController;
    let otpService: {
        sendOtp: jest.Mock;
        verifyOtp: jest.Mock;
    };

    beforeEach(async () => {
        otpService = {
            sendOtp: jest.fn(),
            verifyOtp: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [OtpController],
            providers: [
                { provide: OtpService, useValue: otpService },
            ],
        })
            .overrideGuard(JwtAuthGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(RolesGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<OtpController>(OtpController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('sendOtp', () => {
        it('delegates to OtpService.sendOtp with the dto and returns its result', async () => {
            const dto = { email: 'user@example.com' } as any;
            const expected = { message: 'OTP sent' };
            otpService.sendOtp.mockResolvedValue(expected);

            const result = await controller.sendOtp(dto);

            expect(otpService.sendOtp).toHaveBeenCalledWith(dto);
            expect(result).toBe(expected);
        });
    });

    describe('verifyOtp', () => {
        it('delegates to OtpService.verifyOtp with the dto and returns its result', async () => {
            const dto = { email: 'user@example.com', otp: '123456' } as any;
            const expected = { accessToken: 'token' };
            otpService.verifyOtp.mockResolvedValue(expected);

            const result = await controller.verifyOtp(dto);

            expect(otpService.verifyOtp).toHaveBeenCalledWith(dto);
            expect(result).toBe(expected);
        });
    });

    describe('guard and role wiring', () => {
        const reflector = new Reflector();

        it('applies JwtAuthGuard and RolesGuard at the controller level', () => {
            const guards = Reflect.getMetadata('__guards__', OtpController) || [];
            expect(guards).toEqual(
                expect.arrayContaining([JwtAuthGuard, RolesGuard]),
            );
        });

        it('declares roles metadata on protected routes', () => {
            const prototype = OtpController.prototype;
            const methodNames = Object.getOwnPropertyNames(prototype).filter(
                (name) => name !== 'constructor' && typeof (prototype as any)[name] === 'function',
            );

            const routesWithRoles = methodNames.filter(
                (name) => reflector.get(ROLES_KEY, (prototype as any)[name]) !== undefined,
            );

            expect(routesWithRoles.length).toBeGreaterThan(0);
        });
    });
});
