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
        : persistOAuthCallbackPayload(parsed.searchParams);
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
