import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsController', () => {
  let controller: RecommendationsController;

  const mockRecommendationsService = {
    getRecommendations: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationsController],
      providers: [
        {
          provide: RecommendationsService,
          useValue: mockRecommendationsService,
        },
      ],
    }).compile();

    controller = module.get<RecommendationsController>(
      RecommendationsController,
    );
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getRecommendations', () => {
    it('defaults limit to 5 when limit query parameter is omitted', async () => {
      const recommendations = [
        { id: 'course-2', title: 'Advanced Soroban', score: 0.92 },
        { id: 'course-3', title: 'Stellar SDK Deep Dive', score: 0.85 },
      ];
      mockRecommendationsService.getRecommendations.mockResolvedValue(
        recommendations,
      );

      const result = await controller.getRecommendations('course-1');

      expect(result).toEqual(recommendations);
      expect(
        mockRecommendationsService.getRecommendations,
      ).toHaveBeenCalledWith('course-1', 5);
    });

    it('coerces a custom limit query parameter to a number', async () => {
      mockRecommendationsService.getRecommendations.mockResolvedValue([]);

      await controller.getRecommendations('course-1', '10' as unknown as number);

      expect(
        mockRecommendationsService.getRecommendations,
      ).toHaveBeenCalledWith('course-1', 10);
    });

    it('falls back to default limit 5 when limit is 0 or empty string', async () => {
      mockRecommendationsService.getRecommendations.mockResolvedValue([]);

      await controller.getRecommendations('course-1', 0);

      expect(
        mockRecommendationsService.getRecommendations,
      ).toHaveBeenCalledWith('course-1', 5);
    });

    it('propagates NotFoundException when target course does not exist', async () => {
      mockRecommendationsService.getRecommendations.mockRejectedValue(
        new NotFoundException('Course invalid-id not found'),
      );

      await expect(
        controller.getRecommendations('invalid-id', 5),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
