import {
  Controller, Get, Post, Body, Param, UseGuards, HttpCode, HttpStatus, Query,
  ConflictException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EnrollmentsService } from './enrollments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@ApiTags('enrollments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  /**
   * POST /api/v1/enrollments
   * Called by the frontend after the student's enroll() tx is confirmed on-chain.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register on-chain enrollment in the DB' })
  async create(
    @CurrentUser('id') studentId: string,
    @Body() body: { courseId: string; txHash: string; amountPaid: number },
  ) {
    try {
      return await this.enrollmentsService.create(
        studentId, body.courseId, body.txHash, body.amountPaid,
      );
    } catch (error) {
      // Concurrent duplicate enrollment attempts race past the pre-check and
      // hit the @@unique([userId, courseId]) constraint (Prisma P2002).
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'You are already enrolled in this course',
        );
      }
      throw error;
    }
  }

  @Get('my')
  @ApiOperation({ summary: 'Get all courses the authenticated student is enrolled in' })
  findMy(
    @CurrentUser('id') studentId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.enrollmentsService.findByStudent(studentId, query?.page, query?.limit);
  }

  @Get('course/:courseId')
  @ApiOperation({ summary: 'Get all enrollments for a course with related student and payment data' })
  findByCourse(
    @Param('courseId') courseId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.enrollmentsService.findByCourse(courseId, query?.page, query?.limit);
  }

  @Get(':courseId')
  @ApiOperation({ summary: 'Get enrollment detail including progress for a specific course' })
  findOne(
    @CurrentUser('id') studentId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.enrollmentsService.findOne(studentId, courseId);
  }

  @Get(':courseId/check')
  @ApiOperation({ summary: 'Check if the authenticated user is enrolled in a course' })
  isEnrolled(
    @CurrentUser('id') studentId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.enrollmentsService.isEnrolled(studentId, courseId);
  }

  /**
   * GET /api/v1/enrollments/:courseId/check-prerequisites
   * Structured per-prerequisite feedback — satisfied vs missing.
   */
  @Get(':courseId/check-prerequisites')
  @ApiOperation({
    summary: 'Check whether prerequisites for a course are met by the current user',
    description:
      'Returns eligible=true/false plus the missing prerequisite courses, so the ' +
      'frontend can explain an enrollment rejection before submitting a tx.',
  })
  checkPrerequisites(
    @CurrentUser('id') studentId: string,
    @Param('courseId') courseId: string,
  ) {
    return this.enrollmentsService.checkPrerequisites(studentId, courseId);
  }
}
