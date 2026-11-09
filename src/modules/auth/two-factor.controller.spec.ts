import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { EnableTwoFactorDto, DisableTwoFactorDto } from './dto/two-factor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';
import { RoleThrottlerGuard } from '../../common/guards/role-throttler.guard';

describe('TwoFactorController', () => {
  let controller: TwoFactorController;
  let rolesGuard: RolesGuard;

  const mockTwoFactorService = {
    generateSecret: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    getStatus: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TwoFactorController],
      providers: [
        { provide: TwoFactorService, useValue: mockTwoFactorService },
        Reflector,
        RolesGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RoleThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<TwoFactorController>(TwoFactorController);
    rolesGuard = moduleRef.get<RolesGuard>(RolesGuard);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('setup (POST /auth/2fa/setup)', () => {
    it('delegates to TwoFactorService.generateSecret with userId and returns 200 OK metadata', async () => {
      const expected = {
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/SorobanLard:admin@test.com?secret=JBSWY3DPEHPK3PXP',
        qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      };
      mockTwoFactorService.generateSecret.mockResolvedValue(expected);

      const result = await controller.setup('admin-1');

      expect(result).toEqual(expected);
      expect(mockTwoFactorService.generateSecret).toHaveBeenCalledWith(
        'admin-1',
      );
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          TwoFactorController.prototype.setup,
        ),
      ).toBe(HttpStatus.OK);
    });
  });

  describe('enable (POST /auth/2fa/enable)', () => {
    it('delegates to TwoFactorService.enable with userId and dto.code', async () => {
      const dto: EnableTwoFactorDto = { code: '123456' };
      const expected = {
        enabled: true,
        recoveryCodes: ['ABCD-1234', 'EFGH-5678'],
      };
      mockTwoFactorService.enable.mockResolvedValue(expected);

      const result = await controller.enable('admin-1', dto);

      expect(result).toEqual(expected);
      expect(mockTwoFactorService.enable).toHaveBeenCalledWith(
        'admin-1',
        '123456',
      );
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          TwoFactorController.prototype.enable,
        ),
      ).toBe(HttpStatus.OK);
    });

    it('propagates BadRequestException when TOTP code is invalid', async () => {
      mockTwoFactorService.enable.mockRejectedValue(
        new BadRequestException('Invalid TOTP code'),
      );

      await expect(
        controller.enable('admin-1', { code: '000000' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('disable (POST /auth/2fa/disable)', () => {
    it('delegates to TwoFactorService.disable with userId and dto.code', async () => {
      const dto: DisableTwoFactorDto = { code: '654321' };
      const expected = { enabled: false };
      mockTwoFactorService.disable.mockResolvedValue(expected);

      const result = await controller.disable('instructor-1', dto);

      expect(result).toEqual(expected);
      expect(mockTwoFactorService.disable).toHaveBeenCalledWith(
        'instructor-1',
        '654321',
      );
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          TwoFactorController.prototype.disable,
        ),
      ).toBe(HttpStatus.OK);
    });

    it('propagates UnauthorizedException when verification code fails', async () => {
      mockTwoFactorService.disable.mockRejectedValue(
        new UnauthorizedException('Invalid TOTP or recovery code'),
      );

      await expect(
        controller.disable('instructor-1', { code: 'bad-code' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('status (GET /auth/2fa/status)', () => {
    it('delegates to TwoFactorService.getStatus with userId', async () => {
      const expected = {
        enabled: true,
        remainingRecoveryCodes: 8,
      };
      mockTwoFactorService.getStatus.mockResolvedValue(expected);

      const result = await controller.status('admin-1');

      expect(result).toEqual(expected);
      expect(mockTwoFactorService.getStatus).toHaveBeenCalledWith('admin-1');
    });
  });

  describe('role guards and invalid input validation', () => {
    const createMockExecutionContext = (
      handler: (...args: any[]) => any,
      role: UserRole,
    ): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => TwoFactorController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'user-1', role } }),
        }),
      }) as unknown as ExecutionContext;

    it('applies JwtAuthGuard, RolesGuard, and RoleThrottlerGuard at controller level and restricts access to ADMIN and INSTRUCTOR', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, TwoFactorController);
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard, RoleThrottlerGuard]),
      );
      expect(Reflect.getMetadata(ROLES_KEY, TwoFactorController)).toEqual([
        UserRole.ADMIN,
        UserRole.INSTRUCTOR,
      ]);

      const handlers = [
        TwoFactorController.prototype.setup,
        TwoFactorController.prototype.enable,
        TwoFactorController.prototype.disable,
        TwoFactorController.prototype.status,
      ];

      for (const handler of handlers) {
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.STUDENT),
          ),
        ).toBe(false);
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.ADMIN),
          ),
        ).toBe(true);
        expect(
          rolesGuard.canActivate(
            createMockExecutionContext(handler, UserRole.INSTRUCTOR),
          ),
        ).toBe(true);
      }
    });

    it('rejects invalid EnableTwoFactorDto and DisableTwoFactorDto inputs', async () => {
      const shortCode = plainToInstance(EnableTwoFactorDto, { code: '123' });
      expect((await validate(shortCode)).length).toBeGreaterThan(0);

      const longCode = plainToInstance(EnableTwoFactorDto, { code: '1234567' });
      expect((await validate(longCode)).length).toBeGreaterThan(0);

      const emptyDisableCode = plainToInstance(DisableTwoFactorDto, {
        code: '',
      });
      expect((await validate(emptyDisableCode)).length).toBeGreaterThan(0);
    });
  });
});
