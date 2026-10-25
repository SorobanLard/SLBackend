import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';

const PRISMA_ERROR_STATUS: Record<string, HttpStatus> = {
  P2002: HttpStatus.CONFLICT,
  P2025: HttpStatus.NOT_FOUND,
  P2003: HttpStatus.BAD_REQUEST,
};

const PRISMA_ERROR_MESSAGE: Record<string, string> = {
  P2002: 'A record with this value already exists',
  P2025: 'The requested record was not found',
  P2003: 'The request references a related record that does not exist',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      Sentry.captureException(exception, {
        tags: {
          endpoint: `${request.baseUrl ?? ''}${request.route?.path ?? request.path ?? request.url}`,
          method: request.method,
        },
      });
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.path ?? request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private resolve(exception: unknown): { status: number; message: string } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const status = PRISMA_ERROR_STATUS[exception.code];
      if (status) {
        return {
          status,
          message: PRISMA_ERROR_MESSAGE[exception.code],
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : (body as { message?: string | string[] }).message ?? exception.message;
      return { status, message: Array.isArray(message) ? message.join(', ') : message };
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
