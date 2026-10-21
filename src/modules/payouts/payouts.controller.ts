import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PayoutsService } from './payouts.service';
import { PayoutQueryDto } from './dto/payout-query.dto';
import { CreatePayoutDto, UpdatePayoutStatusDto } from './dto/create-payout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('payouts')
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('instructor/:instructorId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get instructor payout history' })
  async getInstructorPayoutHistory(
    @CurrentUser() user: { id: string; role: UserRole },
    @Param('instructorId') instructorId: string,
    @Query() query: PayoutQueryDto,
  ) {
    return this.payoutsService.getInstructorPayoutHistory(
      user,
      instructorId,
      query,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('instructor/:instructorId/statement')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export instructor payout statement' })
  async exportPayoutStatement(
    @CurrentUser() user: { id: string; role: UserRole },
    @Param('instructorId') instructorId: string,
    @Query() query: PayoutQueryDto,
  ) {
    return this.payoutsService.exportPayoutStatement(
      user,
      instructorId,
      query,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a payout (admin only)' })
  async createPayout(@Body() dto: CreatePayoutDto) {
    return this.payoutsService.createPayout(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update payout status (admin only)' })
  async updatePayoutStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePayoutStatusDto,
  ) {
    return this.payoutsService.updatePayoutStatus(id, dto);
  }
}
