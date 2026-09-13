import { ApiError } from "../../../shared/web/api";
import { apiForServer, setAuthTokens, setAuthTokensForServer } from "@/lib/api";
import {
  getSecureSessionValue,
  removeSecureSessionValue,
  setSecureSessionValue,
} from "@/lib/native-secure-session";
import { isTauriRuntime } from "@/lib/platform";
import {
  getCurrentServerId,
  getServers,
  setCurrentServerId,
  waitForPendingSecureSessionWrites,
} from "@/lib/server-store";

const OAUTH_NEXT_KEY = "crate-oauth-next";
const NATIVE_OAUTH_PENDING_CALLBACK_KEY = "crate.oauth.pending-callback";
const NATIVE_CALLBACK_URL = "cratemusic://oauth/callback";
const OAUTH_RECORD_MAX_AGE_MS = 15 * 60 * 1000;
const activeOAuthStates = new Set<string>();

type OAuthProvider = "google" | "apple";

interface NativeOAuthRecord {
  verifier: string;
  next: string;
  createdAt: number;
  serverId: string;
}

interface NativeOAuthLoginResponse {
  token?: string;
  refresh_token?: string | null;
  access_expires_at?: string | null;
}

interface OAuthCallbackResult {
  handled: boolean;
  next: string;
  retryable?: true;
}

interface NativeOAuthPendingCallback {
  code: string;
  state: string;
  createdAt: number;
}

interface NativeOAuthPendingCallbacks {
  version: 1;
  callbacks: NativeOAuthPendingCallback[];
}

let pendingCallbackMutation: Promise<void> = Promise.resolve();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeForVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

function oauthRecordKey(state: string): string {
  return `crate.oauth.${state}`;
}

// Mobile (Capacitor) has an OS-backed Keychain/Keystore secure session
// plugin; Tauri desktop doesn't, so the PKCE verifier record for desktop
// lives in localStorage instead — the same trust tier the desktop app
// already uses elsewhere (e.g. the pending-next redirect below). Both
// platforms otherwise share the exact same PKCE + one-time-code exchange
// flow, since Tauri already registers the `cratemusic://` scheme as an
// OS-level deep link, same as mobile.
async function writeNativeOAuthRecord(
  key: string,
  value: string,
): Promise<void> {
  if (isTauriRuntime) {
    localStorage.setItem(key, value);
    return;
  }
  await setSecureSessionValue(key, value);
}

async function readNativeOAuthRecord(key: string): Promise<string | null> {
  if (isTauriRuntime) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return getSecureSessionValue(key);
}

async function removeNativeOAuthRecord(key: string): Promise<void> {
  if (isTauriRuntime) {
    try {
      localStorage.removeItem(key);
    } catch {
      // best-effort
    }
    return;
  }
  await removeSecureSessionValue(key).catch(() => {});
}

function parsePendingNativeOAuthCallbacks(
  raw: string | null,
): NativeOAuthPendingCallback[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<
      NativeOAuthPendingCallbacks & NativeOAuthPendingCallback
    >;
    const candidates = Array.isArray(parsed.callbacks)
      ? parsed.callbacks
      : [parsed];
    return candidates.flatMap((candidate) => {
      if (
        typeof candidate?.code !== "string" ||
        !candidate.code ||
        typeof candidate.state !== "string" ||
        !candidate.state
      ) {
        return [];
      }
      return [
        {
          code: candidate.code,
          state: candidate.state,
          createdAt:
            typeof candidate.createdAt === "number"
              ? candidate.createdAt
              : Date.now(),
        },
      ];
    });
  } catch {
    return [];
  }
}

function mutatePendingNativeOAuthCallbacks(
  mutate: (
    callbacks: NativeOAuthPendingCallback[],
  ) => NativeOAuthPendingCallback[],
): Promise<void> {
  const operation = pendingCallbackMutation.then(async () => {
    const raw = await readNativeOAuthRecord(NATIVE_OAUTH_PENDING_CALLBACK_KEY);
    const callbacks = mutate(parsePendingNativeOAuthCallbacks(raw));
    if (callbacks.length === 0) {
      await removeNativeOAuthRecord(NATIVE_OAUTH_PENDING_CALLBACK_KEY);
      return;
    }
    const pending: NativeOAuthPendingCallbacks = {
      version: 1,
      callbacks,
    };
    await writeNativeOAuthRecord(
      NATIVE_OAUTH_PENDING_CALLBACK_KEY,
      JSON.stringify(pending),
    );
  });
  pendingCallbackMutation = operation.catch(() => {});
  return operation;
}

async function writePendingNativeOAuthCallback(
  callback: NativeOAuthPendingCallback,
): Promise<void> {
  await mutatePendingNativeOAuthCallbacks((callbacks) => [
    ...callbacks.filter((entry) => entry.state !== callback.state),
    callback,
  ]);
}

async function removePendingNativeOAuthCallback(state: string): Promise<void> {
  await mutatePendingNativeOAuthCallbacks((callbacks) =>
    callbacks.filter((callback) => callback.state !== state),
  );
}

export async function beginNativeOAuth(
  provider: OAuthProvider,
  next = "/",
  inviteToken?: string,
): Promise<string> {
  const verifier = randomBase64Url(64);
  const state = randomBase64Url(32);
  const challenge = await challengeForVerifier(verifier);
  const serverId = getCurrentServerId();
  if (!serverId || !getServers().some((server) => server.id === serverId)) {
    throw new Error("Select a Crate server before signing in");
  }
  const record: NativeOAuthRecord = {
    verifier,
    next: next || "/",
    createdAt: Date.now(),
    // The system browser can stay open for minutes; if the user switches
    // the "current server" in the meantime, a token minted for the server
    // this flow started against must not land on whatever server happens
    // to be current when the callback finally arrives.
    serverId,
  };
  const recordKey = oauthRecordKey(state);
  await writeNativeOAuthRecord(recordKey, JSON.stringify(record));
  try {
    const response = await apiForServer<{
      provider: string;
      login_url: string;
    }>(serverId, `/api/auth/oauth/${provider}/start`, "POST", {
      return_to: NATIVE_CALLBACK_URL,
      invite_token: inviteToken,
      native_code_challenge: challenge,
      native_state: state,
    });
    return response.login_url;
  } catch (error) {
    await removeNativeOAuthRecord(recordKey);
    throw error;
  }
}

function storePendingOAuthNext(next: string): void {
  try {
    localStorage.setItem(OAUTH_NEXT_KEY, next || "/");
  } catch {
    // Ignore storage failures; the token is still persisted separately.
  }
}

export function consumePendingOAuthNext(): string | null {
  try {
    const next = localStorage.getItem(OAUTH_NEXT_KEY);
    if (next) localStorage.removeItem(OAUTH_NEXT_KEY);
    return next;
  } catch {
    return null;
  }
}

export function clearPendingOAuthNext(): void {
  try {
    localStorage.removeItem(OAUTH_NEXT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function getOAuthCallbackPayload(search: string | URLSearchParams): {
  token: string | null;
  refreshToken: string | null;
  accessExpiresAt: string | null;
  next: string;
} {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    token: params.get("token"),
    refreshToken: params.get("refresh_token"),
    accessExpiresAt: params.get("access_expires_at"),
    next: params.get("next") || "/",
  };
}

export function persistOAuthCallbackPayload(search: string | URLSearchParams): {
  handled: boolean;
  next: string;
} {
  const { token, refreshToken, accessExpiresAt, next } =
    getOAuthCallbackPayload(search);
  if (!token) {
    return { handled: false, next };
  }

  setAuthTokens(token, refreshToken ?? undefined, accessExpiresAt ?? undefined);
  storePendingOAuthNext(next);
  return { handled: true, next };
}

export async function consumeOAuthCallbackUrl(
  url: string,
): Promise<OAuthCallbackResult> {
  try {
    const parsed = new URL(url);
    const isCustomSchemeCallback =
      parsed.protocol === "cratemusic:" &&
      parsed.hostname === "oauth" &&
      parsed.pathname === "/callback";

    if (!isCustomSchemeCallback) {
      return { handled: false, next: "/" };
    }

    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");
    if (!code || !state) {
      return { handled: false, next: "/" };
    }
    await writePendingNativeOAuthCallback({
      code,
      state,
      createdAt: Date.now(),
    });
    const result = await exchangeNativeOAuthCallback(code, state);
    if (!result.handled) {
      return result;
    }
    void import("@capacitor/browser")
      .then(({ Browser }) => Browser.close().catch(() => {}))
      .catch(() => {});

    return result;
  } catch {
    return { handled: false, next: "/" };
  }
}

export async function retryPendingNativeOAuthCallback(): Promise<OAuthCallbackResult> {
  try {
    await pendingCallbackMutation;
    const raw = await readNativeOAuthRecord(NATIVE_OAUTH_PENDING_CALLBACK_KEY);
    if (!raw) return { handled: false, next: "/" };
    const pendingCallbacks = parsePendingNativeOAuthCallbacks(raw).sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    if (pendingCallbacks.length === 0) {
      await removeNativeOAuthRecord(NATIVE_OAUTH_PENDING_CALLBACK_KEY);
      return { handled: false, next: "/" };
    }
    for (const pending of pendingCallbacks) {
      const result = await exchangeNativeOAuthCallback(
        pending.code,
        pending.state,
      );
      if (result.handled || result.retryable) return result;
    }
    return { handled: false, next: "/" };
  } catch {
    return { handled: false, next: "/" };
  }
}

async function exchangeNativeOAuthCallback(
  code: string,
  state: string,
): Promise<OAuthCallbackResult> {
  if (activeOAuthStates.has(state)) {
    return { handled: false, next: "/" };
  }
  activeOAuthStates.add(state);
  const recordKey = oauthRecordKey(state);
  let exchangeCompleted = false;
  let removeRecord = true;
  try {
    const raw = await readNativeOAuthRecord(recordKey);
    if (!raw) return { handled: false, next: "/" };
    const record = JSON.parse(raw) as Partial<NativeOAuthRecord>;
    if (
      typeof record.verifier !== "string" ||
      typeof record.next !== "string" ||
      typeof record.serverId !== "string" ||
      typeof record.createdAt !== "number" ||
      Date.now() - record.createdAt > OAUTH_RECORD_MAX_AGE_MS
    ) {
      return { handled: false, next: "/" };
    }
    if (!getServers().some((server) => server.id === record.serverId)) {
      return { handled: false, next: "/" };
    }
    const response = await apiForServer<NativeOAuthLoginResponse>(
      record.serverId,
      "/api/auth/native/exchange",
      "POST",
      {
        code,
        code_verifier: record.verifier,
        state,
      },
    );
    if (!response.token) return { handled: false, next: "/" };
    const stored = setAuthTokensForServer(
      record.serverId,
      response.token,
      response.refresh_token ?? undefined,
      response.access_expires_at ?? undefined,
    );
    if (!stored) return { handled: false, next: "/" };
    try {
      await waitForPendingSecureSessionWrites();
    } catch (error) {
      setAuthTokensForServer(record.serverId, null, null, null);
      throw error;
    }
    exchangeCompleted = true;
    if (!getServers().some((server) => server.id === record.serverId)) {
      return { handled: false, next: "/" };
    }
    setCurrentServerId(record.serverId);
    storePendingOAuthNext(record.next);
    return { handled: true, next: record.next };
  } catch (error) {
    if (!exchangeCompleted && isRetryableOAuthExchangeError(error)) {
      removeRecord = false;
      return { handled: false, next: "/", retryable: true };
    }
    return { handled: false, next: "/" };
  } finally {
    try {
      if (removeRecord) {
        await Promise.allSettled([
          removeNativeOAuthRecord(recordKey),
          removePendingNativeOAuthCallback(state),
        ]);
      }
    } finally {
      activeOAuthStates.delete(state);
    }
  }
}

function isRetryableOAuthExchangeError(error: unknown): boolean {
  if (error instanceof SyntaxError) return false;
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500 || [408, 425, 429].includes(error.status);
}
