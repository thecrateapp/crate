import { decodeCastSpectrum, type CastSpectrumArtifact } from "./format";

const DEFAULT_MAX_ATTEMPTS = 6;
const MIN_RETRY_MS = 250;
const MAX_RETRY_MS = 5_000;

type Fetcher = typeof fetch;
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

interface SpectrumClientOptions {
  fetcher?: Fetcher;
  maxAttempts?: number;
  sleep?: Sleep;
}

interface LoadOptions {
  signal?: AbortSignal;
}

interface CachedSpectrum {
  artifact: CastSpectrumArtifact;
  etag: string | null;
}

export class SpectrumUnavailableError extends Error {
  constructor() {
    super("CAST_SPECTRUM_UNAVAILABLE");
    this.name = "SpectrumUnavailableError";
  }
}

function unavailable(): never {
  throw new SpectrumUnavailableError();
}

function defaultSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function retryDelay(response: Response): number {
  const value = response.headers.get("Retry-After");
  if (!value) return 1_000;

  const seconds = Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(delay)) return 1_000;
  return Math.min(MAX_RETRY_MS, Math.max(MIN_RETRY_MS, delay));
}

export function createSpectrumClient(options: SpectrumClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const sleep = options.sleep ?? defaultSleep;
  const cache = new Map<string, CachedSpectrum>();

  return {
    async load(
      url: string,
      loadOptions: LoadOptions = {},
    ): Promise<CastSpectrumArtifact> {
      const cached = cache.get(url);

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const headers = cached?.etag
          ? { "If-None-Match": cached.etag }
          : undefined;
        let response: Response;
        try {
          response = await fetcher(url, {
            cache: "no-store",
            credentials: "omit",
            headers,
            mode: "cors",
            signal: loadOptions.signal,
          });
        } catch (error) {
          if (loadOptions.signal?.aborted) throw error;
          unavailable();
        }

        if (response.status === 304 && cached) return cached.artifact;

        if (response.status === 200) {
          try {
            const artifact = decodeCastSpectrum(await response.arrayBuffer());
            cache.set(url, {
              artifact,
              etag: response.headers.get("ETag"),
            });
            return artifact;
          } catch {
            unavailable();
          }
        }

        if (
          (response.status === 202 || response.status === 425) &&
          attempt + 1 < maxAttempts
        ) {
          await sleep(retryDelay(response), loadOptions.signal);
          continue;
        }
        unavailable();
      }
      unavailable();
    },
    clear(): void {
      cache.clear();
    },
  };
}

export type SpectrumClient = ReturnType<typeof createSpectrumClient>;
export const spectrumClient = createSpectrumClient();
