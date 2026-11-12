import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import {
  BadRequestException,
  ExecutionContext,
  HttpStatus,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { EvaluateFeatureFlagDto } from './dto/evaluate-feature-flag.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

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
        Reflector,
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

  describe('guard, role, and HTTP status metadata', () => {
    it('requires JwtAuthGuard + RolesGuard(ADMIN) on all admin CRUD and toggle routes', () => {
      const adminHandlers = [
        controller.create,
        controller.findAll,
        controller.findOne,
        controller.update,
        controller.remove,
        controller.enable,
        controller.disable,
      ];

      for (const handler of adminHandlers) {
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
          JwtAuthGuard,
          RolesGuard,
        ]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
      }
    });

    it('requires only JwtAuthGuard (no role restriction) on evaluate and evaluateAll', () => {
      for (const handler of [controller.evaluate, controller.evaluateAll]) {
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
          JwtAuthGuard,
        ]);
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
      }
    });

    it('enforces ADMIN role on admin handlers while permitting STUDENT on evaluation handlers via RolesGuard', () => {
      const rolesGuard = new RolesGuard(new Reflector());
      const buildContext = (
        handler: (...args: never[]) => unknown,
        role: UserRole,
      ): ExecutionContext =>
        ({
          getHandler: () => handler,
          getClass: () => FeatureFlagsController,
          switchToHttp: () => ({
            getRequest: () => ({ user: { id: 'u-1', role } }),
          }),
        }) as unknown as ExecutionContext;

      expect(rolesGuard.canActivate(buildContext(controller.create, UserRole.STUDENT))).toBe(false);
      expect(rolesGuard.canActivate(buildContext(controller.create, UserRole.ADMIN))).toBe(true);
      expect(rolesGuard.canActivate(buildContext(controller.evaluate, UserRole.STUDENT))).toBe(true);
    });

    it('configures explicit HTTP status codes on create, remove, enable, and disable', () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.create)).toBe(
        HttpStatus.CREATED,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.remove)).toBe(
        HttpStatus.OK,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.enable)).toBe(
        HttpStatus.OK,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, controller.disable)).toBe(
        HttpStatus.OK,
      );
    });
  });

  describe('route delegation', () => {
    it('create delegates to featureFlagsService.create with CreateFeatureFlagDto', async () => {
      const dto: CreateFeatureFlagDto = {
        key: 'new_checkout',
        description: 'Gradual rollout of new checkout flow',
        enabled: true,
        rolloutPercent: 50,
        allowedRoles: ['ADMIN', 'INSTRUCTOR'],
      };
      mockFeatureFlagsService.create.mockResolvedValue({ id: 'ff-1', ...dto });

      const res = await controller.create(dto);

      expect(mockFeatureFlagsService.create).toHaveBeenCalledWith(dto);
      expect(res).toEqual({ id: 'ff-1', ...dto });
    });

    it('findAll delegates to featureFlagsService.findAll', async () => {
      mockFeatureFlagsService.findAll.mockResolvedValue([{ key: 'flag_a' }]);

      const res = await controller.findAll();

      expect(mockFeatureFlagsService.findAll).toHaveBeenCalledTimes(1);
      expect(res).toEqual([{ key: 'flag_a' }]);
    });

    it.each([
      ['findOne', 'findOne'],
      ['remove', 'remove'],
      ['enable', 'enable'],
      ['disable', 'disable'],
    ] as const)('%s delegates to featureFlagsService.%s with key', async (method, serviceMethod) => {
      mockFeatureFlagsService[serviceMethod].mockResolvedValue({ key: 'flag_a' });

      const res = await controller[method]('flag_a');

      expect(mockFeatureFlagsService[serviceMethod]).toHaveBeenCalledWith('flag_a');
      expect(res).toEqual({ key: 'flag_a' });
    });

    it('update delegates to featureFlagsService.update with key and UpdateFeatureFlagDto', async () => {
      const dto: UpdateFeatureFlagDto = {
        description: 'Updated rollout percentage',
        rolloutPercent: 75,
      };
      mockFeatureFlagsService.update.mockResolvedValue({ key: 'flag_a', ...dto });

      const res = await controller.update('flag_a', dto);

      expect(mockFeatureFlagsService.update).toHaveBeenCalledWith('flag_a', dto);
      expect(res).toEqual({ key: 'flag_a', ...dto });
    });

    it('evaluate falls back to CurrentUser id and role when query overrides are omitted', async () => {
      const query: EvaluateFeatureFlagDto = {};
      mockFeatureFlagsService.evaluate.mockResolvedValue({ key: 'flag_a', enabled: true });

      const res = await controller.evaluate('flag_a', 'user-1', 'STUDENT', query);

      expect(mockFeatureFlagsService.evaluate).toHaveBeenCalledWith('flag_a', {
        userId: 'user-1',
        role: 'STUDENT',
      });
      expect(res).toEqual({ key: 'flag_a', enabled: true });
    });

    it('evaluate uses query overrides when provided', async () => {
      const overrideUuid = '550e8400-e29b-41d4-a716-446655440000';
      const query: EvaluateFeatureFlagDto = {
        userId: overrideUuid,
        role: 'INSTRUCTOR',
      };
      mockFeatureFlagsService.evaluate.mockResolvedValue({ key: 'flag_a', enabled: false });

      const res = await controller.evaluate('flag_a', 'user-1', 'STUDENT', query);

      expect(mockFeatureFlagsService.evaluate).toHaveBeenCalledWith('flag_a', {
        userId: overrideUuid,
        role: 'INSTRUCTOR',
      });
      expect(res).toEqual({ key: 'flag_a', enabled: false });
    });

    it('evaluateAll falls back to CurrentUser context and supports query overrides', async () => {
      mockFeatureFlagsService.evaluateAll.mockResolvedValue({ flag_a: true });

      await controller.evaluateAll('user-1', 'STUDENT', {});
      expect(mockFeatureFlagsService.evaluateAll).toHaveBeenCalledWith({
        userId: 'user-1',
        role: 'STUDENT',
      });

      const overrideUuid = '550e8400-e29b-41d4-a716-446655440000';
      const res = await controller.evaluateAll('user-1', 'STUDENT', {
        userId: overrideUuid,
        role: 'ADMIN',
      });

      expect(mockFeatureFlagsService.evaluateAll).toHaveBeenLastCalledWith({
        userId: overrideUuid,
        role: 'ADMIN',
      });
      expect(res).toEqual({ flag_a: true });
    });

    it('propagates NotFoundException when flag key does not exist', async () => {
      mockFeatureFlagsService.findOne.mockRejectedValue(
        new NotFoundException('Feature flag not found'),
      );

      await expect(controller.findOne('missing_flag')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('DTO validation', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    it('accepts valid CreateFeatureFlagDto snake_case keys and rejects invalid keys or rollout bounds', async () => {
      const valid = await pipe.transform(
        { key: 'new_payment_flow', enabled: true, rolloutPercent: 25 },
        { type: 'body', metatype: CreateFeatureFlagDto },
      );
      expect(valid).toBeInstanceOf(CreateFeatureFlagDto);
      expect(valid.key).toBe('new_payment_flow');

      await expect(
        pipe.transform(
          { key: 'Invalid-Key!' },
          { type: 'body', metatype: CreateFeatureFlagDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        pipe.transform(
          { key: 'valid_key', rolloutPercent: 150 },
          { type: 'body', metatype: CreateFeatureFlagDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates EvaluateFeatureFlagDto optional UUID userId', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const valid = await pipe.transform(
        { userId: uuid, role: 'STUDENT' },
        { type: 'query', metatype: EvaluateFeatureFlagDto },
      );
      expect(valid).toMatchObject({ userId: uuid, role: 'STUDENT' });

      await expect(
        pipe.transform(
          { userId: 'not-a-uuid' },
          { type: 'query', metatype: EvaluateFeatureFlagDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
