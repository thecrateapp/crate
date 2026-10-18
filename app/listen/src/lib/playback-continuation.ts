import type { PlaySource } from "@/contexts/player-types";
import { api, getApiBase } from "@/lib/api";
import type { EngineContinuationDescriptor } from "@/lib/playback-engine";

const REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 60 * 1000;

export interface PlaybackContinuationToken {
  token: string;
  expiresAtMs: number;
  apiBase: string;
}

let cachedToken:
  | (PlaybackContinuationToken & { descriptorKey: string })
  | null = null;

export async function getPlaybackContinuationToken(
  descriptor: EngineContinuationDescriptor | null = null,
): Promise<PlaybackContinuationToken> {
  const apiBase = getApiBase();
  const descriptorKey = JSON.stringify(descriptor);
  if (
    cachedToken &&
    cachedToken.apiBase === apiBase &&
    cachedToken.descriptorKey === descriptorKey &&
    cachedToken.expiresAtMs - Date.now() > REFRESH_BEFORE_EXPIRY_MS
  ) {
    const { token, expiresAtMs } = cachedToken;
    return { token, expiresAtMs, apiBase };
  }
  const response = await api<{ token: string; expiresAt: string }>(
    "/api/playback/continuation-token",
    "POST",
    descriptor ? { descriptor } : undefined,
  );
  cachedToken = {
    token: response.token,
    expiresAtMs: Date.parse(response.expiresAt),
    apiBase,
    descriptorKey,
  };
  return {
    token: cachedToken.token,
    expiresAtMs: cachedToken.expiresAtMs,
    apiBase,
  };
}

export function continuationDescriptor(
  source: PlaySource | null,
  options: { shuffle: boolean; infinite: boolean },
): EngineContinuationDescriptor | null {
  const radio = source?.radio;
  if (!source || !radio) return null;
  if (source.type === "radio") {
    if (radio.shapedSessionId) {
      return { kind: "shaped_radio", sessionId: radio.shapedSessionId };
    }
    return seededDescriptor(radio);
  }
  if (!options.infinite || options.shuffle) return null;
  if (
    (source.type === "album" && radio.seedType === "album") ||
    (source.type === "playlist" && radio.seedType === "playlist")
  ) {
    return seededDescriptor(radio);
  }
  return null;
}

function seededDescriptor(
  radio: NonNullable<PlaySource["radio"]>,
): EngineContinuationDescriptor | null {
  if (radio.seedType === "track") {
    const seedId = radio.seedEntityUid ?? radio.seedId;
    return seedId != null
      ? { kind: "seeded_radio", seedType: "track", seedId: String(seedId) }
      : null;
  }
  if (radio.seedId == null) return null;
  const seedId = String(radio.seedId);
  if (radio.seedType === "artist" || radio.seedType === "album") {
    return { kind: "seeded_radio", seedType: radio.seedType, seedId };
  }
  if (radio.seedType === "playlist") {
    return {
      kind: "seeded_radio",
      seedType: typeof radio.seedId === "number" ? "playlist" : "home_playlist",
      seedId,
    };
  }
  if (radio.seedType === "home-playlist") {
    return { kind: "seeded_radio", seedType: "home_playlist", seedId };
  }
  return null;
}
