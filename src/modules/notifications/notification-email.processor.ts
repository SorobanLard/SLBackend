import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailService } from '../mail/mail.service';
import { NOTIFICATION_EMAIL_QUEUE } from '../../common/queue/queue.constants';

export interface NotificationEmailJobData {
  to: string;
  subject: string;
  template: string;
  context?: Record<string, unknown>;
}

/**
 * Explicit retry policy for notification emails.
 *
 * SMTP timeouts and transient provider errors are common, so we retry a few
 * times with exponential backoff. Jobs that exhaust all attempts are retained
 * (removeOnFail: false) so they can be inspected and requeued via the
 * dead-letter admin endpoints on the queue controller.
 */
export const NOTIFICATION_EMAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: 'exponential' as const,
    delay: 5_000,
  },
  removeOnComplete: 100,
  removeOnFail: false,
};

@Processor(NOTIFICATION_EMAIL_QUEUE, {
  concurrency: 5,
})
export class NotificationEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationEmailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<NotificationEmailJobData>): Promise<void> {
    const { to, subject, template, context } = job.data;

    this.logger.debug(
      `Processing notification email job ${job.id} (attempt ${job.attemptsMade + 1})`,
    );

    await this.mailService.sendTemplateEmail({
      to,
      subject,
      template,
      context,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationEmailJobData>, error: Error): void {
    const maxAttempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= maxAttempts;

    if (exhausted) {
      this.logger.error(
        `Notification email job ${job.id} permanently failed after ${job.attemptsMade} attempts: ${error.message}`,
        error.stack,
      );
    } else {
      this.logger.warn(
        `Notification email job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}), will retry: ${error.message}`,
      );
    }
  }
}
