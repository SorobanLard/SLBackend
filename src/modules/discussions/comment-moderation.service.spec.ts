import { Test, TestingModule } from '@nestjs/testing';
import { CommentReviewStatus } from '@prisma/client';
import { CommentModerationService } from './comment-moderation.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('CommentModerationService', () => {
  let service: CommentModerationService;
  let prisma: {
    discussionComment: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      discussionComment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentModerationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CommentModerationService>(CommentModerationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createComment', () => {
    it('creates an approved, visible comment for clean content', async () => {
      const created = { id: 'c1' };
      prisma.discussionComment.create.mockResolvedValue(created);

      const result = await service.createComment('author-1', {
        discussionId: 'd1',
        content: 'This is a helpful and friendly comment.',
      } as any);

      expect(result).toBe(created);
      expect(prisma.discussionComment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          discussionId: 'd1',
          authorId: 'author-1',
          hidden: false,
          flaggedCount: 0,
          reviewStatus: CommentReviewStatus.APPROVED,
          moderationNotes: null,
        }),
      });
    });

    it('flags, hides and marks pending when banned terms are present', async () => {
      prisma.discussionComment.create.mockResolvedValue({ id: 'c2' });

      await service.createComment('author-2', {
        discussionId: 'd2',
        content: 'Buy now, this is a scam!',
      } as any);

      const call = prisma.discussionComment.create.mock.calls[0][0];
      expect(call.data.hidden).toBe(true);
      expect(call.data.flaggedCount).toBe(1);
      expect(call.data.reviewStatus).toBe(CommentReviewStatus.PENDING);
      expect(call.data.moderationNotes).toContain('Auto-flagged:');
      expect(call.data.moderationNotes).toContain('scam');
      expect(call.data.moderationNotes).toContain('buy now');
    });

    it('flags profanity even without banned terms', async () => {
      prisma.discussionComment.create.mockResolvedValue({ id: 'c3' });

      await service.createComment('author-3', {
        discussionId: 'd3',
        content: 'This is shit.',
      } as any);

      const call = prisma.discussionComment.create.mock.calls[0][0];
      expect(call.data.hidden).toBe(true);
      expect(call.data.reviewStatus).toBe(CommentReviewStatus.PENDING);
      expect(call.data.moderationNotes).toContain('profanity');
    });
  });

  describe('findCommentsForDiscussion', () => {
    it('queries only visible comments ordered by createdAt desc', async () => {
      prisma.discussionComment.findMany.mockResolvedValue([]);

      await service.findCommentsForDiscussion('d1');

      expect(prisma.discussionComment.findMany).toHaveBeenCalledWith({
        where: { discussionId: 'd1', hidden: false },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findCommentById', () => {
    it('returns the comment by id', async () => {
      const comment = { id: 'c1' };
      prisma.discussionComment.findUnique.mockResolvedValue(comment);

      const result = await service.findCommentById('c1');

      expect(result).toBe(comment);
      expect(prisma.discussionComment.findUnique).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
    });
  });

  describe('findFlaggedComments', () => {
    it('queries comments with flaggedCount greater than zero', async () => {
      prisma.discussionComment.findMany.mockResolvedValue([]);

      await service.findFlaggedComments();

      expect(prisma.discussionComment.findMany).toHaveBeenCalledWith({
        where: { flaggedCount: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getModerationSummary', () => {
    it('returns flagged and pending counts', async () => {
      prisma.discussionComment.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(5);

      const result = await service.getModerationSummary();

      expect(result).toEqual({ flaggedCount: 3, pendingCount: 5 });
      expect(prisma.discussionComment.count).toHaveBeenNthCalledWith(1, {
        where: { flaggedCount: { gt: 0 } },
      });
      expect(prisma.discussionComment.count).toHaveBeenNthCalledWith(2, {
        where: { reviewStatus: CommentReviewStatus.PENDING },
      });
    });
  });

  describe('moderateComment', () => {
    it('hides the comment when rejected', async () => {
      prisma.discussionComment.update.mockResolvedValue({ id: 'c1' });

      await service.moderateComment('c1', {
        reviewStatus: CommentReviewStatus.REJECTED,
      } as any);

      expect(prisma.discussionComment.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: {
          reviewStatus: CommentReviewStatus.REJECTED,
          hidden: true,
          moderationNotes: null,
        },
      });
    });

    it('respects explicit hidden flag and notes when approved', async () => {
      prisma.discussionComment.update.mockResolvedValue({ id: 'c1' });

      await service.moderateComment('c1', {
        reviewStatus: CommentReviewStatus.APPROVED,
        hidden: false,
        moderationNotes: 'Looks fine',
      } as any);

      expect(prisma.discussionComment.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: {
          reviewStatus: CommentReviewStatus.APPROVED,
          hidden: false,
          moderationNotes: 'Looks fine',
        },
      });
    });

    it('propagates errors from the database layer', async () => {
      prisma.discussionComment.update.mockRejectedValue(new Error('db down'));

      await expect(
        service.moderateComment('c1', {
          reviewStatus: CommentReviewStatus.APPROVED,
        } as any),
      ).rejects.toThrow('db down');
    });
  });
});
