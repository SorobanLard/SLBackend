import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FeatureFlagsService } from './feature-flags.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Deterministic rollout buckets (FNV-1a in [0, 100)), one precomputed
 * pair per assertion so the 32-bit hash math is pinned by the tests:
 *   user-abc-123 + new_dashboard -> 4
 *   user-abc-123 + new_ui        -> 40
 *   anonymous     + new_ui       -> 11
 */

describe('FeatureFlagsService (Issue #242 — unit tests)', () => {
  let service: FeatureFlagsService;

  const baseFlag = {
    key: 'new_dashboard',
    description: null,
    enabled: true,
    rolloutPercent: 100,
    allowedRoles: [],
    allowedUserIds: [],
    metadata: null,
  };

  const flag = (overrides: Partial<typeof baseFlag> = {}) => ({
    ...baseFlag,
    ...overrides,
  });

  const mockPrisma = {
    featureFlag: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(FeatureFlagsService);
    jest.clearAllMocks();
    mockPrisma.featureFlag.findMany.mockResolvedValue([]);
  });

  // ------------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------------

  describe('create', () => {
    it('throws ConflictException when a flag with the key already exists', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag());

      await expect(service.create({ key: 'new_dashboard' })).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.featureFlag.create).not.toHaveBeenCalled();
    });

    it('creates a flag with the dtos explicit values', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      const created = { key: 'beta_search', enabled: true };
      mockPrisma.featureFlag.create.mockResolvedValue(created);

      const dto = {
        key: 'beta_search',
        description: 'search revamp',
        enabled: true,
        rolloutPercent: 25,
        allowedRoles: ['INSTRUCTOR'],
        allowedUserIds: ['user-1'],
        metadata: { team: 'search' },
      };

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(mockPrisma.featureFlag.create).toHaveBeenCalledWith({
        data: {
          key: 'beta_search',
          description: 'search revamp',
          enabled: true,
          rolloutPercent: 25,
          allowedRoles: ['INSTRUCTOR'],
          allowedUserIds: ['user-1'],
          metadata: { team: 'search' },
        },
      });
    });

    it('applies defaults for omitted fields', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);
      mockPrisma.featureFlag.create.mockResolvedValue({ key: 'sample_flag' });

      await service.create({ key: 'sample_flag' });

      expect(mockPrisma.featureFlag.create).toHaveBeenCalledWith({
        data: {
          key: 'sample_flag',
          description: null,
          enabled: false,
          rolloutPercent: 100,
          allowedRoles: [],
          allowedUserIds: [],
          metadata: Prisma.JsonNull,
        },
      });
    });
  });

  describe('findAll', () => {
    it('lists flags ordered by key ascending', async () => {
      const rows = [flag(), flag({ key: 'zz_last' })];
      mockPrisma.featureFlag.findMany.mockResolvedValue(rows);

      const result = await service.findAll();

      expect(result).toEqual(rows);
      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledWith({
        orderBy: { key: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the flag for an existing key', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag());

      const result = await service.findOne('new_dashboard');

      expect(result).toEqual(flag());
      expect(mockPrisma.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: 'new_dashboard' },
      });
    });

    it('throws NotFoundException for an unknown key', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing_flag')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the flag does not exist', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing_flag', { enabled: true }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.featureFlag.update).not.toHaveBeenCalled();
    });

    it('updates only the provided fields', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag());
      mockPrisma.featureFlag.update.mockResolvedValue(flag({ enabled: false }));

      const result = await service.update('new_dashboard', { enabled: false });

      expect(result).toEqual(flag({ enabled: false }));
      expect(mockPrisma.featureFlag.update).toHaveBeenCalledWith({
        where: { key: 'new_dashboard' },
        data: { enabled: false },
      });
    });
  });

  describe('enable / disable shortcuts', () => {
    it.each([
      ['enable', true],
      ['disable', false],
    ])('%s toggles the enabled field to %p', async (method, enabled) => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag({ enabled }));
      mockPrisma.featureFlag.update.mockResolvedValue(flag({ enabled }));

      await service[method]('new_dashboard');

      expect(mockPrisma.featureFlag.update).toHaveBeenCalledWith({
        where: { key: 'new_dashboard' },
        data: { enabled },
      });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the flag does not exist', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing_flag')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.featureFlag.delete).not.toHaveBeenCalled();
    });

    it('deletes the flag and returns a confirmation message', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag());
      mockPrisma.featureFlag.delete.mockResolvedValue(flag());

      const result = await service.remove('new_dashboard');

      expect(result).toEqual({ message: 'Feature flag "new_dashboard" deleted' });
      expect(mockPrisma.featureFlag.delete).toHaveBeenCalledWith({
        where: { key: 'new_dashboard' },
      });
    });
  });

  // ------------------------------------------------------------------
  // Evaluation
  // ------------------------------------------------------------------

  describe('evaluate', () => {
    it('reports flag_disabled for a disabled flag', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag({ enabled: false }));

      const result = await service.evaluate('new_dashboard', {
        userId: 'user-abc-123',
        role: 'STUDENT',
      });

      expect(result).toEqual({
        key: 'new_dashboard',
        enabled: false,
        reason: 'flag_disabled',
      });
    });

    it('reports the reason when the role is not allowed', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ allowedRoles: ['INSTRUCTOR', 'ADMIN'] }),
      );

      const result = await service.evaluate('new_dashboard', {
        userId: 'user-abc-123',
        role: 'STUDENT',
      });

      expect(result).toEqual({
        key: 'new_dashboard',
        enabled: false,
        reason: 'role_not_allowed (role=STUDENT)',
      });
    });

    it('reports no role when the context has no role', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ allowedRoles: ['INSTRUCTOR'] }),
      );

      const result = await service.evaluate('new_dashboard', {});

      expect(result.reason).toBe('role_not_allowed (role=none)');
    });

    it('passes a user on the allowed roles', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ allowedRoles: ['INSTRUCTOR'] }),
      );

      const result = await service.evaluate('new_dashboard', {
        userId: 'user-abc-123',
        role: 'INSTRUCTOR',
      });

      expect(result.enabled).toBe(true);
    });

    it('allows users on the explicit allow-list even when rollout is 0%', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ rolloutPercent: 0, allowedUserIds: ['user-abc-123'] }),
      );

      const result = await service.evaluate('new_dashboard', {
        userId: 'user-abc-123',
        role: 'STUDENT',
      });

      expect(result).toEqual({
        key: 'new_dashboard',
        enabled: true,
        reason: 'explicit_allow_list',
      });
    });

    it('reports full_rollout at 100%', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ rolloutPercent: 100, allowedUserIds: [] }),
      );

      const result = await service.evaluate('new_dashboard', {
        userId: 'user-abc-123',
      });

      expect(result).toEqual({
        key: 'new_dashboard',
        enabled: true,
        reason: 'full_rollout',
      });
    });

    it('reports zero_rollout when rollout is 0% and user is not allow-listed', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag({ rolloutPercent: 0 }));

      const result = await service.evaluate('new_dashboard', {
        userId: 'user-abc-123',
      });

      expect(result).toEqual({
        key: 'new_dashboard',
        enabled: false,
        reason: 'zero_rollout',
      });
    });

    it('enables a user whose deterministic bucket is below the rollout percent', async () => {
      // Bucket for user-abc-123 + new_dashboard is 4 (FNV-1a % 100).
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ rolloutPercent: 25, allowedUserIds: [] }),
      );

      const result = await service.evaluate('new_dashboard', {
        userId: 'user-abc-123',
      });

      expect(result).toEqual({
        key: 'new_dashboard',
        enabled: true,
        reason: 'in_rollout_bucket (4/25)',
      });
    });

    it('excludes a user whose deterministic bucket is above the rollout percent', async () => {
      // Bucket for user-abc-123 + new_ui is 40 (FNV-1a % 100).
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ key: 'new_ui', rolloutPercent: 25, allowedUserIds: [] }),
      );

      const result = await service.evaluate('new_ui', {
        userId: 'user-abc-123',
      });

      expect(result).toEqual({
        key: 'new_ui',
        enabled: false,
        reason: 'outside_rollout_bucket (40/25)',
      });
    });

    it('keeps the anonymous bucket stable so no-user contexts are deterministic', async () => {
      // Bucket for anonymous + new_ui is 11 (FNV-1a % 100).
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ key: 'new_ui', rolloutPercent: 10, allowedUserIds: [] }),
      );

      const result = await service.evaluate('new_ui', {});

      expect(result).toEqual({
        key: 'new_ui',
        enabled: false,
        reason: 'outside_rollout_bucket (11/10)',
      });
    });

    it('produces the same bucket for the same user on repeated evaluations', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(
        flag({ rolloutPercent: 99, allowedUserIds: [] }),
      );

      const first = await service.evaluate('new_ui', { userId: 'bucket-user' });
      const second = await service.evaluate('new_ui', { userId: 'bucket-user' });

      expect(second).toEqual(first);
      expect(first.reason).toMatch(/_rollout_bucket \(\d+\/99\)$/);
    });
  });

  describe('evaluateAll', () => {
    it('evaluates every flag into a key to boolean map', async () => {
      mockPrisma.featureFlag.findMany.mockResolvedValue([
        flag({ key: 'a_full_rollout' }),
        flag({ key: 'disabled_flag', enabled: false }),
        flag({ key: 'b_zero_rollout', rolloutPercent: 0, allowedUserIds: [] }),
      ]);

      const result = await service.evaluateAll({ userId: 'user-abc-123' });

      expect(result).toEqual({
        a_full_rollout: true,
        disabled_flag: false,
        b_zero_rollout: false,
      });
      expect(mockPrisma.featureFlag.findMany).toHaveBeenCalledWith({
        orderBy: { key: 'asc' },
      });
    });
  });

  describe('isEnabled', () => {
    it('returns false for a missing flag instead of throwing', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(null);

      await expect(service.isEnabled('missing_flag', { userId: 'u' })).resolves.toBe(false);
    });

    it('returns the evaluated enabled state', async () => {
      mockPrisma.featureFlag.findUnique.mockResolvedValue(flag({ enabled: false }));

      await expect(service.isEnabled('new_dashboard', {})).resolves.toBe(false);
    });
  });
});
