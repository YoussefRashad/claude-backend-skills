import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

import type { ApiEnvelope } from '../common/api-envelope';

import {
  RAW_RESPONSE,
  RESPONSE_MESSAGE,
  ResponseEnvelopeInterceptor,
} from './response-envelope.interceptor';

/**
 * §4 claims the body's `statusCode` always equals the HTTP status line. That claim is
 * only worth something if something checks it — and the naive implementation (reading
 * `response.statusCode` inside the map) silently returns 200 on every `POST`, because
 * Nest applies the real status AFTER the interceptor chain resolves.
 *
 * The first test below is that regression.
 */
describe('ResponseEnvelopeInterceptor', () => {
  const makeContext = (method = 'GET', responseStatus: number = HttpStatus.OK) =>
    ({
      switchToHttp: () => ({
        getResponse: () => ({ statusCode: responseStatus }),
        getRequest: () => ({ method }),
      }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    }) as unknown as ExecutionContext;

  const makeReflector = (metadata: Record<string, unknown> = {}) =>
    // eslint-disable-next-line security/detect-object-injection -- test fixture, keys are literals
    ({ getAllAndOverride: (key: string) => metadata[key] }) as unknown as Reflector;

  const run = <T>(
    metadata: Record<string, unknown>,
    context: ExecutionContext,
    payload: T,
  ): Promise<ApiEnvelope<T> | T> => {
    const interceptor = new ResponseEnvelopeInterceptor<T>(makeReflector(metadata));
    const next = { handle: () => of(payload) } as CallHandler<T>;
    return lastValueFrom(interceptor.intercept(context, next));
  };

  describe('statusCode', () => {
    it('should report 201 when the verb is POST and no explicit code is declared', async () => {
      const body = (await run({}, makeContext('POST'), { id: 1 })) as ApiEnvelope<unknown>;
      expect(body.statusCode).toBe(HttpStatus.CREATED);
    });

    it('should report 200 for a GET', async () => {
      const body = (await run({}, makeContext('GET'), { id: 1 })) as ApiEnvelope<unknown>;
      expect(body.statusCode).toBe(HttpStatus.OK);
    });

    it('should prefer an explicit @HttpCode over the verb default', async () => {
      const metadata = { [HTTP_CODE_METADATA]: HttpStatus.ACCEPTED };
      const body = (await run(metadata, makeContext('POST'), null)) as ApiEnvelope<unknown>;
      expect(body.statusCode).toBe(HttpStatus.ACCEPTED);
    });

    it('should respect a status the handler set itself via @Res({ passthrough: true })', async () => {
      const context = makeContext('GET', HttpStatus.NO_CONTENT);
      const body = (await run({}, context, null)) as ApiEnvelope<unknown>;
      expect(body.statusCode).toBe(HttpStatus.NO_CONTENT);
    });
  });

  describe('envelope', () => {
    it('should use the declared response message when one is set', async () => {
      const metadata = { [RESPONSE_MESSAGE]: 'Payment created successfully' };
      const body = (await run(metadata, makeContext('POST'), {})) as ApiEnvelope<unknown>;
      expect(body.message).toBe('Payment created successfully');
    });

    it('should fall back to OK when no message is declared', async () => {
      const body = (await run({}, makeContext(), {})) as ApiEnvelope<unknown>;
      expect(body.message).toBe('OK');
    });

    it('should normalize an undefined handler result to null rather than dropping the key', async () => {
      const body = (await run({}, makeContext(), undefined)) as ApiEnvelope<unknown>;
      expect(body.data).toBeNull();
      expect(body.timestamp).toEqual(expect.any(String));
    });
  });

  describe('@RawResponse()', () => {
    it('should pass the body through untouched for a route that opted out', async () => {
      const payload = { provider: 'expects-this-exact-shape' };
      const body = await run({ [RAW_RESPONSE]: true }, makeContext(), payload);
      expect(body).toBe(payload);
    });
  });
});
