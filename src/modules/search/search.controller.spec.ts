import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

describe('SearchController', () => {
  let controller: SearchController;
  const mockSearchService = {
    search: jest.fn(),
    getIndexFreshness: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [{ provide: SearchService, useValue: mockSearchService }],
    }).compile();

    controller = moduleRef.get(SearchController);
  });

  describe('search (GET)', () => {
    it('delegates to SearchService.search with provided params', () => {
      const result = { hits: [] };
      mockSearchService.search.mockReturnValue(result);

      expect(controller.search('rust', 'dev', 'Beginner', 'en', 2, 5)).toBe(result);
      expect(mockSearchService.search).toHaveBeenCalledWith({
        query: 'rust',
        category: 'dev',
        level: 'Beginner',
        language: 'en',
        page: 2,
        limit: 5,
      });
    });

    it('defaults page to 1 and limit to 20', () => {
      controller.search('rust');
      expect(mockSearchService.search).toHaveBeenCalledWith({
        query: 'rust',
        category: undefined,
        level: undefined,
        language: undefined,
        page: 1,
        limit: 20,
      });
    });
  });

  describe('searchPost', () => {
    it('maps the DTO to SearchService.search', () => {
      const dto = { query: 'soroban', category: 'web3', level: 'Advanced', language: 'en', page: 3, limit: 10 } as any;
      controller.searchPost(dto);
      expect(mockSearchService.search).toHaveBeenCalledWith(dto);
    });
  });

  describe('getFreshness', () => {
    it('returns isFresh true when the course is indexed', async () => {
      mockSearchService.getIndexFreshness.mockResolvedValue(1700000000000);
      await expect(controller.getFreshness('c1')).resolves.toEqual({
        courseId: 'c1',
        lastIndexedAt: 1700000000000,
        isFresh: true,
      });
      expect(mockSearchService.getIndexFreshness).toHaveBeenCalledWith('c1');
    });

    it('returns isFresh false when the course is not indexed', async () => {
      mockSearchService.getIndexFreshness.mockResolvedValue(0);
      await expect(controller.getFreshness('c2')).resolves.toEqual({
        courseId: 'c2',
        lastIndexedAt: 0,
        isFresh: false,
      });
    });
  });

  describe('guard wiring', () => {
    it('exposes search routes publicly (no guards)', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, SearchController)).toBeUndefined();
      for (const method of ['search', 'searchPost', 'getFreshness'] as const) {
        expect(Reflect.getMetadata(GUARDS_METADATA, SearchController.prototype[method])).toBeUndefined();
      }
    });
  });
});
