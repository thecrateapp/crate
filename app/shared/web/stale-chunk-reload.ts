/**
 * Recovery for lazy chunks that disappeared in a deploy.
 *
 * A tab opened before a deploy still references the previous hashed chunks
 * (`/assets/Browse-<hash>.js`). Importing one fails with "Failed to fetch
 * dynamically imported module" (Chrome, Firefox) or "Importing a module script
 * failed." (Safari). Vite dispatches `vite:preloadError` on window for that
 * failure; this reloader answers it with one page reload, which fetches the new
 * `index.html` and its new chunk names, and keeps the failure out of Sentry.
 *
 * Loop guard: the reload time is kept in sessionStorage. If another chunk
 * fails within `retryWindowMs` of a reload, the error is let through (thrown and
 * reported), because reloading again would not help. Without storage there is
 * no guard, so nothing is reloaded and the error is reported as before.
 */

export const STALE_CHUNK_RELOAD_KEY = "crate:stale-chunk-reload-at";
export const STALE_CHUNK_RETRY_WINDOW_MS = 60_000;
const RELOAD_PENDING_MS = 10_000;

export interface StaleChunkReloadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StaleChunkReloadOptions {
  storage: StaleChunkReloadStorage | null;
  reload: () => void;
  now?: () => number;
  retryWindowMs?: number;
  /** How long `isReloadPending()` stays true after the reload starts. */
  reloadPendingMs?: number;
  key?: string;
}

export interface StaleChunkReloader {
  /** Listener for Vite's `vite:preloadError` window event. */
  handlePreloadError(event: Event): void;
  /**
   * True between starting a reload and the page unloading. Errors raised in
   * that window are consequences of the stale chunk (React.lazy receives an
   * empty module once the preload error is handled) and are not reported.
   */
  isReloadPending(): boolean;
}

export function createStaleChunkReloader(
  options: StaleChunkReloadOptions,
): StaleChunkReloader {
  const now = options.now ?? Date.now;
  const key = options.key ?? STALE_CHUNK_RELOAD_KEY;
  const retryWindowMs = options.retryWindowMs ?? STALE_CHUNK_RETRY_WINDOW_MS;
  const reloadPendingMs = options.reloadPendingMs ?? RELOAD_PENDING_MS;
  let pendingUntil = 0;

  const isReloadPending = () => now() < pendingUntil;

  const handlePreloadError = (event: Event): void => {
    if (isReloadPending()) {
      // A second chunk failed while the first one's reload is underway.
      event.preventDefault();
      return;
    }
    const storage = options.storage;
    if (!storage) return;

    const at = now();
    try {
      const last = Number(storage.getItem(key));
      const sinceLast = at - last;
      if (last > 0 && sinceLast >= 0 && sinceLast < retryWindowMs) return;
      storage.setItem(key, String(at));
    } catch {
      return;
    }

    event.preventDefault();
    pendingUntil = at + reloadPendingMs;
    options.reload();
  };

  return { handlePreloadError, isReloadPending };
}

/** sessionStorage, or null where the browser refuses access to it. */
export function browserSessionStorage(): StaleChunkReloadStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
