import { plainToInstance } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsEmail,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum LogLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
  Trace = 'trace',
  Silent = 'silent',
}

/**
 * Issue #166 — structured environment variable schema validated at bootstrap.
 *
 * Fields without @IsOptional() are required: a missing or malformed required
 * variable fails fast with a clear error listing every problem.
 */
export class EnvironmentVariables {
  // ----------------------------------------------------------
  // Server
  // ----------------------------------------------------------
  @IsOptional()
  @IsEnum(NodeEnv)
  NODE_ENV?: NodeEnv;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'PORT must be a numeric port' })
  PORT?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  API_PREFIX?: string;

  @IsOptional()
  @IsUrl({}, { message: 'APP_BASE_URL must be a valid URL' })
  APP_BASE_URL?: string;

  @IsOptional()
  @IsUrl({}, { message: 'PUBLIC_API_URL must be a valid URL' })
  PUBLIC_API_URL?: string;

  @IsOptional()
  @IsUrl({}, { message: 'FRONTEND_URL must be a valid URL' })
  FRONTEND_URL?: string;

  @IsOptional()
  @IsEnum(LogLevel)
  LOG_LEVEL?: LogLevel;

  // ----------------------------------------------------------
  // Sentry
  // ----------------------------------------------------------
  @IsOptional()
  @IsUrl({}, { message: 'SENTRY_DSN must be a valid URL' })
  SENTRY_DSN?: string;

  @IsOptional()
  @IsString()
  SENTRY_ENVIRONMENT?: string;

  @IsOptional()
  @IsString()
  SENTRY_RELEASE?: string;

  // ----------------------------------------------------------
  // JWT
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  @MinLength(16, { message: 'JWT_SECRET must be at least 16 characters' })
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN?: string;

  @IsDefined()
  @IsString()
  @MinLength(16, { message: 'JWT_REFRESH_SECRET must be at least 16 characters' })
  JWT_REFRESH_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN?: string;

  // ----------------------------------------------------------
  // Google OAuth
  // ----------------------------------------------------------
  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_SECRET?: string;

  @IsOptional()
  @IsUrl({}, { message: 'GOOGLE_CALLBACK_URL must be a valid URL' })
  GOOGLE_CALLBACK_URL?: string;

  // ----------------------------------------------------------
  // Database
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  @MinLength(1, { message: 'DATABASE_URL is required' })
  DATABASE_URL: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'PRISMA_CONNECTION_LIMIT must be numeric' })
  PRISMA_CONNECTION_LIMIT?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'PRISMA_POOL_TIMEOUT_SECONDS must be numeric' })
  PRISMA_POOL_TIMEOUT_SECONDS?: string;

  // ----------------------------------------------------------
  // Stellar
  // ----------------------------------------------------------
  @IsOptional()
  @IsString()
  STELLAR_NETWORK?: string;

  @IsDefined()
  @IsUrl({}, { message: 'STELLAR_RPC_URL must be a valid URL' })
  STELLAR_RPC_URL: string;

  @IsDefined()
  @IsUrl({}, { message: 'STELLAR_HORIZON_URL must be a valid URL' })
  STELLAR_HORIZON_URL: string;

  @IsOptional()
  @IsString()
  SOROBANLARD_CONTRACT_ID?: string;

  @IsOptional()
  @IsString()
  USDC_TOKEN_ADDRESS?: string;

  @IsDefined()
  @Matches(/^G[1-9A-HJ-NP-Za-km-z]{55}$/, {
    message: 'ADMIN_STELLAR_ADDRESS must be a valid Stellar public key (starts with G, 56 chars)',
  })
  ADMIN_STELLAR_ADDRESS: string;

  @IsDefined()
  @Matches(/^G[1-9A-HJ-NP-Za-km-z]{55}$/, {
    message: 'TREASURY_STELLAR_ADDRESS must be a valid Stellar public key (starts with G, 56 chars)',
  })
  TREASURY_STELLAR_ADDRESS: string;

  // ----------------------------------------------------------
  // File storage / CDN
  // ----------------------------------------------------------
  @IsOptional()
  @IsString()
  UPLOAD_DIR?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'MAX_FILE_SIZE_MB must be numeric' })
  MAX_FILE_SIZE_MB?: string;

  @IsOptional()
  @IsUrl({}, { message: 'CDN_BASE_URL must be a valid URL' })
  CDN_BASE_URL?: string;

  @IsOptional()
  @IsUrl({}, { message: 'CDN_ORIGIN_BASE_URL must be a valid URL' })
  CDN_ORIGIN_BASE_URL?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  CDN_SIGNING_SECRET?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CDN_SIGNED_URL_TTL_SECONDS must be numeric' })
  CDN_SIGNED_URL_TTL_SECONDS?: string;

  // ----------------------------------------------------------
  // Email (Nodemailer)
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  SMTP_HOST: string;

  @IsDefined()
  @Matches(/^\d+$/, { message: 'SMTP_PORT must be numeric' })
  SMTP_PORT: string;

  @IsDefined()
  @IsString()
  SMTP_USER: string;

  @IsDefined()
  @IsString()
  SMTP_PASS: string;

  @IsDefined()
  @IsEmail({}, { message: 'EMAIL_FROM must be a valid email address' })
  EMAIL_FROM: string;

  // ----------------------------------------------------------
  // Redis / Queue
  // ----------------------------------------------------------
  @IsOptional()
  @IsUrl({}, { message: 'REDIS_URL must be a valid URL' })
  REDIS_URL?: string;

  @IsOptional()
  @IsString()
  REDIS_HOST?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'REDIS_PORT must be numeric' })
  REDIS_PORT?: string;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'QUEUE_JOB_ATTEMPTS must be numeric' })
  QUEUE_JOB_ATTEMPTS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'QUEUE_RETRY_DELAY_MS must be numeric' })
  QUEUE_RETRY_DELAY_MS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CACHE_TTL_SECONDS must be numeric' })
  CACHE_TTL_SECONDS?: string;

  // ----------------------------------------------------------
  // Rate limiting
  // ----------------------------------------------------------
  @IsOptional()
  @Matches(/^\d+$/, { message: 'THROTTLE_TTL must be numeric' })
  THROTTLE_TTL?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'THROTTLE_LIMIT must be numeric' })
  THROTTLE_LIMIT?: string;

  // ----------------------------------------------------------
  // CAPTCHA
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  @MinLength(1)
  CAPTCHA_SECRET_KEY: string;

  @IsOptional()
  @IsUrl({}, { message: 'CAPTCHA_VERIFY_URL must be a valid URL' })
  CAPTCHA_VERIFY_URL?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CAPTCHA_TIMEOUT_MS must be numeric' })
  CAPTCHA_TIMEOUT_MS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CAPTCHA_MAX_FAILURES must be numeric' })
  CAPTCHA_MAX_FAILURES?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'CAPTCHA_BLOCK_DURATION_SECONDS must be numeric' })
  CAPTCHA_BLOCK_DURATION_SECONDS?: string;

  // ----------------------------------------------------------
  // Per-IP rate limiting middleware
  // ----------------------------------------------------------
  @IsOptional()
  @Matches(/^\d+$/, { message: 'RATE_LIMIT_WINDOW_MS must be numeric' })
  RATE_LIMIT_WINDOW_MS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'RATE_LIMIT_STANDARD_MAX must be numeric' })
  RATE_LIMIT_STANDARD_MAX?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'RATE_LIMIT_SENSITIVE_MAX must be numeric' })
  RATE_LIMIT_SENSITIVE_MAX?: string;

  @IsOptional()
  @IsString()
  RATE_LIMIT_EXEMPT_IPS?: string;

  // ----------------------------------------------------------
  // Role-based throttling
  // ----------------------------------------------------------
  @IsOptional()
  @Matches(/^\d+$/, { message: 'ROLE_THROTTLE_WINDOW_MS must be numeric' })
  ROLE_THROTTLE_WINDOW_MS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'ROLE_THROTTLE_ANON_LIMIT must be numeric' })
  ROLE_THROTTLE_ANON_LIMIT?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'ROLE_THROTTLE_STUDENT_LIMIT must be numeric' })
  ROLE_THROTTLE_STUDENT_LIMIT?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'ROLE_THROTTLE_INSTRUCTOR_LIMIT must be numeric' })
  ROLE_THROTTLE_INSTRUCTOR_LIMIT?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'ROLE_THROTTLE_ADMIN_LIMIT must be numeric' })
  ROLE_THROTTLE_ADMIN_LIMIT?: string;

  // ----------------------------------------------------------
  // Events / Backups / Misc
  // ----------------------------------------------------------
  @IsOptional()
  @Matches(/^\d+$/, { message: 'EVENT_POLLING_INTERVAL_MS must be numeric' })
  EVENT_POLLING_INTERVAL_MS?: string;

  @IsOptional()
  @IsString()
  BACKUP_ENABLED?: string;

  @IsOptional()
  @IsString()
  BACKUP_S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  BACKUP_S3_PREFIX?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'BACKUP_RETENTION_DAYS must be numeric' })
  BACKUP_RETENTION_DAYS?: string;

  @IsOptional()
  @IsString()
  AWS_REGION?: string;

  @IsOptional()
  @IsUrl({}, { message: 'CORS_ORIGIN must be a valid URL' })
  CORS_ORIGIN?: string;

  @IsOptional()
  @IsString()
  CERTIFICATE_PDF_DIR?: string;

  @IsOptional()
  @IsString()
  PLATFORM_NAME?: string;

  // ----------------------------------------------------------
  // Meilisearch
  // ----------------------------------------------------------
  @IsOptional()
  @IsUrl({}, { message: 'MEILISEARCH_HOST must be a valid URL' })
  MEILISEARCH_HOST?: string;

  @IsOptional()
  @IsString()
  MEILISEARCH_API_KEY?: string;

  // ----------------------------------------------------------
  // Fraud detection
  // ----------------------------------------------------------
  @IsOptional()
  @Matches(/^\d+$/, { message: 'FRAUD_WINDOW_HOURS must be numeric' })
  FRAUD_WINDOW_HOURS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'FRAUD_MAX_ENROLLMENTS_PER_WINDOW must be numeric' })
  FRAUD_MAX_ENROLLMENTS_PER_WINDOW?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'FRAUD_MAX_DAILY_ENROLLMENTS must be numeric' })
  FRAUD_MAX_DAILY_ENROLLMENTS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'FRAUD_MAX_ACTIVE_ENROLLMENTS must be numeric' })
  FRAUD_MAX_ACTIVE_ENROLLMENTS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'FRAUD_HIGH_AMOUNT_THRESHOLD_USDC must be numeric' })
  FRAUD_HIGH_AMOUNT_THRESHOLD_USDC?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'FRAUD_HIGH_RISK_SCORE_THRESHOLD must be numeric' })
  FRAUD_HIGH_RISK_SCORE_THRESHOLD?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'FRAUD_CRITICAL_SCORE_THRESHOLD must be numeric' })
  FRAUD_CRITICAL_SCORE_THRESHOLD?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'REFERRAL_REFERRER_DISCOUNT_PERCENT must be numeric' })
  REFERRAL_REFERRER_DISCOUNT_PERCENT?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'REFERRAL_REFEREE_DISCOUNT_PERCENT must be numeric' })
  REFERRAL_REFEREE_DISCOUNT_PERCENT?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'REFERRAL_REWARD_EXPIRY_DAYS must be numeric' })
  REFERRAL_REWARD_EXPIRY_DAYS?: string;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'REFERRAL_MAX_REWARDS_PER_REFERRER must be numeric' })
  REFERRAL_MAX_REWARDS_PER_REFERRER?: string;

  // ----------------------------------------------------------
  // SMS (Africa's Talking)
  // ----------------------------------------------------------
  @IsOptional()
  @IsString()
  AFRICASTALKING_USERNAME?: string;

  @IsOptional()
  @IsString()
  AFRICASTALKING_API_KEY?: string;

  @IsOptional()
  @IsString()
  AFRICASTALKING_SENDER_ID?: string;

  // ----------------------------------------------------------
  // Webhook signatures
  // ----------------------------------------------------------
  @IsDefined()
  @IsString()
  @MinLength(1)
  WEBHOOK_SECRET: string;

  @IsOptional()
  @IsString()
  WEBHOOK_SECRET_STRIPE?: string;

  @IsOptional()
  @IsString()
  WEBHOOK_SECRET_AFRICASTALKING?: string;

  @IsOptional()
  @IsString()
  WEBHOOK_SECRET_GITHUB?: string;
}

const DEFAULTS: Record<string, string> = {
  NODE_ENV: NodeEnv.Development,
  PORT: '3000',
  API_PREFIX: 'api/v1',
  LOG_LEVEL: LogLevel.Debug,
  STELLAR_NETWORK: 'testnet',
  STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  EMAIL_FROM: 'noreply@sorobanlard.com',
  THROTTLE_TTL: '60',
  THROTTLE_LIMIT: '100',
  CAPTCHA_VERIFY_URL: 'https://www.google.com/recaptcha/api/siteverify',
  CAPTCHA_TIMEOUT_MS: '5000',
  CAPTCHA_MAX_FAILURES: '5',
  CAPTCHA_BLOCK_DURATION_SECONDS: '900',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_STANDARD_MAX: '100',
  RATE_LIMIT_SENSITIVE_MAX: '10',
  ROLE_THROTTLE_WINDOW_MS: '60000',
  ROLE_THROTTLE_ANON_LIMIT: '20',
  ROLE_THROTTLE_STUDENT_LIMIT: '60',
  ROLE_THROTTLE_INSTRUCTOR_LIMIT: '120',
  ROLE_THROTTLE_ADMIN_LIMIT: '300',
  EVENT_POLLING_INTERVAL_MS: '5000',
  BACKUP_ENABLED: 'false',
  BACKUP_RETENTION_DAYS: '30',
  AWS_REGION: 'us-east-1',
  CORS_ORIGIN: 'http://localhost:3001',
  CERTIFICATE_PDF_DIR: './uploads/certificates',
  PLATFORM_NAME: 'SorobanLard',
  FRAUD_WINDOW_HOURS: '1',
  FRAUD_MAX_ENROLLMENTS_PER_WINDOW: '3',
  FRAUD_MAX_DAILY_ENROLLMENTS: '10',
  FRAUD_MAX_ACTIVE_ENROLLMENTS: '20',
  FRAUD_HIGH_AMOUNT_THRESHOLD_USDC: '500',
  FRAUD_HIGH_RISK_SCORE_THRESHOLD: '70',
  FRAUD_CRITICAL_SCORE_THRESHOLD: '90',
  REFERRAL_REFERRER_DISCOUNT_PERCENT: '10',
  REFERRAL_REFEREE_DISCOUNT_PERCENT: '10',
  REFERRAL_REWARD_EXPIRY_DAYS: '90',
  REFERRAL_MAX_REWARDS_PER_REFERRER: '50',
  AFRICASTALKING_USERNAME: 'sandbox',
  AFRICASTALKING_SENDER_ID: 'SorobanLard',
};

/**
 * Validates the raw process.env against the schema, applies defaults for
 * optional variables, and throws a clear error listing every missing or
 * malformed required variable so boot fails fast instead of at runtime.
 */
export function validateEnv(config: Record<string, string>): Record<string, string> {
  const instance = plainToInstance(EnvironmentVariables, config);

  const errors = validateSync(instance, {
    skipMissingProperties: false,
    whitelist: true,
    forbidNonWhitelisted: false,
  });

  if (errors.length > 0) {
    const messages = errors.flatMap((error) => {
      const constraints = error.constraints ? Object.values(error.constraints) : [];
      return `  - ${error.property}: ${constraints.join('; ')}`;
    });
    throw new Error(
      `[EnvValidation] Missing or invalid environment variables:\n${messages.join('\n')}`,
    );
  }

  const merged: Record<string, string> = { ...DEFAULTS, ...config };
  for (const key of Object.keys(instance)) {
    const value = (instance as unknown as Record<string, string>)[key];
    if (value !== undefined && value !== null) {
      merged[key] = String(value);
    }
  }
  return merged;
}
