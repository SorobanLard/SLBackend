import { Controller, Get, Post, Query, UseGuards, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { LeaderboardService } from './leaderboard.service';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { Cacheable } from '../../common/cache/cache.decorator';
import { HttpCacheInterceptor } from '../../common/cache/cache.interceptor';
import { UserRole } from '@prisma/client';

@ApiTags('leaderboard')
@Controller('gamification/leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  @UseInterceptors(HttpCacheInterceptor)
  @Cacheable('leaderboard', 60)
  @ApiOperation({ summary: 'Get top student rankings by points (global or course scope)' })
  getLeaderboard(@Query() query: LeaderboardQueryDto) {
    return this.leaderboardService.getLeaderboard(query);
  }

  @Post('recalculate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger leaderboard rankings recalculation (admin only)' })
  recalculateRankings() {
    return this.leaderboardService.recalculateRankings();
  }
}
