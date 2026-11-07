/**
 * Stable `sources` for the source maps uploaded to Sentry.
 *
 * A source map lists its sources relative to the map file, so the same file
 * got a different path in every build layout: the old Docker layout produced
 * `../app-shared/shared/web/api.ts`, the current one `../../../shared/web/api.ts`,
 * the desktop build `../../../listen/src/...` (with backslashes on Windows,
 * where the plugin's default hook runs `path.normalize`), and npm hoisting
 * moved `node_modules`. Sentry resolves sources against the frame URL, so each
 * layout gave one call site different frame paths and split it across issues.
 *
 * This is the Sentry Vite plugin's `sourcemaps.rewriteSources` hook, applied to
 * the uploaded copy only; the build output is untouched. It rewrites every
 * source to its path from the repository root, prefixed with the `../` that
 * climbs from the map to the served root. With the SDK rewriting frames to
 * `app:///assets/<chunk>.js`, every build and runtime then resolves
 * `app/shared/web/api.ts` to `app:///app/shared/web/api.ts`. Dependencies
 * collapse to `node_modules/<package>/...` whatever the hoisting.
 *
 * Pure string handling (no `node:path`) so the browser tsconfigs that include
 * `shared/web` can type-check it and Windows paths behave the same on Linux.
 */

export interface SentrySourcePathOptions {
  /** Absolute path of the repository root. */
  repoRoot: string;
  /** Absolute path of the build output directory (the served root). */
  distDir: string;
}

export type SentryRewriteSourcesHook = (
  source: string,
  map?: unknown,
  context?: { mapDir: string },
) => string;

const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const WINDOWS_DRIVE = /^([a-zA-Z]):\//;

export function createSentrySourcePathRewriter(
  options: SentrySourcePathOptions,
): SentryRewriteSourcesHook {
  const root = normalizeFsPath(options.repoRoot);
  const dist = normalizeFsPath(options.distDir);

  return (source, _map, context) => {
    // Same as the plugin's default for sources that are already URLs.
    if (URL_SCHEME.test(source)) return source.replace(URL_SCHEME, "");
    const slashed = source.replace(/\\/g, "/");
    if (!context?.mapDir) return slashed;

    const mapDir = normalizeFsPath(context.mapDir);
    const absolute = normalizeFsPath(
      isAbsolutePath(slashed) ? slashed : `${mapDir}/${slashed}`,
    );
    const stable = repositoryPath(absolute, root);
    return stable === null ? slashed : climbToServedRoot(mapDir, dist) + stable;
  };
}

function repositoryPath(absolute: string, root: string): string | null {
  const dependency = absolute.lastIndexOf("/node_modules/");
  if (dependency >= 0) return absolute.slice(dependency + 1);
  if (absolute.startsWith(`${root}/`)) return absolute.slice(root.length + 1);
  return null;
}

function climbToServedRoot(mapDir: string, dist: string): string {
  if (!mapDir.startsWith(`${dist}/`)) return "";
  const depth = mapDir.slice(dist.length + 1).split("/").length;
  return "../".repeat(depth);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE.test(value);
}

/** Forward slashes, lower-case drive letter, `.` and `..` resolved. */
function normalizeFsPath(value: string): string {
  const slashed = value.replace(/\\/g, "/");
  const drive = WINDOWS_DRIVE.exec(slashed);
  const prefix = drive
    ? `${drive[1]!.toLowerCase()}:/`
    : slashed.startsWith("/")
      ? "/"
      : "";
  const parts: string[] = [];
  for (const part of slashed.slice(prefix.length).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
      else if (!prefix) parts.push("..");
      continue;
    }
    parts.push(part);
  }
  return prefix + parts.join("/");
}
