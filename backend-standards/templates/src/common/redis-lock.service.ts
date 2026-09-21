import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Distributed lock.
 *
 * Standard: .ai/standards/01-engineering-standards.md §8.
 *
 * TWO THINGS THIS GETS RIGHT THAT A NAIVE LOCK DOES NOT
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. RELEASE VERIFIES OWNERSHIP. A bare DEL deletes whatever lock is currently
 *    held — which, once your TTL has expired and another caller has acquired it,
 *    is someone else's. The Lua script below deletes only if the token matches.
 *
 * 2. IT FAILS CLOSED. If Redis is unreachable, withLock throws rather than running
 *    the critical section unguarded. Skipping the lock because the lock store is
 *    down removes mutual exclusion at exactly the moment the system is already
 *    degraded — which is when concurrent duplicates actually happen.
 *
 * NOTE ON THE IMPORT OF `Redis`: it is a VALUE import, deliberately. With
 * `emitDecoratorMetadata` on, an `import type` is erased and `design:paramtypes`
 * emits `Object` instead of `Redis` — the container then fails with "Nest can't
 * resolve dependencies of the RedisLockService (?)". See the footgun note in the
 * `toolchain-config` skill.
 *
 * Register the client under the `Redis` token so this resolves:
 *
 *   { provide: Redis, useFactory: (c: AppConfig) => new Redis(c.redisUrl) }
 */

const RELEASE_IF_OWNER = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(private readonly redis: Redis) {}

  /**
   * Run fn while holding key. Releases only the lock this call acquired.
   *
   * @param ttlSeconds MUST exceed the worst-case runtime of fn, or a second caller
   *                   will acquire the lock while this one is still running.
   * @throws {ConflictException}           the lock is already held
   * @throws {ServiceUnavailableException} the lock store is unreachable (fail closed)
   */
  async withLock<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();

    let acquired: 'OK' | null;
    try {
      acquired = await this.redis.set(key, token, 'EX', ttlSeconds, 'NX');
    } catch (error) {
      // Fail closed. Do NOT proceed unguarded.
      this.logger.error('Lock store unreachable; rejecting operation', {
        key,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableException('Operation temporarily unavailable');
    }

    if (acquired !== 'OK') {
      throw new ConflictException('Operation already in progress');
    }

    try {
      return await fn();
    } finally {
      try {
        await this.redis.eval(RELEASE_IF_OWNER, 1, key, token);
      } catch (error) {
        // The lock will expire on its own; losing the release is not fatal.
        this.logger.warn('Lock release failed; relying on TTL', {
          key,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
