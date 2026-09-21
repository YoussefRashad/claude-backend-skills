import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ApiEnvelope } from '../common/api-envelope';

/**
 * The single global exception filter.
 *
 * Standard: .ai/standards/01-engineering-standards.md §4, .ai/standards/02-security-and-compliance.md §2.4.
 *
 * ONE filter, ONE shape. Several filters with divergent shapes is how a client ends
 * up having to tolerate five different error bodies.
 *
 * Two rules this file exists to enforce:
 *   1. The HTTP status line always reflects the outcome. An error is never 200.
 *   2. Nothing upstream leaks to the caller — no provider URL, no echoed request
 *      body, no driver error, no stack. Those go to the log, not the response.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // Typed by the global augmentation in common/correlation-id.middleware.ts — no
    // cast needed, and no second, drifting definition of the same property.
    const correlationId = request.correlationId;

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttp ? this.extractMessage(exception) : 'Internal server error'; // never surface an unexpected error's text

    if (status >= 500) {
      this.logger.error('Unhandled exception', {
        correlationId,
        path: request.url,
        method: request.method,
        statusCode: status,
        errorMessage: describe(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    } else {
      this.logger.warn('Request rejected', {
        correlationId,
        path: request.url,
        method: request.method,
        statusCode: status,
        errorMessage: Array.isArray(message) ? message.join('; ') : message,
      });
    }

    const body: ApiEnvelope<null> = {
      message: Array.isArray(message) ? message.join('; ') : message,
      statusCode: status,
      data: null,
      error: statusText(status),
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private extractMessage(exception: HttpException): string | string[] {
    const res = exception.getResponse();
    if (typeof res === 'string') return res;
    const message = (res as { message?: string | string[] }).message;
    return message ?? exception.message;
  }
}

/** Safe stringification — String(someObject) yields "[object Object]", which tells you nothing. */
function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? 'unknown error';
  } catch {
    return 'unserializable error';
  }
}

/** HTTP status text. A reverse enum lookup on an arbitrary number is an injection sink. */
function statusText(status: number): string {
  const name = Object.entries(HttpStatus).find(([, v]) => Number(v) === status)?.[0];
  return name ? name.replace(/_/g, ' ') : 'Internal Server Error';
}
