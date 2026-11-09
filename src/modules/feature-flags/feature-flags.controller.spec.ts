import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ExecutionContext,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { EvaluateFeatureFlagDto } from './dto/evaluate-feature-flag.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../common/guards/roles.guard';

describe('FeatureFlagsController', () => {
  let controller: FeatureFlagsController;

  const mockFeatureFlagsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    enable: jest.fn(),
    disable: jest.fn(),
    evaluate: jest.fn(),
    evaluateAll: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsController],
      providers: [
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get<FeatureFlagsController>(FeatureFlagsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('CRUD and toggle routes', () => {
    it('create delegates to FeatureFlagsService.create and declares 201 CREATED', async () => {
      const dto: CreateFeatureFlagDto = {
        key: 'new_payment_flow',
        description: 'New Soroban checkout flow',
        enabled: true,
        rolloutPercent: 50,
      };
      const expected = { id: 'ff-1', ...dto };
      mockFeatureFlagsService.create.mockResolvedValue(expected);

      const result = await controller.create(dto);

      expect(result).toEqual(expected);
      expect(mockFeatureFlagsService.create).toHaveBeenCalledWith(dto);
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          FeatureFlagsController.prototype.create,
        ),
      ).toBe(HttpStatus.CREATED);
    });

    it('findAll delegates to FeatureFlagsService.findAll', async () => {
      const expected = [{ key: 'new_payment_flow', enabled: true }];
      mockFeatureFlagsService.findAll.mockResolvedValue(expected);

      expect(await controller.findAll()).toEqual(expected);
      expect(mockFeatureFlagsService.findAll).toHaveBeenCalledTimes(1);
    });

    it('findOne delegates to FeatureFlagsService.findOne and propagates NotFoundException', async () => {
      const expected = { key: 'new_payment_flow', enabled: true };
      mockFeatureFlagsService.findOne.mockResolvedValueOnce(expected);

      expect(await controller.findOne('new_payment_flow')).toEqual(expected);
      expect(mockFeatureFlagsService.findOne).toHaveBeenCalledWith(
        'new_payment_flow',
      );

      mockFeatureFlagsService.findOne.mockRejectedValueOnce(
        new NotFoundException('Flag not found'),
      );
      await expect(controller.findOne('missing_flag')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('update delegates to FeatureFlagsService.update with key and dto', async () => {
      const dto: UpdateFeatureFlagDto = { rolloutPercent: 100 } as any;
      const expected = { key: 'new_payment_flow', rolloutPercent: 100 };
      mockFeatureFlagsService.update.mockResolvedValue(expected);

      expect(await controller.update('new_payment_flow', dto)).toEqual(expected);
      expect(mockFeatureFlagsService.update).toHaveBeenCalledWith(
        'new_payment_flow',
        dto,
      );
    });

    it('remove delegates to FeatureFlagsService.remove with key', async () => {
      const expected = { deleted: true, key: 'new_payment_flow' };
      mockFeatureFlagsService.remove.mockResolvedValue(expected);

      expect(await controller.remove('new_payment_flow')).toEqual(expected);
      expect(mockFeatureFlagsService.remove).toHaveBeenCalledWith(
        'new_payment_flow',
      );
    });

    it('enable and disable delegate to FeatureFlagsService.enable / disable', async () => {
      mockFeatureFlagsService.enable.mockResolvedValue({
        key: 'new_payment_flow',
        enabled: true,
      });
      mockFeatureFlagsService.disable.mockResolvedValue({
        key: 'new_payment_flow',
        enabled: false,
      });

      expect(await controller.enable('new_payment_flow')).toEqual({
        key: 'new_payment_flow',
        enabled: true,
      });
      expect(mockFeatureFlagsService.enable).toHaveBeenCalledWith(
        'new_payment_flow',
      );

      expect(await controller.disable('new_payment_flow')).toEqual({
        key: 'new_payment_flow',
        enabled: false,
      });
      expect(mockFeatureFlagsService.disable).toHaveBeenCalledWith(
        'new_payment_flow',
      );
    });
  });

  describe('evaluate and evaluateAll routes', () => {
    it('evaluate uses caller userId/role by default and allows query overrides', async () => {
      mockFeatureFlagsService.evaluate.mockResolvedValue({
        key: 'new_payment_flow',
        enabled: true,
      });

      await controller.evaluate(
        'new_payment_flow',
        'caller-1',
        'STUDENT',
        {} as EvaluateFeatureFlagDto,
      );
      expect(mockFeatureFlagsService.evaluate).toHaveBeenCalledWith(
        'new_payment_flow',
        { userId: 'caller-1', role: 'STUDENT' },
      );

      await controller.evaluate('new_payment_flow', 'caller-1', 'STUDENT', {
        userId: 'override-user',
        role: 'INSTRUCTOR',
      } as EvaluateFeatureFlagDto);
      expect(mockFeatureFlagsService.evaluate).toHaveBeenCalledWith(
        'new_payment_flow',
        { userId: 'override-user', role: 'INSTRUCTOR' },
      );
    });

    it('evaluateAll delegates to FeatureFlagsService.evaluateAll with resolved context', async () => {
      const expected = { new_payment_flow: true };
      mockFeatureFlagsService.evaluateAll.mockResolvedValue(expected);

      const result = await controller.evaluateAll(
        'caller-1',
        'STUDENT',
        {} as EvaluateFeatureFlagDto,
      );

      expect(result).toEqual(expected);
      expect(mockFeatureFlagsService.evaluateAll).toHaveBeenCalledWith({
        userId: 'caller-1',
        role: 'STUDENT',
      });
    });
  });

  describe('guard wiring and DTO validation', () => {
    it('applies JwtAuthGuard + RolesGuard and @Roles(ADMIN) on all admin routes, and JwtAuthGuard only on evaluate routes', () => {
      const adminHandlers = [
        FeatureFlagsController.prototype.create,
        FeatureFlagsController.prototype.findAll,
        FeatureFlagsController.prototype.findOne,
        FeatureFlagsController.prototype.update,
        FeatureFlagsController.prototype.remove,
        FeatureFlagsController.prototype.enable,
        FeatureFlagsController.prototype.disable,
      ];

      for (const handler of adminHandlers) {
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
          JwtAuthGuard,
          RolesGuard,
        ]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
          UserRole.ADMIN,
        ]);
      }

      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          FeatureFlagsController.prototype.evaluate,
        ),
      ).toEqual([JwtAuthGuard]);
      expect(
        Reflect.getMetadata(
          GUARDS_METADATA,
          FeatureFlagsController.prototype.evaluateAll,
        ),
      ).toEqual([JwtAuthGuard]);
    });

    it('denies non-ADMIN roles on admin routes via RolesGuard', () => {
      const reflector = new Reflector();
      const rolesGuard = new RolesGuard(reflector);
      const makeCtx = (role: UserRole): ExecutionContext =>
        ({
          getHandler: () => FeatureFlagsController.prototype.create,
          getClass: () => FeatureFlagsController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(makeCtx(UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(makeCtx(UserRole.INSTRUCTOR))).toBe(false);
      expect(rolesGuard.canActivate(makeCtx(UserRole.ADMIN))).toBe(true);
    });

    it('validates CreateFeatureFlagDto key format and rolloutPercent bounds', async () => {
      const invalidDto = plainToInstance(CreateFeatureFlagDto, {
        key: 'Invalid-Key-With-Dashes!',
        rolloutPercent: 150,
      });
      const errors = await validate(invalidDto);
      const failedProps = errors.map((e) => e.property);
      expect(failedProps).toContain('key');
      expect(failedProps).toContain('rolloutPercent');
    });
  });
});
