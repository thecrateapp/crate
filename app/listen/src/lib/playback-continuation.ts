import { api, getApiBase } from "@/lib/api";

const REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 60 * 1000;

export interface PlaybackContinuationToken {
  token: string;
  expiresAtMs: number;
  apiBase: string;
}

let cachedToken: PlaybackContinuationToken | null = null;

export async function getPlaybackContinuationToken(): Promise<PlaybackContinuationToken> {
  const apiBase = getApiBase();
  if (
    cachedToken &&
    cachedToken.apiBase === apiBase &&
    cachedToken.expiresAtMs - Date.now() > REFRESH_BEFORE_EXPIRY_MS
  ) {
    return cachedToken;
  }
  const response = await api<{ token: string; expiresAt: string }>(
    "/api/playback/continuation-token",
    "POST",
  );
  cachedToken = {
    token: response.token,
    expiresAtMs: Date.parse(response.expiresAt),
    apiBase,
  };
  return cachedToken;
}
