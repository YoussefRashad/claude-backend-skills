import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import type { ApiEnvelope } from '../common/api-envelope';

/**
 * Wraps every successful response in the envelope (§4).
 *
 * Opt out for a route that must return a raw body — a file download, a webhook
 * acknowledgement a provider expects in a fixed shape — with `@RawResponse()`.
 * That is an exception, not a second convention: it is for bodies that are not
 * ours to shape.
 *
 * NOTE ON THE IMPORT OF `Reflector`: it is a VALUE import, deliberately. With
 * `emitDecoratorMetadata` on, an `import type` is erased and `design:paramtypes`
 * emits `Object` instead of `Reflector` — so the container cannot resolve this
 * interceptor if it is ever registered as an `APP_INTERCEPTOR` provider. See the
 * footgun note in the `toolchain-config` skill.
 */
export const RAW_RESPONSE = 'raw_response';
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/** Attach a user-facing message to a handler's response. Translate it in the service. */
export const RESPONSE_MESSAGE = 'response_message';
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE, message);

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T> | T> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isRaw) return next.handle();

    const message =
      this.reflector.getAllAndOverride<string>(RESPONSE_MESSAGE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'OK';

    const statusCode = this.resolveStatusCode(context);

    return next.handle().pipe(
      map((data) => ({
        message,
        statusCode,
        data: data ?? null,
        timestamp: new Date().toISOString(),
      })),
    );
  }

  /**
   * §4: the body's `statusCode` MUST equal the HTTP status line.
   *
   * It cannot simply be read off the response. Nest applies the handler's status in
   * `RouterResponseController.apply()` AFTER the interceptor chain resolves, so at
   * this point `response.statusCode` is still Express's default 200 — which is how a
   * `POST` ends up returning HTTP 201 with `"statusCode": 200` in the body, the exact
   * inconsistency this envelope exists to prevent.
   *
   * So resolve it the same way Nest is about to: an explicit `@HttpCode()` wins,
   * otherwise a status the handler set itself through `@Res({ passthrough: true })`,
   * otherwise the framework default for the verb.
   */
  private resolveStatusCode(context: ExecutionContext): number {
    const declared = this.reflector.getAllAndOverride<number | undefined>(HTTP_CODE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (declared) return declared;

    const http = context.switchToHttp();
    const response = http.getResponse<Response>();

    // A handler that set its own status via `@Res({ passthrough: true })` has already
    // moved this off the default; respect it.
    //
    // `response.statusCode` is a plain number, so it is compared against a widened
    // constant rather than the enum member directly — `no-unsafe-enum-comparison`
    // rejects number-vs-enum, and it is right to: the two are not the same type.
    const EXPRESS_DEFAULT_STATUS: number = HttpStatus.OK;
    if (response.statusCode !== EXPRESS_DEFAULT_STATUS) return response.statusCode;

    return http.getRequest<Request>().method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
  }
}
