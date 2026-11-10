import { Injectable, NotFoundException, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, AuditTargetType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { StartImpersonationDto } from './dto/start-impersonation.dto';
import { v4 as uuidv4 } from 'uuid';

export interface ImpersonationAuditLog {
  sessionId: string;
  adminId: string;
  targetUserId: string;
  targetUserEmail?: string;
  reason?: string;
  durationSeconds: number;
  startedAt: Date;
  expiresAt: Date;
  status: 'ACTIVE' | 'EXPIRED' | 'ENDED';
}

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);
  private readonly auditTrail: ImpersonationAuditLog[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  async startImpersonation(adminId: string, dto: StartImpersonationDto) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN') {
      throw new ForbiddenException('Only admin users can start an impersonation session');
    }

    const targetUser = await this.prisma.user.findUnique({ where: { id: dto.targetUserId } });
    if (!targetUser) {
      throw new NotFoundException(`Target user with ID ${dto.targetUserId} not found`);
    }

    if (targetUser.role === 'ADMIN') {
      throw new ForbiddenException('Admins cannot impersonate another admin user');
    }

    const durationSeconds = dto.durationSeconds ?? 3600;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationSeconds * 1000);
    const sessionId = uuidv4();

    const accessToken = this.jwtService.sign(
      {
        sub: targetUser.id,
        stellarAddress: targetUser.stellarAddress,
        role: targetUser.role,
        isImpersonating: true,
        isImpersonated: true,
        impersonatorId: adminId,
        sessionId,
      },
      { expiresIn: `${durationSeconds}s` },
    );

    const logEntry: ImpersonationAuditLog = {
      sessionId,
      adminId,
      targetUserId: targetUser.id,
      targetUserEmail: targetUser.email ?? undefined,
      reason: dto.reason,
      durationSeconds,
      startedAt: now,
      expiresAt,
      status: 'ACTIVE',
    };

    this.auditTrail.unshift(logEntry);
    await this.auditLogService?.createEntry(adminId, {
      action: AuditAction.IMPERSONATION_STARTED,
      targetType: AuditTargetType.USER,
      targetId: targetUser.id,
      metadata: {
        sessionId,
        reason: dto.reason,
        durationSeconds,
        expiresAt: expiresAt.toISOString(),
      },
    });
    this.logger.log(
      `Admin ${adminId} started impersonating user ${targetUser.id} for ${durationSeconds}s (Session: ${sessionId})`,
    );

    return {
      sessionId,
      accessToken,
      targetUser: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
      },
      durationSeconds,
      startedAt: now,
      expiresAt,
    };
  }

  getAuditTrail(page: number = 1, limit: number = 10) {
    const now = new Date();
    // Update expired statuses
    this.auditTrail.forEach((log) => {
      if (log.status === 'ACTIVE' && now > log.expiresAt) {
        log.status = 'EXPIRED';
      }
    });

    const skip = (page - 1) * limit;
    const items = this.auditTrail.slice(skip, skip + limit);
    return {
      data: items,
      total: this.auditTrail.length,
      page,
      limit,
    };
  }

  verifySession(sessionId: string) {
    const log = this.auditTrail.find((s) => s.sessionId === sessionId);
    if (!log) {
      throw new NotFoundException('Impersonation session not found');
    }

    const now = new Date();
    if (log.status === 'ACTIVE' && now > log.expiresAt) {
      log.status = 'EXPIRED';
    }

    return {
      sessionId: log.sessionId,
      adminId: log.adminId,
      targetUserId: log.targetUserId,
      status: log.status,
      startedAt: log.startedAt,
      expiresAt: log.expiresAt,
      isActive: log.status === 'ACTIVE',
    };
  }

  endSession(sessionId: string, adminId: string) {
    const log = this.auditTrail.find((s) => s.sessionId === sessionId);
    if (!log) {
      throw new NotFoundException('Impersonation session not found');
    }
    if (log.adminId !== adminId) {
      throw new ForbiddenException('Cannot end an impersonation session created by another admin');
    }

    const endedAt = new Date();
    log.status = 'ENDED';
    void this.auditLogService?.createEntry(adminId, {
      action: AuditAction.IMPERSONATION_ENDED,
      targetType: AuditTargetType.USER,
      targetId: log.targetUserId,
      metadata: {
        sessionId,
        endedAt: endedAt.toISOString(),
      },
    });
    this.logger.log(`Impersonation session ${sessionId} ended by admin ${adminId}`);
    return { sessionId, status: 'ENDED', endedAt };
  }
}
