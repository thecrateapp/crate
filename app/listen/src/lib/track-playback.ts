import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import { trackPlaybackApiPath } from "@/lib/library-routes";
import type { PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";

export interface PlaybackQuality {
  format: string | null;
  codec: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  bytes: number | null;
  lossless: boolean | null;
  fallback?: boolean | null;
  reason?: string | null;
}

export interface PlaybackResolution {
  stream_url: string;
  requested_policy: string;
  effective_policy: string;
  source: PlaybackQuality;
  delivery: PlaybackQuality;
  transcoded: boolean;
  cache_hit: boolean;
  preparing: boolean;
  task_id: string | null;
  variant_id: string | null;
  variant_status: string | null;
  playback_session: string;
  content_origin: "local" | "remote" | "imported";
}

type PlaybackTrack = Pick<
  Track,
  "id" | "globalTrackUid" | "entityUid" | "libraryTrackId" | "path"
>;

interface CacheEntry {
  resolution: PlaybackResolution;
  timestamp: number;
}

const TRACK_PLAYBACK_TTL_MS = 30 * 1000;
const trackPlaybackCache = new Map<string, CacheEntry>();
const inflightTrackPlayback = new Map<string, Promise<PlaybackResolution>>();

type PlaybackQualityForComparison = Pick<
  PlaybackQuality,
  | "format"
  | "codec"
  | "bitrate"
  | "sample_rate"
  | "bit_depth"
  | "lossless"
  | "bytes"
>;

function normalizedQualityFormat(
  quality: PlaybackQualityForComparison,
): string {
  return (quality.codec || quality.format || "").toLowerCase();
}

function normalizedQualityValue(value: unknown): unknown {
  return value ?? null;
}

function playbackQualitiesEquivalent(
  source: PlaybackQualityForComparison,
  delivery: PlaybackQualityForComparison,
): boolean {
  return (
    normalizedQualityFormat(source) === normalizedQualityFormat(delivery) &&
    normalizedQualityValue(source.bitrate) ===
      normalizedQualityValue(delivery.bitrate) &&
    normalizedQualityValue(source.sample_rate) ===
      normalizedQualityValue(delivery.sample_rate) &&
    normalizedQualityValue(source.bit_depth) ===
      normalizedQualityValue(delivery.bit_depth) &&
    normalizedQualityValue(source.lossless) ===
      normalizedQualityValue(delivery.lossless)
  );
}

export function playbackResolutionShowsDeliveryQuality(
  resolution:
    | {
        requested_policy?: string | null;
        effective_policy?: string | null;
        transcoded?: boolean | null;
        source?: PlaybackQualityForComparison | null;
        delivery?: PlaybackQualityForComparison | null;
      }
    | null
    | undefined,
): boolean {
  if (!resolution) return false;
  if (resolution.transcoded) return true;
  if (resolution.effective_policy === "original") return false;
  if (!resolution.source || !resolution.delivery) return true;
  return !playbackQualitiesEquivalent(resolution.source, resolution.delivery);
}

export function resolveTrackPlaybackUrl(
  track: PlaybackTrack,
  policy: PlaybackDeliveryPolicy,
): string | null {
  const path = trackPlaybackApiPath(track);
  if (!path) return null;
  return policy === "original"
    ? path
    : `${path}?delivery=${encodeURIComponent(policy)}`;
}

export function getCachedTrackPlayback(url: string): PlaybackResolution | null {
  const cached = trackPlaybackCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > TRACK_PLAYBACK_TTL_MS) {
    trackPlaybackCache.delete(url);
    return null;
  }
  return cached.resolution;
}

async function loadTrackPlayback(url: string): Promise<PlaybackResolution> {
  const cached = getCachedTrackPlayback(url);
  if (cached) return cached;

  const existing = inflightTrackPlayback.get(url);
  if (existing) return existing;

  const request = api<PlaybackResolution>(url)
    .then((resolution) => {
      trackPlaybackCache.set(url, { resolution, timestamp: Date.now() });
      return resolution;
    })
    .finally(() => {
      inflightTrackPlayback.delete(url);
    });

  inflightTrackPlayback.set(url, request);
  return request;
}

export async function fetchTrackPlayback(
  track: PlaybackTrack,
  policy: PlaybackDeliveryPolicy,
): Promise<PlaybackResolution | null> {
  const url = resolveTrackPlaybackUrl(track, policy);
  return url ? loadTrackPlayback(url) : null;
}

export function __resetTrackPlaybackCacheForTests(): void {
  trackPlaybackCache.clear();
  inflightTrackPlayback.clear();
}

export function getTrackQualityFromPlaybackQuality(
  quality: PlaybackQuality | null | undefined,
  options: { preferCodec?: boolean } = {},
) {
  if (!quality) {
    return {
      format: undefined,
      bitrate: undefined,
      sampleRate: undefined,
      bitDepth: undefined,
    };
  }

  const format = options.preferCodec
    ? quality.codec || quality.format
    : quality.format || quality.codec;
  return {
    format: format || undefined,
    bitrate: quality.bitrate ?? undefined,
    sampleRate: quality.sample_rate ?? undefined,
    bitDepth: quality.bit_depth ?? undefined,
  };
}
