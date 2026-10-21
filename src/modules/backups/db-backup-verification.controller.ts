import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { DbBackupVerificationService } from './db-backup-verification.service';

@ApiTags('backups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('backups/database')
export class DbBackupVerificationController {
  constructor(
    private readonly verificationService: DbBackupVerificationService,
  ) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Restore the latest database backup into the scratch database and run an integrity check',
  })
  verify() {
    return this.verificationService.runVerification();
  }

  @Get('verify/status')
  @ApiOperation({
    summary: 'Get the most recent database backup verification result',
  })
  status() {
    return this.verificationService.getLastRunStatus();
  }
}
