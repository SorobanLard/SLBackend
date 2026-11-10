import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '@prisma/client';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { EnableTwoFactorDto, DisableTwoFactorDto } from './dto/two-factor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';
import { RoleThrottlerGuard } from '../../common/guards/role-throttler.guard';

describe('TwoFactorController', () => {
  let controller: TwoFactorController;

  const mockTwoFactorService = {
    generateSecret: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    getStatus: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => defaultValue),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TwoFactorController],
      providers: [
        { provide: TwoFactorService, useValue: mockTwoFactorService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<TwoFactorController>(TwoFactorController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /auth/2fa/setup', () => {
    it('delegates to TwoFactorService.generateSecret and returns enrollment payload', async () => {
      const payload = {
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/SorobanLard:admin%40example.com?secret=JBSWY3DPEHPK3PXP',
        qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      };
      mockTwoFactorService.generateSecret.mockResolvedValue(payload);

      const result = await controller.setup('user-1');

      expect(mockTwoFactorService.generateSecret).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(payload);
    });

    it('propagates BadRequestException when 2FA is already enabled', async () => {
      mockTwoFactorService.generateSecret.mockRejectedValue(
        new BadRequestException('Two-factor authentication is already enabled for this account'),
      );

      await expect(controller.setup('user-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /auth/2fa/enable', () => {
    it('delegates to TwoFactorService.enable with userId and code and returns recovery codes', async () => {
      const dto: EnableTwoFactorDto = { code: '123456' };
      const response = {
        enabled: true,
        recoveryCodes: ['ABCDE-12345', 'FGHIJ-67890'],
      };
      mockTwoFactorService.enable.mockResolvedValue(response);

      const result = await controller.enable('user-1', dto);

      expect(mockTwoFactorService.enable).toHaveBeenCalledWith('user-1', '123456');
      expect(result).toEqual(response);
    });

    it('rejects invalid TOTP code with UnauthorizedException', async () => {
      mockTwoFactorService.enable.mockRejectedValue(
        new UnauthorizedException('Invalid two-factor authentication code'),
      );

      await expect(
        controller.enable('user-1', { code: '000000' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('validates EnableTwoFactorDto and rejects codes that are not 6 characters', async () => {
      const shortCode = plainToInstance(EnableTwoFactorDto, { code: '123' });
      const emptyCode = plainToInstance(EnableTwoFactorDto, { code: '' });
      const validCode = plainToInstance(EnableTwoFactorDto, { code: '123456' });

      expect(await validate(shortCode)).not.toHaveLength(0);
      expect(await validate(emptyCode)).not.toHaveLength(0);
      expect(await validate(validCode)).toHaveLength(0);
    });
  });

  describe('POST /auth/2fa/disable', () => {
    it('delegates to TwoFactorService.disable with userId and code', async () => {
      const dto: DisableTwoFactorDto = { code: '654321' };
      mockTwoFactorService.disable.mockResolvedValue({ enabled: false });

      const result = await controller.disable('user-1', dto);

      expect(mockTwoFactorService.disable).toHaveBeenCalledWith('user-1', '654321');
      expect(result).toEqual({ enabled: false });
    });

    it('rejects invalid code during disable with UnauthorizedException', async () => {
      mockTwoFactorService.disable.mockRejectedValue(
        new UnauthorizedException('Invalid two-factor authentication code'),
      );

      await expect(
        controller.disable('user-1', { code: 'wrong-code' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('GET /auth/2fa/status', () => {
    it('delegates to TwoFactorService.getStatus and returns 2FA status', async () => {
      const status = { enabled: true, enabledAt: new Date('2026-01-01T00:00:00Z') };
      mockTwoFactorService.getStatus.mockResolvedValue(status);

      const result = await controller.status('user-1');

      expect(mockTwoFactorService.getStatus).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(status);
    });
  });

  describe('guards and role restrictions', () => {
    it('applies JwtAuthGuard, RolesGuard, and RoleThrottlerGuard at controller level', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, TwoFactorController);
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard, RoleThrottlerGuard]),
      );
    });

    it('restricts controller routes to ADMIN and INSTRUCTOR roles', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, TwoFactorController);
      expect(roles).toEqual([UserRole.ADMIN, UserRole.INSTRUCTOR]);
    });

    it('denies access to a forbidden role (STUDENT) via RolesGuard', () => {
      const rolesGuard = new RolesGuard(new Reflector());
      const makeContext = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => TwoFactorController.prototype.setup,
          getClass: () => TwoFactorController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u-1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(makeContext(UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(makeContext(UserRole.INSTRUCTOR))).toBe(true);
      expect(rolesGuard.canActivate(makeContext(UserRole.ADMIN))).toBe(true);
    });
  });
});
