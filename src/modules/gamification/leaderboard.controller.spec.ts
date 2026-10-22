import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { LeaderboardController } from './leaderboard.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('LeaderboardController', () => {
  let controller: LeaderboardController;

  const service = {
    getLeaderboard: jest.fn(),
    recalculateRankings: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new LeaderboardController(service as any);
  });

  it('getLeaderboard delegates the query to the service', () => {
    const query = { page: 1, limit: 10 } as any;
    service.getLeaderboard.mockReturnValue(['row']);
    expect(controller.getLeaderboard(query)).toEqual(['row']);
    expect(service.getLeaderboard).toHaveBeenCalledWith(query);
  });

  it('recalculateRankings delegates to the service', () => {
    service.recalculateRankings.mockReturnValue({ updated: 3 });
    expect(controller.recalculateRankings()).toEqual({ updated: 3 });
    expect(service.recalculateRankings).toHaveBeenCalled();
  });

  describe('guard and role metadata', () => {
    it('getLeaderboard is public', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, LeaderboardController.prototype.getLeaderboard),
      ).toBeUndefined();
    });

    it('recalculateRankings requires JwtAuthGuard + RolesGuard with ADMIN role', () => {
      const handler = LeaderboardController.prototype.recalculateRankings;
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    });
  });
});
