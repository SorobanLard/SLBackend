import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CacheService } from '../../common/cache/cache.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LeaderboardQueryDto, LeaderboardScope } from './dto/leaderboard-query.dto';

export interface LeaderboardEntry {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  points: number;
  currentRank: number;
  previousRank: number | null;
  rankChange: number; // positive = moved up, negative = moved down, 0 = unchanged
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(private readonly prisma: PrismaService, private readonly cache: CacheService) {}

  async getLeaderboard(query: LeaderboardQueryDto) {
    if (query.scope === LeaderboardScope.COURSE && !query.courseId) {
      throw new BadRequestException('courseId is required when scope is course');
    }

    const limit = Math.min(100, Math.max(1, query.limit ?? 10));
    const page = Math.max(1, query.page ?? 1);
    const courseId = query.scope === LeaderboardScope.COURSE ? query.courseId : null;
    const cacheKey = this.cache.buildKey('leaderboard', {
      scope: query.scope, courseId, page, limit,
    });
    const cached = await this.cache.get<{
      data: LeaderboardEntry[]; total: number; page: number; limit: number;
      scope: LeaderboardScope; courseId: string | null;
    }>(cacheKey);
    if (cached) return cached;

    // Reads use the materialized snapshot only; the expensive points aggregation
    // runs in the scheduled recalculation job, not on the request path.
    const where = { scope: query.scope, courseId };
    const [snapshots, total] = await Promise.all([
      this.prisma.leaderboardSnapshot.findMany({
        where,
        orderBy: { rank: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { name: true, avatarUrl: true, stellarAddress: true } } },
      }),
      this.prisma.leaderboardSnapshot.count({ where }),
    ]);

    const result = {
      data: snapshots.map((snapshot) => ({
        userId: snapshot.userId,
        name: snapshot.user.name ?? snapshot.user.stellarAddress ?? 'Learner',
        avatarUrl: snapshot.user.avatarUrl,
        points: snapshot.points,
        currentRank: snapshot.rank,
        previousRank: snapshot.previousRank,
        rankChange: snapshot.previousRank !== null ? snapshot.previousRank - snapshot.rank : 0,
      })),
      total,
      page,
      limit,
      scope: query.scope,
      courseId,
    };
    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handlePeriodicRecalculation() {
    this.logger.log('Starting periodic leaderboard ranking recalculation...');
    await this.recalculateRankings();
    this.logger.log('Periodic leaderboard ranking recalculation completed.');
  }

  async recalculateRankings() {
    const computedAt = new Date();

    // 1. Recalculate Global rankings, preserving the previous rank for movement.
    const globalRankings = await this.calculateStudentPoints(LeaderboardScope.GLOBAL);
    await this.prisma.$transaction(async (tx) => {
      const old = await tx.leaderboardSnapshot.findMany({
        where: { scope: LeaderboardScope.GLOBAL, courseId: null },
        select: { userId: true, rank: true },
      });
      const oldRanks = new Map(old.map((row) => [row.userId, row.rank]));
      await tx.leaderboardSnapshot.deleteMany({
        where: { scope: LeaderboardScope.GLOBAL, courseId: null },
      });
      if (globalRankings.length > 0) {
        await tx.leaderboardSnapshot.createMany({
          data: globalRankings.map((student, index) => ({
            scope: LeaderboardScope.GLOBAL,
            courseId: null,
            userId: student.userId,
            points: student.points,
            rank: index + 1,
            previousRank: oldRanks.get(student.userId) ?? null,
            computedAt,
          })),
        });
      }
    });

    // 2. Recalculate Course-level rankings.
    const activeCourses = await this.prisma.course.findMany({
      select: { id: true },
    });

    for (const course of activeCourses) {
      const courseRankings = await this.calculateStudentPoints(LeaderboardScope.COURSE, course.id);
      await this.prisma.$transaction(async (tx) => {
        const old = await tx.leaderboardSnapshot.findMany({
          where: { scope: LeaderboardScope.COURSE, courseId: course.id },
          select: { userId: true, rank: true },
        });
        const oldRanks = new Map(old.map((row) => [row.userId, row.rank]));
        await tx.leaderboardSnapshot.deleteMany({
          where: { scope: LeaderboardScope.COURSE, courseId: course.id },
        });
        if (courseRankings.length > 0) {
          await tx.leaderboardSnapshot.createMany({
            data: courseRankings.map((student, index) => ({
              scope: LeaderboardScope.COURSE,
              courseId: course.id,
              userId: student.userId,
              points: student.points,
              rank: index + 1,
              previousRank: oldRanks.get(student.userId) ?? null,
              computedAt,
            })),
          });
        }
      });
    }

    await this.cache.invalidateNamespace('leaderboard');
    return { status: 'recalculated', coursesCount: activeCourses.length };
  }

  private async calculateStudentPoints(
    scope: LeaderboardScope,
    courseId?: string,
  ): Promise<{ userId: string; name: string; avatarUrl?: string | null; points: number }[]> {
    const studentWhere: any = { role: 'STUDENT' };
    if (scope === LeaderboardScope.COURSE && courseId) {
      studentWhere.enrollments = { some: { courseId } };
    }

    const students = await this.prisma.user.findMany({
      where: studentWhere,
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        stellarAddress: true,
        enrollments: {
          where: scope === LeaderboardScope.COURSE && courseId ? { courseId } : undefined,
          select: {
            status: true,
            progressPercent: true,
            lessonProgress: { where: { completed: true }, select: { id: true } },
          },
        },
        assignments: {
          where: { status: 'APPROVED' },
          select: { id: true },
        },
        examAttempts: {
          where: { passed: true },
          select: { score: true },
        },
      },
    });

    const studentPoints = students.map((s) => {
      let points = 0;
      // 10 pts per completed lesson
      s.enrollments.forEach((e) => {
        points += e.lessonProgress.length * 10;
        if (e.status === 'COMPLETED' || e.progressPercent === 100) {
          points += 100; // 100 bonus pts for course completion
        }
      });

      // 50 pts per approved assignment
      points += s.assignments.length * 50;

      // Score pts for passed exams
      s.examAttempts.forEach((attempt) => {
        points += attempt.score;
      });

      return {
        userId: s.id,
        name: s.name ?? s.stellarAddress,
        avatarUrl: s.avatarUrl,
        points,
      };
    });

    return studentPoints.sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
  }
}
