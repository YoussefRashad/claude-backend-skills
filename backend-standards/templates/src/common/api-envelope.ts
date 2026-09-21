/**
 * The success envelope for this service.
 *
 * Standard: .ai/standards/01-engineering-standards.md §4.
 *
 * WITHIN ONE SERVICE THE CHOICE IS ALL-OR-NOTHING.
 * If this service uses the envelope, every endpoint uses it. A service where some
 * endpoints are wrapped and some are not pushes per-endpoint branching into every
 * client, and the list of exceptions is forgotten within months.
 *
 * MUST NOT be retrofitted onto a service whose clients already parse another shape.
 *
 * NAMED `ApiEnvelope`, NOT `ApiResponse`, on purpose: `@nestjs/swagger` exports an
 * `ApiResponse` decorator, and a controller that wants both ends up renaming one at
 * every import site.
 */
export interface ApiEnvelope<T> {
  /** Translated, user-displayable. This is what earns the envelope its place. */
  message: string;
  statusCode: number;
  data: T | null;
  timestamp: string;
  /** Present on errors only; the HTTP status text. */
  error?: string;
}
