/** Build-time reads from GitHub: bounded, retried, and loud when they finally fail. */

export interface RetryOptions {
  /** Total attempts, including the first request. */
  attempts?: number;
  /** Per attempt, covering the response body as well as the headers. */
  timeoutMs?: number;
  baseDelayMs?: number;
  /** Upper bound for exponential backoff and for a server's Retry-After. */
  maxDelayMs?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export class RemoteRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RemoteRequestError";
  }
}

// Rate limits, gateway errors and timeouts are transient; 404 and 401 are answers.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function describe(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return `timed out after ${timeoutMs} ms`;
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return String(error);
}

/** Runs at most `concurrency` tasks at once; queued tasks start in call order. */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    // A finishing task hands its slot to the next waiter instead of releasing it,
    // so a newcomer can never slip past the queue and exceed the bound.
    if (active < concurrency) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

/**
 * Requests `url` and passes a successful response to `read`. Network errors,
 * timeouts (including while reading the body) and transient statuses are
 * retried with jittered exponential backoff; other statuses fail at once.
 * The final error always names the URL, the attempts and the last cause.
 */
export async function requestWithRetry<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    attempts = 4, timeoutMs = 20_000, baseDelayMs = 750, maxDelayMs = 30_000,
    fetch: request = globalThis.fetch, sleep = wait, random = Math.random,
  } = options;
  for (let attempt = 1; ; attempt++) {
    let failure: RemoteRequestError;
    try {
      const response = await request(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new RemoteRequestError(`HTTP ${response.status}`, response.status,
          RETRYABLE_STATUS.has(response.status), retryAfterMs(response.headers.get("retry-after")));
      }
      return await read(response);
    } catch (error) {
      failure = error instanceof RemoteRequestError ? error : new RemoteRequestError(describe(error, timeoutMs), undefined, true);
    }
    if (!failure.retryable || attempt >= attempts) {
      const tries = attempt === 1 ? "" : ` after ${attempt} attempts`;
      throw new RemoteRequestError(`${init.method ?? "GET"} ${url} failed${tries}: ${failure.message}`, failure.status);
    }
    const backoff = baseDelayMs * 2 ** (attempt - 1) * (0.75 + random() * 0.5);
    await sleep(Math.min(maxDelayMs, failure.retryAfterMs ?? backoff));
  }
}
