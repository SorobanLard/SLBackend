export const NOTIFICATION_EMAIL_QUEUE = 'notification-email';
export const NOTIFICATION_EMAIL_JOB = 'send-notification-email';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const VIDEO_PROCESSING_JOB = 'process-video';

/**
 * Explicit retry policy for BullMQ jobs. Applied on every queue/processor so
 * failed jobs (e.g. SMTP timeouts) retry with exponential backoff instead of
 * relying on BullMQ defaults, then land in the failed set for dead-letter
 * visibility and manual requeue.
 */
export const DEFAULT_JOB_ATTEMPTS = 5;
export const DEFAULT_JOB_BACKOFF = {
  type: 'exponential' as const,
  delay: 5_000,
};

export const NOTIFICATION_EMAIL_JOB_OPTIONS = {
  attempts: DEFAULT_JOB_ATTEMPTS,
  backoff: DEFAULT_JOB_BACKOFF,
  removeOnComplete: 1_000,
  removeOnFail: false,
};

export const VIDEO_PROCESSING_JOB_OPTIONS = {
  attempts: DEFAULT_JOB_ATTEMPTS,
  backoff: DEFAULT_JOB_BACKOFF,
  removeOnComplete: 1_000,
  removeOnFail: false,
};
