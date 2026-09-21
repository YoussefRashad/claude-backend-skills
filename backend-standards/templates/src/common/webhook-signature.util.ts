import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Provider webhook signature verification.
 *
 * Standard: .ai/standards/02-security-and-compliance.md §7.
 *
 * A webhook route is unauthenticated by design — the provider cannot carry your
 * request signature. The provider's own signature is therefore the ONLY control on
 * that route, which makes the order of operations load-bearing:
 *
 *   VERIFY FIRST. Before any database read. Before acquiring a lock. Before any
 *   status check. Before anything is written.
 *
 * The tempting mistake is to look the order up first, then verify, then record the
 * failure against that order. That hands an unauthenticated caller the ability to
 * mutate record state and write attacker-controlled strings into an audit trail —
 * and it can move the record out of whatever set a reconciliation job sweeps.
 *
 * A request that fails verification MUST change nothing.
 */

/** Constant-time comparison. A plain !== on a hash leaks timing. */
export function signaturesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function computeHmac(
  payload: string,
  secret: string,
  algorithm: 'sha256' | 'sha512' = 'sha512',
  encoding: 'hex' | 'base64' = 'hex',
): string {
  return createHmac(algorithm, secret).update(payload).digest(encoding);
}

/**
 * Verify, or throw. Call as the first statement in the handler.
 *
 * @throws {Error} the caller maps this to 400 and MUST persist nothing
 */
export function assertValidSignature(params: {
  payload: string;
  received: string;
  secret: string;
  algorithm?: 'sha256' | 'sha512';
  encoding?: 'hex' | 'base64';
}): void {
  const expected = computeHmac(params.payload, params.secret, params.algorithm, params.encoding);
  if (!signaturesMatch(expected, params.received)) {
    throw new Error('Invalid webhook signature');
  }
}

/*
 * Replay protection is a SEPARATE obligation (§7). A valid signature does not make
 * a request fresh — a captured, valid callback can be replayed indefinitely.
 *
 * Store the provider's event id with a unique constraint, or enforce a timestamp
 * freshness window. Order-status guards ("already paid", "already failed") are
 * duplicate suppression, not replay protection: they depend on the record's state
 * rather than on the identity of the webhook delivery.
 */
