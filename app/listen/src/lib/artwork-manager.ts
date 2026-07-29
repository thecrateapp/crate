import {
  ensureMediaAccessUrl,
  isUsableMediaAssetUrl,
  requiresMediaAccessTicket,
  resolveMaybeApiAssetUrl,
} from "@/lib/api";
import type { ArtworkSource } from "@/lib/artwork-source";

export interface ResolvedArtworkCandidate {
  logicalKey: string;
  contentKey: string;
  src: string;
  srcSet?: string;
  sizes?: string;
}

interface PreloadArtworkOptions {
  fetchPriority?: "high" | "low" | "auto";
  signal?: AbortSignal;
}

interface ParsedSourceSetCandidate {
  src: string;
  descriptor: string;
}

const inFlightPreloads = new Map<string, Promise<ResolvedArtworkCandidate>>();

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isInternalApiArtwork(value: string): boolean {
  try {
    const parsed = new URL(value, "https://crate.local");
    if (!parsed.pathname.startsWith("/api/")) return false;
    if (!isAbsoluteHttpUrl(value)) return true;
    return (
      (typeof window !== "undefined" &&
        parsed.origin === window.location.origin) ||
      requiresMediaAccessTicket(value)
    );
  } catch {
    return /^\/?api\//.test(value);
  }
}

export function canonicalArtworkTransportIdentity(
  value: string | null | undefined,
): string {
  if (!value || !isInternalApiArtwork(value)) return value ?? "";
  try {
    const absolute = isAbsoluteHttpUrl(value);
    const parsed = new URL(value, "https://crate.local");
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("media_ticket");
    return absolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value
      .replace(/([?&])(token|media_ticket)=[^&]*&?/g, "$1")
      .replace(/[?&]$/, "");
  }
}

function parseSourceSet(value: string | undefined): ParsedSourceSetCandidate[] {
  if (!value) return [];
  return value
    .split(",")
    .map((candidate) => {
      const match = candidate.trim().match(/^(\S+)(?:\s+(.+))?$/);
      return match?.[1] ? { src: match[1], descriptor: match[2] ?? "" } : null;
    })
    .filter((candidate): candidate is ParsedSourceSetCandidate =>
      Boolean(candidate),
    );
}

function formatSourceSet(
  candidates: readonly ParsedSourceSetCandidate[],
): string | undefined {
  if (!candidates.length) return undefined;
  return candidates
    .map(({ src, descriptor }) => (descriptor ? `${src} ${descriptor}` : src))
    .join(", ");
}

function sourceSetContentIdentity(value: string | undefined): string {
  return (
    formatSourceSet(
      parseSourceSet(value).map(({ src, descriptor }) => ({
        src: canonicalArtworkTransportIdentity(src),
        descriptor,
      })),
    ) ?? ""
  );
}

function contentKey(source: ArtworkSource): string {
  return [
    source.logicalKey,
    canonicalArtworkTransportIdentity(source.src),
    sourceSetContentIdentity(source.srcSet),
  ].join("\u0000");
}

function resolvedSourceSet(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const candidates = parseSourceSet(value).map(({ src, descriptor }) => {
    const resolved = resolveMaybeApiAssetUrl(src);
    return resolved && isUsableMediaAssetUrl(resolved)
      ? { src: resolved, descriptor }
      : null;
  });
  if (candidates.some((candidate) => candidate === null)) return undefined;
  return formatSourceSet(
    candidates.filter(
      (candidate): candidate is ParsedSourceSetCandidate => candidate !== null,
    ),
  );
}

export function resolveArtworkCandidate(
  source: ArtworkSource,
): ResolvedArtworkCandidate | null {
  const resolved = resolveMaybeApiAssetUrl(source.src);
  if (!resolved || !isUsableMediaAssetUrl(resolved)) return null;
  return {
    logicalKey: source.logicalKey,
    contentKey: contentKey(source),
    src: resolved,
    srcSet: resolvedSourceSet(source.srcSet),
    sizes: source.sizes,
  };
}

async function refreshSource(value: string): Promise<string> {
  if (!requiresMediaAccessTicket(value)) {
    return resolveMaybeApiAssetUrl(value) ?? value;
  }
  return ensureMediaAccessUrl(value, "artwork", { forceRefresh: true });
}

export async function refreshArtworkCandidate(
  source: ArtworkSource,
): Promise<ResolvedArtworkCandidate | null> {
  if (!source.src) return null;
  const src = await refreshSource(source.src);
  const resolved = resolveArtworkCandidate(source);
  if (!resolved || !isUsableMediaAssetUrl(src)) return null;
  return { ...resolved, src };
}

function preloadCandidate(
  candidate: ResolvedArtworkCandidate,
  options: PreloadArtworkOptions,
): Promise<ResolvedArtworkCandidate> {
  if (typeof Image === "undefined") return Promise.resolve(candidate);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.fetchPriority = options.fetchPriority ?? "auto";
    if (candidate.sizes) image.sizes = candidate.sizes;
    if (candidate.srcSet) image.srcset = candidate.srcSet;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Artwork preload aborted", "AbortError"));
    };
    image.onload = () => {
      void image
        .decode()
        .catch(() => undefined)
        .then(() => {
          cleanup();
          resolve(candidate);
        });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Unable to preload artwork: ${candidate.contentKey}`));
    };
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    image.src = candidate.src;
  });
}

export function preloadArtwork(
  source: ArtworkSource,
  options: PreloadArtworkOptions = {},
): Promise<ResolvedArtworkCandidate | null> {
  const candidate = resolveArtworkCandidate(source);
  if (!candidate) return Promise.resolve(null);
  return preloadResolvedArtwork(candidate, options);
}

export function preloadResolvedArtwork(
  candidate: ResolvedArtworkCandidate,
  options: PreloadArtworkOptions = {},
): Promise<ResolvedArtworkCandidate> {
  const preloadKey = [
    candidate.contentKey,
    candidate.src,
    candidate.srcSet ?? "",
  ].join("\u0000");
  const existing = inFlightPreloads.get(preloadKey);
  if (existing) return existing;
  const pending = preloadCandidate(candidate, options).finally(() => {
    inFlightPreloads.delete(preloadKey);
  });
  inFlightPreloads.set(preloadKey, pending);
  return pending;
}
