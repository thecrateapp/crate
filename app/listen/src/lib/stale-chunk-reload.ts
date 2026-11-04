import {
  browserSessionStorage,
  createStaleChunkReloader,
} from "../../../shared/web/stale-chunk-reload";

const reloader = createStaleChunkReloader({
  storage: browserSessionStorage(),
  reload: () => window.location.reload(),
});

/** True while a stale-chunk reload is underway; Sentry drops events then. */
export const isStaleChunkReloadPending = reloader.isReloadPending;

/** Reload once when a lazy chunk from a previous deploy is gone. */
export function installStaleChunkReload(target: Window = window): () => void {
  target.addEventListener("vite:preloadError", reloader.handlePreloadError);
  return () =>
    target.removeEventListener(
      "vite:preloadError",
      reloader.handlePreloadError,
    );
}
