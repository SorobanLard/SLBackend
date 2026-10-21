import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LiveSessionsService } from './live-sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('live-sessions')
@Controller('live-sessions')
export class LiveSessionsController {
  constructor(private readonly liveSessionsService: LiveSessionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Schedule a live session' })
  async scheduleSession(@Req() req: any, @Body() dto: CreateSessionDto) {
    return this.liveSessionsService.scheduleSession(req.user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a live session' })
  async updateSession(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.liveSessionsService.updateSession(req.user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a live session' })
  async cancelSession(@Req() req: any, @Param('id') id: string) {
    return this.liveSessionsService.cancelSession(req.user, id);
  }

  @ApiOperation({ summary: 'List upcoming live sessions' })
  @Get('upcoming')
  async getUpcomingSessions(
    @Query('courseId') courseId?: string,
    @Query('instructorAddress') instructorAddress?: string,
  ) {
    return this.liveSessionsService.getUpcomingSessions(courseId, instructorAddress);
  }

  @ApiOperation({ summary: 'Get a live session by id' })
  @Get(':id')
  async getSessionById(@Param('id') id: string) {
    return this.liveSessionsService.getSessionById(id);
  }
}
