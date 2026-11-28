/**
 * D7 (Android Auto design): while the Android device profile is active, the
 * native playback service authorizes streams and artwork with the native
 * device token, so engine tracks stop carrying the 1 h session bearer.
 *
 * This module only holds the in-memory mirror of the active profile and the
 * route rules; `native-device-profile.ts` keeps it up to date. It has no
 * Capacitor or API imports so the player adapter can use it cheaply.
 */

export interface ActiveNativeDeviceProfile {
  serverId: string;
  /** Origin of the server the device token belongs to. */
  origin: string;
  tokenId: number;
  expiresAtMs: number;
}

/**
 * The session bearer stays on tracks when the device token expires within
 * this margin, so a stream never starts with a credential about to lapse.
 */
export const NATIVE_DEVICE_TOKEN_MARGIN_MS = 5 * 60 * 1000;

// Mirrors the stream and artwork entries of _NATIVE_DEVICE_ACCESS_TOKEN_ROUTES
// (app/crate/api/auth.py) and NativeStreamAuthorization.java. Other paths on
// the same origin (federated streams) keep the session bearer.
const SEGMENT = String.raw`(?!\.\.?(?:/|$))[^/]+`;
const DEVICE_STREAM_PATH = new RegExp(
  String.raw`^/api/(?:tracks/by-entity/${SEGMENT}/stream|catalog/tracks/${SEGMENT}/stream|tracks/\d+/stream|stream/.+|playback/variants/${SEGMENT}/stream)$`,
);
const DEVICE_ARTWORK_PATH = new RegExp(
  String.raw`^/api/(?:albums/\d+/cover|albums/by-entity/${SEGMENT}/cover|catalog/albums/${SEGMENT}/cover|artists/\d+/(?:photo|background)|artists/by-entity/${SEGMENT}/(?:photo|background)|catalog/artists/${SEGMENT}/(?:photo|background))$`,
);

let activeProfile: ActiveNativeDeviceProfile | null = null;

export function setActiveNativeDeviceProfile(
  profile: ActiveNativeDeviceProfile | null,
): void {
  activeProfile = profile;
}

export function getActiveNativeDeviceProfile(): ActiveNativeDeviceProfile | null {
  return activeProfile;
}

export function deviceTokenCoversPath(
  path: string,
  kind: "stream" | "artwork",
): boolean {
  return (kind === "stream" ? DEVICE_STREAM_PATH : DEVICE_ARTWORK_PATH).test(
    path,
  );
}

/**
 * Whether the native service authorizes `url` with the device token, so the
 * engine track can go without the session bearer.
 */
export function nativeDeviceTokenAuthorizes(
  url: string,
  kind: "stream" | "artwork",
  nowMs: number = Date.now(),
): boolean {
  const profile = activeProfile;
  if (!profile) return false;
  if (profile.expiresAtMs - NATIVE_DEVICE_TOKEN_MARGIN_MS <= nowMs) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === profile.origin &&
      deviceTokenCoversPath(parsed.pathname, kind)
    );
  } catch {
    return false;
  }
}
