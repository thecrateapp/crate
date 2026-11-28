/**
 * The Android device profile (Android Auto phase AA2, D2/D7).
 *
 * After sign-in, session restore and server switch, JS mints a native device
 * token (`POST /api/auth/device-tokens`) and hands it, with the server and
 * the listener's delivery and offline choices, to `CrateDevicePlugin`. The
 * native playback service then streams and (later) browses without the
 * WebView. The token itself never comes back to JS: `getStatus` returns
 * everything but the secret.
 *
 * Only the Android Capacitor runtime has the plugin; every entry point is a
 * no-op on web, iOS and Tauri. Servers older than AA2 answer 404/405 and the
 * app keeps the session bearer on its tracks.
 */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { api } from "@/lib/api";
import { isAndroidNative } from "@/lib/capacitor-runtime";
import {
  setActiveNativeDeviceProfile,
  type ActiveNativeDeviceProfile,
} from "@/lib/native-device-authorization";
import { getActiveOfflineProfileKey } from "@/lib/offline-storage";
import { isCapacitorRuntime } from "@/lib/platform";
import {
  getPlaybackDeliveryPolicyPreference,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import {
  getCurrentServer,
  getServerById,
  type ServerConfig,
} from "@/lib/server-store";
import { ApiError } from "../../../shared/web/api";

export interface NativeDeviceProfileStatus {
  hasProfile: boolean;
  serverId?: string;
  serverUrl?: string;
  tokenId?: number;
  expiresAtMs?: number;
  deliveryPolicy?: PlaybackDeliveryPreference;
  offlineProfileKey?: string;
  deviceId?: string;
  /** Set on `profileChanged` when native code cleared the profile. */
  reason?: "unauthorized" | "cleared";
}

interface NativeDeviceProfileInput {
  serverUrl: string;
  serverId: string;
  deviceToken: string;
  tokenId: number;
  expiresAtMs: number;
  deliveryPolicy: PlaybackDeliveryPreference;
  offlineProfileKey: string | null;
  deviceId: string;
}

interface CrateDevicePlugin {
  setProfile(
    options: NativeDeviceProfileInput,
  ): Promise<NativeDeviceProfileStatus>;
  updateProfile(options: {
    deliveryPolicy: PlaybackDeliveryPreference;
    offlineProfileKey: string | null;
  }): Promise<NativeDeviceProfileStatus>;
  clearProfile(): Promise<NativeDeviceProfileStatus>;
  getStatus(): Promise<NativeDeviceProfileStatus>;
  addListener(
    eventName: "profileChanged",
    listener: (status: NativeDeviceProfileStatus) => void,
  ): Promise<PluginListenerHandle>;
}

interface DeviceTokenCreated {
  id: number;
  token: string;
  device_id: string;
  label: string;
  created_at: string;
  expires_at: string;
}

interface DeviceTokenListItem {
  id: number;
  current_session?: boolean;
}

export type NativeDeviceSyncResult =
  "inactive" | "active" | "minted" | "unsupported" | "unauthorized" | "failed";

const CrateDevice = registerPlugin<CrateDevicePlugin>("CrateDevice");

export const NATIVE_DEVICE_ID_KEY = "crate-native-device-id";
/** Mint a new token when the stored one expires within this window. */
export const NATIVE_DEVICE_REMINT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A token the service reports as rejected is re-minted at most this often. */
export const NATIVE_DEVICE_FORCED_REMINT_INTERVAL_MS = 60 * 1000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const DEVICE_TOKENS_PATH = "/api/auth/device-tokens";
const REVOKE_TIMEOUT_MS = 5_000;

let knownStatus: NativeDeviceProfileStatus | null = null;
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();
let lastForcedRemintAt = Number.NEGATIVE_INFINITY;
const unsupportedServers = new Set<string>();

export function isNativeDeviceProfileRuntime(): boolean {
  return isCapacitorRuntime && isAndroidNative;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function trimServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function randomDeviceId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** The random per-install device id, reused across sign-ins. */
export function getOrCreateNativeDeviceId(): string {
  try {
    const stored = localStorage.getItem(NATIVE_DEVICE_ID_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) return stored;
  } catch {
    // fall through to a new id
  }
  const created = randomDeviceId();
  try {
    localStorage.setItem(NATIVE_DEVICE_ID_KEY, created);
  } catch {
    // An unpersisted id only means the next mint names a new device.
  }
  return created;
}

/** "Android: <model>" from the WebView user agent, when it names one. */
export function nativeDeviceLabel(
  userAgent: string = typeof navigator === "undefined"
    ? ""
    : navigator.userAgent || "",
): string {
  const match = /Android\s[\d.]+;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\s*[;)]/.exec(
    userAgent,
  );
  const model = match?.[1]?.trim() ?? "";
  // Reduced user agents report the model as "K".
  if (!model || model === "K" || /^wv$/i.test(model)) return "Android";
  return `Android: ${model}`.slice(0, 80);
}

function currentPreferences() {
  return {
    deliveryPolicy: getPlaybackDeliveryPolicyPreference(),
    offlineProfileKey: getActiveOfflineProfileKey(),
  };
}

function remember(status: NativeDeviceProfileStatus): void {
  knownStatus = status;
  const origin = status.serverUrl ? originOf(status.serverUrl) : null;
  const active: ActiveNativeDeviceProfile | null =
    status.hasProfile &&
    status.serverId &&
    origin &&
    typeof status.tokenId === "number" &&
    typeof status.expiresAtMs === "number" &&
    status.expiresAtMs > Date.now()
      ? {
          serverId: status.serverId,
          origin,
          tokenId: status.tokenId,
          expiresAtMs: status.expiresAtMs,
        }
      : null;
  setActiveNativeDeviceProfile(active);
}

function forget(): void {
  knownStatus = { hasProfile: false };
  setActiveNativeDeviceProfile(null);
}

async function readStatus(): Promise<NativeDeviceProfileStatus> {
  try {
    return await CrateDevice.getStatus();
  } catch {
    return { hasProfile: false };
  }
}

function isUnsupportedError(error: unknown): boolean {
  return error instanceof ApiError && [404, 405].includes(error.status);
}

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && [401, 403].includes(error.status);
}

/**
 * Best-effort revocation on the server that minted the token, with that
 * server's session. Starts the request synchronously so logout can fire it
 * before the session itself is revoked.
 */
function revokeDeviceToken(
  serverId: string | undefined,
  tokenId: number | undefined,
): Promise<void> {
  const server: ServerConfig | null = serverId ? getServerById(serverId) : null;
  if (!server?.token || typeof tokenId !== "number") return Promise.resolve();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVOKE_TIMEOUT_MS);
  return fetch(`${trimServerUrl(server.url)}${DEVICE_TOKENS_PATH}/${tokenId}`, {
    method: "DELETE",
    credentials: "omit",
    headers: { Authorization: `Bearer ${server.token}` },
    signal: controller.signal,
  })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => clearTimeout(timeout));
}

async function clearNative(): Promise<void> {
  forget();
  await CrateDevice.clearProfile().catch(() => undefined);
}

/**
 * Brings the native profile in line with the current server and session:
 * mints when there is none, it belongs to another server, it expires within
 * 24 h, `force` is set, or (with `verify`) the server no longer lists it.
 */
export function syncNativeDeviceProfile(
  options: { verify?: boolean; force?: boolean } = {},
): Promise<NativeDeviceSyncResult> {
  if (!isNativeDeviceProfileRuntime()) return Promise.resolve("inactive");
  const startedAt = generation;
  return enqueue(() => runSync(options, startedAt));
}

async function runSync(
  options: { verify?: boolean; force?: boolean },
  startedAt: number,
): Promise<NativeDeviceSyncResult> {
  const stale = () => startedAt !== generation;
  const server = getCurrentServer();
  if (stale() || !server?.token) return "inactive";
  if (unsupportedServers.has(server.id)) return "unsupported";

  let status = await readStatus();
  if (stale()) return "inactive";
  if (
    status.hasProfile &&
    (status.serverId !== server.id ||
      trimServerUrl(status.serverUrl ?? "") !== trimServerUrl(server.url))
  ) {
    void revokeDeviceToken(status.serverId, status.tokenId);
    await clearNative();
    status = { hasProfile: false };
  }

  const now = Date.now();
  let mint =
    Boolean(options.force) ||
    !status.hasProfile ||
    typeof status.expiresAtMs !== "number" ||
    status.expiresAtMs - now < NATIVE_DEVICE_REMINT_WINDOW_MS;

  if (!mint && options.verify) {
    try {
      const tokens = await api<DeviceTokenListItem[]>(DEVICE_TOKENS_PATH);
      mint = !tokens.some(
        (token) =>
          token.id === status.tokenId && token.current_session !== false,
      );
    } catch (error) {
      if (isUnsupportedError(error)) {
        unsupportedServers.add(server.id);
        await clearNative();
        return "unsupported";
      }
      mint = isAuthError(error);
    }
    if (stale()) return "inactive";
  }

  if (!mint) {
    const preferences = currentPreferences();
    if (
      status.deliveryPolicy !== preferences.deliveryPolicy ||
      (status.offlineProfileKey ?? null) !== preferences.offlineProfileKey
    ) {
      status = await CrateDevice.updateProfile(preferences).catch(() => status);
      if (stale()) return "inactive";
    }
    remember(status);
    return "active";
  }
  return mintProfile(server, status, stale);
}

async function mintProfile(
  server: ServerConfig,
  previous: NativeDeviceProfileStatus,
  stale: () => boolean,
): Promise<NativeDeviceSyncResult> {
  const deviceId = getOrCreateNativeDeviceId();
  let created: DeviceTokenCreated;
  try {
    created = await api<DeviceTokenCreated>(DEVICE_TOKENS_PATH, "POST", {
      device_id: deviceId,
      label: nativeDeviceLabel(),
    });
  } catch (error) {
    if (stale()) return "inactive";
    if (isUnsupportedError(error)) {
      unsupportedServers.add(server.id);
      await clearNative();
      return "unsupported";
    }
    if (isAuthError(error)) {
      await clearNative();
      return "unauthorized";
    }
    // Keep a stored profile that still works; the next sync tries again.
    if (previous.hasProfile) remember(previous);
    return "failed";
  }

  const expiresAtMs = Date.parse(created.expires_at);
  const current = getCurrentServer();
  if (
    stale() ||
    current?.id !== server.id ||
    !current.token ||
    !Number.isFinite(expiresAtMs)
  ) {
    void revokeDeviceToken(server.id, created.id);
    return stale() ? "inactive" : "failed";
  }

  try {
    const status = await CrateDevice.setProfile({
      serverUrl: trimServerUrl(server.url),
      serverId: server.id,
      deviceToken: created.token,
      tokenId: created.id,
      expiresAtMs,
      deviceId,
      ...currentPreferences(),
    });
    if (stale()) {
      void revokeDeviceToken(server.id, created.id);
      await clearNative();
      return "inactive";
    }
    remember(status);
    return "minted";
  } catch {
    void revokeDeviceToken(server.id, created.id);
    forget();
    return "failed";
  }
}

/** Pushes the current delivery preference and offline profile key. */
export function updateNativeDeviceProfilePreferences(): Promise<void> {
  if (!isNativeDeviceProfileRuntime()) return Promise.resolve();
  const startedAt = generation;
  return enqueue(async () => {
    if (startedAt !== generation || !knownStatus?.hasProfile) return;
    try {
      const status = await CrateDevice.updateProfile(currentPreferences());
      if (startedAt === generation) remember(status);
    } catch {
      // The next sync retries.
    }
  });
}

/**
 * Logout, server switch away or a rejected session: revokes the device token
 * on its server (best effort, with that server's session) and clears the
 * native profile. Call it before the session itself is revoked.
 */
export function retireNativeDeviceProfile(): Promise<void> {
  if (!isNativeDeviceProfileRuntime()) return Promise.resolve();
  generation += 1;
  const cached = knownStatus;
  const revocation = cached?.hasProfile
    ? revokeDeviceToken(cached.serverId, cached.tokenId)
    : null;
  forget();
  return enqueue(async () => {
    if (!revocation) {
      const status = await readStatus();
      if (status.hasProfile) {
        void revokeDeviceToken(status.serverId, status.tokenId);
      }
    }
    await clearNative();
    await revocation;
  });
}

/**
 * Native code cleared the profile. The mirror is dropped at once, so tracks
 * built from now on carry the session bearer again (D7 fallback). When the
 * service saw the device token refused (revoked from another client, or the
 * Devices settings, while the session lives on), JS asks the server for a new
 * token instead of trusting native state, at most once a minute; the service
 * reads the store per request, so retries pick the new token up.
 */
export function handleNativeDeviceProfileChange(
  status: NativeDeviceProfileStatus,
): Promise<NativeDeviceSyncResult> {
  if (!isNativeDeviceProfileRuntime()) return Promise.resolve("inactive");
  if (status.hasProfile) {
    remember(status);
    return Promise.resolve("active");
  }
  forget();
  if (status.reason !== "unauthorized") return Promise.resolve("inactive");
  const now = Date.now();
  if (now - lastForcedRemintAt < NATIVE_DEVICE_FORCED_REMINT_INTERVAL_MS) {
    return Promise.resolve("inactive");
  }
  lastForcedRemintAt = now;
  return syncNativeDeviceProfile({ force: true, verify: true });
}

export function subscribeNativeDeviceProfileChanges(
  listener: (status: NativeDeviceProfileStatus) => void,
): () => void {
  if (!isNativeDeviceProfileRuntime()) return () => {};
  let removed = false;
  const handle = CrateDevice.addListener("profileChanged", listener).catch(
    () => null,
  );
  return () => {
    if (removed) return;
    removed = true;
    void handle.then((listenerHandle) => listenerHandle?.remove());
  };
}

/** Test-only reset of the module state. */
export function resetNativeDeviceProfileForTests(): void {
  knownStatus = null;
  generation = 0;
  queue = Promise.resolve();
  lastForcedRemintAt = Number.NEGATIVE_INFINITY;
  unsupportedServers.clear();
  setActiveNativeDeviceProfile(null);
}
