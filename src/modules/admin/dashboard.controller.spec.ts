import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';

describe('DashboardController', () => {
  let controller: DashboardController;
  const mockDashboardService = { getSummary: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: mockDashboardService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(DashboardController);
  });

  it('getSummary delegates to DashboardService.getSummary', () => {
    const query = { startDate: '2026-01-01', endDate: '2026-02-01' } as any;
    const summary = { totalUsers: 10 };
    mockDashboardService.getSummary.mockReturnValue(summary);

    expect(controller.getSummary(query)).toBe(summary);
    expect(mockDashboardService.getSummary).toHaveBeenCalledWith(query);
  });

  describe('guard wiring', () => {
    it('applies JwtAuthGuard and RolesGuard at controller level', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, DashboardController);
      expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    });

    it('restricts the controller to ADMIN role', () => {
      expect(Reflect.getMetadata(ROLES_KEY, DashboardController)).toEqual([UserRole.ADMIN]);
    });
  });
});
