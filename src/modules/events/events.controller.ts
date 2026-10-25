import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EventsQueryDto } from './dto/events-query.dto';
import { EventsService } from './events.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List on-chain events with optional course filter' })
  findAll(@Query() query: EventsQueryDto) {
    return this.eventsService.findAll(query?.courseId, query?.page, query?.limit);
  }
}
