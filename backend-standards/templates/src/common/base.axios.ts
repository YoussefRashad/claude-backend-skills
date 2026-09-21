import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import axios from 'axios';

/**
 * Base for every outbound HTTP client.
 *
 * Standard: .ai/standards/01-engineering-standards.md §10.
 *
 * THE TIMEOUT IS NOT OPTIONAL. An axios instance created without one waits forever,
 * holding a request slot and a connection. The constructor refuses to build an
 * instance without a timeout, so the mistake surfaces at boot rather than at 3am.
 *
 * MUST NOT disable TLS verification. If you are reaching for rejectUnauthorized:
 * false, the certificate is the problem — fix that.
 *
 * MUST NOT add a retry interceptor here. An interceptor installed on the instance
 * retries EVERY call the client makes, including the ones that deduct, submit, or
 * consume a vendor session. Retry at the call site, for calls you have confirmed
 * are idempotent (§10).
 */
export abstract class BaseAxios {
  protected readonly instance: AxiosInstance;
  protected readonly logger: Logger;

  protected constructor(config: AxiosRequestConfig & { timeout: number; name: string }) {
    if (!config.timeout || config.timeout <= 0) {
      throw new Error(`${config.name}: an explicit timeout is required (01 §10)`);
    }

    this.logger = new Logger(config.name);
    this.instance = axios.create({
      ...config,
      headers: { 'Content-Type': 'application/json', ...config.headers },
    });

    this.instance.interceptors.response.use(
      (response) => response,
      (error: unknown) => this.handleError(error),
    );
  }

  /**
   * Override to map a vendor's error codes to domain exceptions.
   *
   * Note the guards. On a network failure there IS no response, and unguarded
   * access to error.response.status replaces the real error with a TypeError —
   * masking the actual cause at the worst possible moment (§10).
   */
  protected handleError(error: unknown): never {
    const err = error as { code?: string; message?: string; response?: { status?: number } };

    if (err?.code === 'ECONNREFUSED' || err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
      this.logger.error('Upstream unreachable', { code: err.code, message: err.message });
      throw new ServiceUnavailableException('Upstream service unavailable');
    }

    this.logger.error('Upstream error', {
      status: err?.response?.status,
      message: err?.message,
      // Never log the raw error object — it carries the full request config,
      // including headers and body (02 §2.4).
    });

    throw error;
  }
}
