// The live dependencies of the launcher-art pipeline in the desktop app: the
// app's media tickets and fetch, the webview's loaded images, canvas
// cropping, and the native shell's cache commands.

import { ensureMediaAccessUrl } from "@/lib/api";
import {
  findLoadedImage,
  squareJpeg,
  type LauncherArtDeps,
} from "@/lib/desktop-launcher-art";

export const LAUNCHER_ART_DEPS: LauncherArtDeps = {
  authorize: (url) => ensureMediaAccessUrl(url, "artwork"),
  fetch: (url, init) => fetch(url, init),
  loadedImage: (url) => findLoadedImage(url),
  toSquare: squareJpeg,
  store: (key, bytes) =>
    window.__crateTauriInvoke?.("store_launcher_art", { key, bytes }) ??
    Promise.resolve(false),
};

/** Keys the shell has no image for; null where it has no launcher cache. */
export function launcherArtMissing(keys: string[]): Promise<string[] | null> {
  const pending = window.__crateTauriInvoke?.<string[] | null>(
    "launcher_art_missing",
    { keys },
  );
  if (!pending) return Promise.resolve(null);
  return pending.then(
    (missing) => (Array.isArray(missing) ? missing : null),
    () => null,
  );
}
