import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/**
 * Correlation ID — generated or accepted per request, then propagated.
 *
 * Standard: .ai/standards/01-engineering-standards.md §14 (MUST),
 *           .ai/standards/02-security-and-compliance.md §1 Class D.
 *
 * TWO THINGS THIS FILE EXISTS TO GET RIGHT
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. A CLIENT-SUPPLIED ID IS UNTRUSTED INPUT. §14 requires it to be format-validated
 *    before use, and the reason is concrete: this value gets written into a log
 *    column, echoed in a response header, and forwarded to upstream providers. An
 *    unvalidated header is an unbounded attacker-controlled string on all three
 *    surfaces. A value that does not match the pattern is REPLACED, not rejected —
 *    a malformed trace header is not worth failing a request over.
 *
 * 2. IT HAS TO REACH THE LOGGER WITHOUT BEING THREADED THROUGH EVERY CALL. §14 says
 *    logs and all downstream calls carry it; in practice that only happens if it is
 *    ambient. `AsyncLocalStorage` makes `getCorrelationId()` work anywhere inside the
 *    request — a logger, a repository, an outbound client — with no parameter passing
 *    and no `any`.
 *
 * The ID is Class D (§1): unrestricted, safe in every environment. That is exactly
 * why it should be the primary means of tracing.
 */

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Deliberately narrow: URL-safe, bounded length. It admits a UUID, a ULID and most
 * upstream trace IDs, and admits nothing with a newline, a quote or a control
 * character in it.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augmentation requires it
  namespace Express {
    interface Request {
      /**
       * Optional on purpose. The middleware always sets it, but a failure raised
       * before the middleware runs still reaches the exception filter — and a type
       * that promises a value there would be lying at exactly the moment someone is
       * reading the log to find out what happened.
       */
      correlationId?: string;
    }
  }
}

const storage = new AsyncLocalStorage<{ correlationId: string }>();

/**
 * The correlation ID for the request currently being handled.
 *
 * Returns `undefined` outside a request — a cron tick, a queue consumer, boot. Give
 * those their own ID with `runWithCorrelationId` rather than logging without one.
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/** Run work under a correlation ID. Use for queue jobs and scheduled tasks. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

function resolveCorrelationId(header: unknown): string {
  return typeof header === 'string' && CORRELATION_ID_PATTERN.test(header) ? header : randomUUID();
}

/**
 * Express middleware. Register it before anything that logs — in `main.ts`:
 *
 *   app.use(correlationIdMiddleware);
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // eslint-disable-next-line security/detect-object-injection -- constant key, not user input
  const correlationId = resolveCorrelationId(req.headers[CORRELATION_ID_HEADER]);

  req.correlationId = correlationId;
  // Echo it so a client can quote it in a support ticket.
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  storage.run({ correlationId }, () => next());
}
