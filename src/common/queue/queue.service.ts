import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, JobsOptions, Queue } from 'bullmq';
import { plainToInstance } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, validateSync } from 'class-validator';
import { NotificationType } from '@prisma/client';
import { NOTIFICATION_EMAIL_JOB, NOTIFICATION_EMAIL_QUEUE } from './queue.constants';

export class NotificationEmailJobData {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  notificationId: string;

  @IsEmail()
  to: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  subject: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  text: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  correlationId?: string;
}

export interface QueueJobStatus {
  id: string;
  queue: string;
  status: string;
  progress: number | object;
  attemptsMade: number;
  result: unknown;
  failedReason?: string;
}

export interface QueueMetrics {
  queue: string;
  active: number;
  waiting: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
  total: number;
  failureRate: number;
}

export interface QueueMetricsReport {
  generatedAt: string;
  queues: QueueMetrics[];
}

export interface DeadLetterJob {
  id: string;
  queue: string;
  name: string;
  attemptsMade: number;
  failedReason?: string;
  failedAt?: string;
  data: unknown;
}

/**
 * Explicit retry policy applied to every job added to the notification email
 * queue. Jobs are retried with exponential backoff and, once all attempts are
 * exhausted, remain in the queue's `failed` set as the dead-letter store.
 */
export const NOTIFICATION_EMAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 5_000,
  },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: false,
};

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE)
    private readonly notificationEmailQueue: Queue<NotificationEmailJobData>,
  ) {}

  async enqueueNotificationEmail(payload: unknown, correlationId?: string) {
    const data = plainToInstance(NotificationEmailJobData, payload);
    const errors = validateSync(data, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length) {
      throw new BadRequestException('Invalid notification email job payload');
    }

    if (correlationId && !data.correlationId) {
      data.correlationId = correlationId;
    }

    const job = await this.notificationEmailQueue.add(
      NOTIFICATION_EMAIL_JOB,
      data,
      NOTIFICATION_EMAIL_JOB_OPTIONS,
    );
    return { id: job.id as string, status: await job.getState() };
  }

  async getJobStatus(jobId: string, userId: string): Promise<QueueJobStatus> {
    const job = await this.notificationEmailQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.data.userId !== userId) {
      throw new NotFoundException('Job not found');
    }

    return {
      id: job.id as string,
      queue: NOTIFICATION_EMAIL_QUEUE,
      status: await job.getState(),
      progress: job.progress as any,
      attemptsMade: job.attemptsMade,
      result: job.returnvalue,
      failedReason: job.failedReason,
    };
  }

  async getQueueMetrics(): Promise<QueueMetricsReport> {
    const queues = [this.notificationEmailQueue];
    const metrics = await Promise.all(
      queues.map((queue) => this.collectQueueMetrics(queue)),
    );

    return {
      generatedAt: new Date().toISOString(),
      queues: metrics,
    };
  }

  async listDeadLetterJobs(limit = 50): Promise<DeadLetterJob[]> {
    const jobs = await this.notificationEmailQueue.getFailed(0, limit - 1);
    return jobs.map((job) => this.toDeadLetterJob(job));
  }

  async requeueDeadLetterJob(jobId: string): Promise<QueueJobStatus> {
    const job = await this.notificationEmailQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const state = await job.getState();
    if (state !== 'failed') {
      throw new BadRequestException('Only failed jobs can be requeued');
    }

    await job.retry('failed');

    return {
      id: job.id as string,
      queue: NOTIFICATION_EMAIL_QUEUE,
      status: await job.getState(),
      progress: job.progress as any,
      attemptsMade: job.attemptsMade,
      result: job.returnvalue,
      failedReason: job.failedReason,
    };
  }

  private toDeadLetterJob(job: Job<NotificationEmailJobData>): DeadLetterJob {
    return {
      id: job.id as string,
      queue: NOTIFICATION_EMAIL_QUEUE,
      name: job.name,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined,
      data: job.data,
    };
  }

  private async collectQueueMetrics(queue: Queue): Promise<QueueMetrics> {
    const counts = await queue.getJobCounts(
      'active',
      'waiting',
      'delayed',
      'completed',
      'failed',
      'paused',
    );

    const active = counts.active ?? 0;
    const waiting = counts.waiting ?? 0;
    const delayed = counts.delayed ?? 0;
    const completed = counts.completed ?? 0;
    const failed = counts.failed ?? 0;
    const paused = counts.paused ?? 0;
    const total = active + waiting + delayed + completed + failed + paused;

    return {
      queue: queue.name,
      active,
      waiting,
      delayed,
      completed,
      failed,
      paused,
      total,
      failureRate: total > 0 ? failed / total : 0,
    };
  }
}
