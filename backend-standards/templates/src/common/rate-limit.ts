import type { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { seconds, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Global rate limiting.
 *
 * Standard: .ai/standards/02-security-and-compliance.md §9 — "Rate limiting MUST be
 * enabled globally, and MUST key on the real client IP when behind a proxy."
 * Also §4 (brute-force defence) and §7 (a webhook route MUST be rate-limited).
 *
 * THIS IS A MUST, NOT A NICE-TO-HAVE, so it ships wired rather than described.
 *
 * KEYING ON THE REAL CLIENT IP
 * ──────────────────────────────────────────────────────────────────────────────
 * `ThrottlerGuard` tracks by `req.ip`. Behind a proxy that is the proxy's address
 * for every caller — one shared bucket, so one noisy client throttles everyone, and
 * a determined one is not throttled at all. `main.ts` sets `trust proxy`, which is
 * what makes `req.ip` the real client address. The two settings only work together:
 * changing one without the other silently breaks this control.
 *
 * TWO WINDOWS, ON PURPOSE
 * A per-minute budget bounds sustained abuse; a per-second burst limit bounds the
 * credential-stuffing shape, which is a short flood rather than a steady stream.
 */
export const throttlerRootOptions: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'default', ttl: seconds(60), limit: 100 },
    { name: 'burst', ttl: seconds(1), limit: 10 },
  ],
};

/**
 * Registers the guard globally. A guard registered per-controller is a guard someone
 * forgets on the next controller — §9 says globally, so register it globally.
 */
export const ThrottlerGuardProvider: Provider = {
  provide: APP_GUARD,
  useClass: ThrottlerGuard,
};

/*
 * Wire both into AppModule:
 *
 *   import { ThrottlerModule } from '@nestjs/throttler';
 *   import { throttlerRootOptions, ThrottlerGuardProvider } from './common/rate-limit';
 *
 *   @Module({
 *     imports: [ThrottlerModule.forRoot(throttlerRootOptions)],
 *     providers: [ThrottlerGuardProvider],
 *   })
 *   export class AppModule {}
 *
 * Then tighten the paths that need it, rather than loosening the global default:
 *
 *   @Throttle({ default: { ttl: seconds(60), limit: 5 } })   // §4 — auth attempts
 *   @Post('login')
 *
 * Note that this is per-instance, in memory. Across N replicas the effective limit is
 * N times what is written above, and it resets on deploy. Where a limit is a security
 * control rather than a capacity guard — OTP issuance, login attempts — back it with
 * the Redis counter in §8 of `01`, which is shared and survives a restart. Record
 * which limits are which in `.ai/standards/03-project-architecture.md`.
 */
