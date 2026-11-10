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

  it('getRecommendations delegates to recommendationsService with default limit 5 when limit is omitted', async () => {
    const expected = [{ id: 'course-2', title: 'Advanced Solar' }];
    mockRecommendationsService.getRecommendations.mockResolvedValue(expected);

    const res = await controller.getRecommendations('course-1');

    expect(mockRecommendationsService.getRecommendations).toHaveBeenCalledWith(
      'course-1',
      5,
    );
    expect(res).toEqual(expected);
  });

  it('getRecommendations coerces numeric query limit and forwards it to recommendationsService', async () => {
    const expected = [{ id: 'course-2' }, { id: 'course-3' }];
    mockRecommendationsService.getRecommendations.mockResolvedValue(expected);

    const res = await controller.getRecommendations('course-1', '10' as any);

    expect(mockRecommendationsService.getRecommendations).toHaveBeenCalledWith(
      'course-1',
      10,
    );
    expect(res).toEqual(expected);
  });

  it('propagates NotFoundException when target course does not exist', async () => {
    mockRecommendationsService.getRecommendations.mockRejectedValue(
      new NotFoundException('Course not found'),
    );

    await expect(
      controller.getRecommendations('non-existent-course'),
    ).rejects.toThrow(NotFoundException);
  });
});
