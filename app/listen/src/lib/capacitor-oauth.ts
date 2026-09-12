import { api, setAuthTokens } from "@/lib/api";
import {
  getSecureSessionValue,
  removeSecureSessionValue,
  setSecureSessionValue,
} from "@/lib/native-secure-session";
import { waitForPendingSecureSessionWrites } from "@/lib/server-store";

const OAUTH_NEXT_KEY = "crate-oauth-next";
const NATIVE_CALLBACK_URL = "cratemusic://oauth/callback";
const OAUTH_RECORD_MAX_AGE_MS = 15 * 60 * 1000;
const DESKTOP_HANDOFF_KEY_PREFIX = "crate-oauth-desktop-state:";

interface DesktopOAuthHandoffRecord {
  next: string;
  createdAt: number;
}

type OAuthProvider = "google" | "apple";

interface NativeOAuthRecord {
  verifier: string;
  next: string;
  createdAt: number;
}

interface NativeOAuthLoginResponse {
  token?: string;
  refresh_token?: string | null;
  access_expires_at?: string | null;
}

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

export async function beginNativeOAuth(
  provider: OAuthProvider,
  next = "/",
  inviteToken?: string,
): Promise<string> {
  const verifier = randomBase64Url(64);
  const state = randomBase64Url(32);
  const challenge = await challengeForVerifier(verifier);
  const record: NativeOAuthRecord = {
    verifier,
    next: next || "/",
    createdAt: Date.now(),
  };
  const recordKey = oauthRecordKey(state);
  await setSecureSessionValue(recordKey, JSON.stringify(record));
  try {
    const response = await api<{ provider: string; login_url: string }>(
      `/api/auth/oauth/${provider}/start`,
      "POST",
      {
        return_to: NATIVE_CALLBACK_URL,
        invite_token: inviteToken,
        native_code_challenge: challenge,
        native_state: state,
      },
    );
    return response.login_url;
  } catch (error) {
    await removeSecureSessionValue(recordKey).catch(() => {});
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

/**
 * The desktop (Tauri) OAuth flow can't do the mobile PKCE dance — it opens
 * the system browser and relays the resulting token back through a local
 * loopback server into the `cratemusic://` deep link. That link has no
 * origin check: any other app or a webpage can invoke the same custom URL
 * scheme with an arbitrary `token`, and prior to this nonce there was
 * nothing distinguishing our own login from an attacker's crafted one
 * (login CSRF / session fixation). We generate this nonce before opening
 * the browser and require it to come back unchanged.
 */
export function beginDesktopOAuthHandoff(next: string): string {
  const state = randomBase64Url(32);
  const record: DesktopOAuthHandoffRecord = {
    next: next || "/",
    createdAt: Date.now(),
  };
  try {
    localStorage.setItem(
      DESKTOP_HANDOFF_KEY_PREFIX + state,
      JSON.stringify(record),
    );
  } catch {
    // If storage is unavailable, consumeDesktopOAuthHandoff will simply
    // find no matching record later and fail closed.
  }
  return state;
}

function consumeDesktopOAuthHandoff(
  state: string,
): DesktopOAuthHandoffRecord | null {
  const key = DESKTOP_HANDOFF_KEY_PREFIX + state;
  try {
    const raw = localStorage.getItem(key);
    localStorage.removeItem(key);
    if (!raw) return null;
    const record = JSON.parse(raw) as Partial<DesktopOAuthHandoffRecord>;
    if (
      typeof record.next !== "string" ||
      typeof record.createdAt !== "number" ||
      Date.now() - record.createdAt > OAUTH_RECORD_MAX_AGE_MS
    ) {
      return null;
    }
    return record as DesktopOAuthHandoffRecord;
  } catch {
    return null;
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

function consumeDesktopTokenHandoff(params: URLSearchParams): {
  handled: boolean;
  next: string;
} {
  const state = params.get("state");
  if (!state) return { handled: false, next: "/" };

  const record = consumeDesktopOAuthHandoff(state);
  if (!record) return { handled: false, next: "/" };

  const result = persistOAuthCallbackPayload(params);
  if (!result.handled) return result;

  // Trust our own stored destination, not whatever `next` the URL itself
  // carries, as a second layer of defense.
  storePendingOAuthNext(record.next);
  return { handled: true, next: record.next };
}

export async function consumeOAuthCallbackUrl(
  url: string,
): Promise<{ handled: boolean; next: string }> {
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
    const result =
      code && state
        ? await exchangeNativeOAuthCallback(code, state)
        : consumeDesktopTokenHandoff(parsed.searchParams);
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

async function exchangeNativeOAuthCallback(
  code: string,
  state: string,
): Promise<{ handled: boolean; next: string }> {
  const recordKey = oauthRecordKey(state);
  try {
    const raw = await getSecureSessionValue(recordKey);
    if (!raw) return { handled: false, next: "/" };
    const record = JSON.parse(raw) as Partial<NativeOAuthRecord>;
    if (
      typeof record.verifier !== "string" ||
      typeof record.next !== "string" ||
      typeof record.createdAt !== "number" ||
      Date.now() - record.createdAt > OAUTH_RECORD_MAX_AGE_MS
    ) {
      return { handled: false, next: "/" };
    }
    const response = await api<NativeOAuthLoginResponse>(
      "/api/auth/native/exchange",
      "POST",
      {
        code,
        code_verifier: record.verifier,
        state,
      },
    );
    if (!response.token) return { handled: false, next: "/" };
    setAuthTokens(
      response.token,
      response.refresh_token ?? undefined,
      response.access_expires_at ?? undefined,
    );
    try {
      await waitForPendingSecureSessionWrites();
    } catch (error) {
      setAuthTokens(null, null, null);
      throw error;
    }
    storePendingOAuthNext(record.next);
    return { handled: true, next: record.next };
  } catch {
    return { handled: false, next: "/" };
  } finally {
    await removeSecureSessionValue(recordKey).catch(() => {});
  }
}
