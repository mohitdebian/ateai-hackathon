export class VendorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function vendorError(prefix: string, response: Response, body: string, code?: string) {
  const retryAfter = Number(response.headers.get("retry-after"));
  return new VendorError(
    `${prefix} ${response.status}: ${body}`,
    response.status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    code,
  );
}

type RetryOptions = {
  attempts: number;
  isRetryable: (error: unknown) => boolean;
};

const MAX_RETRY_DELAY_MS = 5000;

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === options.attempts - 1 || !options.isRetryable(error)) throw error;
      const retryAfter = error instanceof VendorError ? error.retryAfterMs : undefined;
      const delay = Math.min(
        retryAfter ?? 250 * 2 ** attempt + Math.floor(Math.random() * 100),
        MAX_RETRY_DELAY_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("retry attempts exhausted");
}

export const isRateLimited = (error: unknown) =>
  error instanceof VendorError && (error.status === 429 || error.code === "ratelimited");

export const isTimeoutError = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "APIConnectionTimeoutError" || error.name === "ComposioRequestCancelledError");

export const isAgentmailRetryable = (error: unknown) =>
  !isTimeoutError(error) && (!(error instanceof VendorError) || isRateLimited(error) || error.status >= 500);

/**
 * Resolve `fn`, or give up and return `fallback` after `ms`. For a caller with
 * a hard deadline it cannot negotiate — Vapi allows 7.5s to say who answers an
 * inbound call (#252), and a late perfect answer drops the call, while an early
 * thin one still connects it.
 *
 * The abandoned promise keeps running; its rejection is swallowed so it cannot
 * surface as an unhandled rejection after the deadline has already passed.
 */
export async function withDeadline<T>(fn: () => Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([
      fn().catch(() => fallback),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
