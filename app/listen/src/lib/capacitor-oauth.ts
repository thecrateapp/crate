import { ApiError } from "../../../shared/web/api";
import {
  api,
  apiForServer,
  setAuthTokens,
  setAuthTokensForServer,
} from "@/lib/api";
import { AUTH_TOKEN_EVENT } from "@/lib/auth-session";
import { openExternalUrl } from "@/lib/external-links";
import {
  getSecureSessionValue,
  removeSecureSessionValue,
  setSecureSessionValue,
} from "@/lib/native-secure-session";
import { isTauriRuntime } from "@/lib/platform";
import {
  SERVER_STORE_EVENT,
  getCurrentServerId,
  getServers,
  setCurrentServerId,
  waitForPendingSecureSessionWrites,
} from "@/lib/server-store";

const OAUTH_NEXT_KEY = "crate-oauth-next";
const NATIVE_OAUTH_PENDING_CALLBACK_KEY = "crate.oauth.pending-callback";
const NATIVE_OAUTH_LINK_PENDING_CALLBACK_KEY =
  "crate.oauth.link.pending-callback";
const NATIVE_OAUTH_LINK_GENERATION_KEY = "crate.oauth.link.generation";
const NATIVE_CALLBACK_URL = "cratemusic://oauth/callback";
const OAUTH_RECORD_MAX_AGE_MS = 15 * 60 * 1000;
const NATIVE_LINK_VALUE_RE = /^[A-Za-z0-9_-]{16,256}$/;
const NATIVE_LINK_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const activeOAuthStates = new Set<string>();
const activeNativeOAuthLinkStates = new Set<string>();

type OAuthProvider = "google" | "apple";

interface NativeOAuthRecord {
  verifier: string;
  next: string;
  createdAt: number;
  serverId: string;
}

interface NativeOAuthLinkRecord {
  verifier: string;
  createdAt: number;
  serverId: string;
  userId: number;
  sessionId: string;
  generation: number;
  provider: OAuthProvider;
}

export interface NativeOAuthLinkIdentity {
  serverId: string;
  userId: number;
  sessionId: string;
  generation: number;
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
  cancelled?: true;
  operation?: "link";
  provider?: OAuthProvider;
  userId?: number;
  error?: true;
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

function decodeOAuthSession(token: string | null): {
  userId: number;
  sessionId: string;
} | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const decoded = JSON.parse(atob(padded)) as {
      user_id?: unknown;
      sid?: unknown;
    };
    const userId = Number(decoded.user_id);
    if (
      !Number.isSafeInteger(userId) ||
      typeof decoded.sid !== "string" ||
      !decoded.sid
    ) {
      return null;
    }
    return { userId, sessionId: decoded.sid };
  } catch {
    return null;
  }
}

function readCurrentOAuthIdentity(): string {
  const serverId = getCurrentServerId();
  const server = getServers().find((item) => item.id === serverId);
  const session = decodeOAuthSession(server?.token ?? null);
  return session && serverId
    ? JSON.stringify([serverId, session.userId, session.sessionId])
    : "";
}

function readOAuthLinkGeneration(): number {
  try {
    const value = Number(
      localStorage.getItem(NATIVE_OAUTH_LINK_GENERATION_KEY),
    );
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function observeOAuthIdentityChange(): void {
  const current = readCurrentOAuthIdentity();
  if (current === observedOAuthIdentity) return;
  observedOAuthIdentity = current;
  try {
    localStorage.setItem(
      NATIVE_OAUTH_LINK_GENERATION_KEY,
      String(readOAuthLinkGeneration() + 1),
    );
  } catch {
    // A missing generation record still cannot bypass user/session checks.
  }
}

let observedOAuthIdentity = readCurrentOAuthIdentity();

if (typeof window !== "undefined") {
  window.addEventListener(AUTH_TOKEN_EVENT, observeOAuthIdentityChange);
  window.addEventListener(SERVER_STORE_EVENT, observeOAuthIdentityChange);
}

export function captureNativeOAuthLinkIdentity(
  userId?: number,
): NativeOAuthLinkIdentity | null {
  observeOAuthIdentityChange();
  const serverId = getCurrentServerId();
  const server = getServers().find((item) => item.id === serverId);
  const session = decodeOAuthSession(server?.token ?? null);
  if (
    !serverId ||
    !session ||
    (userId !== undefined && session.userId !== userId)
  ) {
    return null;
  }
  return {
    serverId,
    userId: session.userId,
    sessionId: session.sessionId,
    generation: readOAuthLinkGeneration(),
  };
}

export function isCurrentNativeOAuthLinkIdentity(
  identity: NativeOAuthLinkIdentity,
): boolean {
  observeOAuthIdentityChange();
  const current = captureNativeOAuthLinkIdentity();
  return (
    current?.serverId === identity.serverId &&
    current.userId === identity.userId &&
    current.sessionId === identity.sessionId &&
    current.generation === identity.generation
  );
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

async function writeNativeOAuthRecord(
  key: string,
  value: string,
): Promise<void> {
  await setSecureSessionValue(key, value);
}

async function readNativeOAuthRecord(key: string): Promise<string | null> {
  return getSecureSessionValue(key);
}

async function removeNativeOAuthRecord(key: string): Promise<void> {
  await removeSecureSessionValue(key);
}

export async function migrateLegacyTauriOAuthRecords(): Promise<void> {
  if (!isTauriRuntime) return;
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index),
    ).filter(
      (key): key is string =>
        key !== null &&
        key.startsWith("crate.oauth.") &&
        key !== NATIVE_OAUTH_LINK_GENERATION_KEY,
    );

    for (const key of keys) {
      const legacyValue = localStorage.getItem(key);
      if (legacyValue === null) continue;
      const secureValue = await getSecureSessionValue(key);
      if (secureValue !== null) {
        JSON.parse(secureValue);
      } else {
        JSON.parse(legacyValue);
        await setSecureSessionValue(key, legacyValue);
        const verified = await getSecureSessionValue(key);
        if (verified !== legacyValue) {
          throw new Error("Secure OAuth migration verification failed");
        }
      }
      localStorage.removeItem(key);
    }
  } catch (error) {
    const wrapped = new Error("Native OAuth migration failed");
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
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
  storageKey = NATIVE_OAUTH_PENDING_CALLBACK_KEY,
): Promise<void> {
  const operation = pendingCallbackMutation.then(async () => {
    const raw = await readNativeOAuthRecord(storageKey);
    const callbacks = mutate(parsePendingNativeOAuthCallbacks(raw));
    if (callbacks.length === 0) {
      await removeNativeOAuthRecord(storageKey);
      return;
    }
    const pending: NativeOAuthPendingCallbacks = {
      version: 1,
      callbacks,
    };
    await writeNativeOAuthRecord(storageKey, JSON.stringify(pending));
  });
  pendingCallbackMutation = operation.catch(() => {});
  return operation;
}

async function writePendingNativeOAuthCallback(
  callback: NativeOAuthPendingCallback,
  storageKey = NATIVE_OAUTH_PENDING_CALLBACK_KEY,
): Promise<void> {
  await mutatePendingNativeOAuthCallbacks(
    (callbacks) => [
      ...callbacks.filter((entry) => entry.state !== callback.state),
      callback,
    ],
    storageKey,
  );
}

async function removePendingNativeOAuthCallback(
  state: string,
  storageKey = NATIVE_OAUTH_PENDING_CALLBACK_KEY,
): Promise<void> {
  await mutatePendingNativeOAuthCallbacks(
    (callbacks) => callbacks.filter((callback) => callback.state !== state),
    storageKey,
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

export async function beginNativeOAuthLink(
  provider: OAuthProvider,
  userId: number,
): Promise<void> {
  if (!isTauriRuntime) {
    throw new Error("Native account linking is only available in Tauri");
  }
  observeOAuthIdentityChange();
  const serverId = getCurrentServerId();
  const server = getServers().find((item) => item.id === serverId);
  const session = decodeOAuthSession(server?.token ?? null);
  if (!serverId || !server || !session) {
    throw new Error("Sign in to a Crate server before linking an account");
  }
  if (session.userId !== userId) {
    throw new Error("The active account changed before linking could start");
  }

  const verifier = randomBase64Url(64);
  const state = randomBase64Url(32);
  const challenge = await challengeForVerifier(verifier);
  const record: NativeOAuthLinkRecord = {
    verifier,
    createdAt: Date.now(),
    serverId,
    userId,
    sessionId: session.sessionId,
    generation: readOAuthLinkGeneration(),
    provider,
  };
  const recordKey = `crate.oauth.link.${state}`;
  if (!isCurrentNativeOAuthLink(record)) {
    throw new Error("The active account changed before linking could start");
  }
  await writeNativeOAuthRecord(recordKey, JSON.stringify(record));
  try {
    const response = await api<{ login_url: string }>(
      `/api/auth/oauth/${provider}/native-link/start`,
      "POST",
      {
        native_code_challenge: challenge,
        native_state: state,
      },
    );
    if (!isCurrentNativeOAuthLink(record)) {
      throw new Error("The active account or server changed during linking");
    }
    await openExternalUrl(response.login_url);
  } catch (error) {
    await removeNativeOAuthRecord(recordKey);
    throw error;
  }
}

function isCurrentNativeOAuthLink(record: NativeOAuthLinkRecord): boolean {
  observeOAuthIdentityChange();
  const serverId = getCurrentServerId();
  const server = getServers().find((item) => item.id === serverId);
  const session = decodeOAuthSession(server?.token ?? null);
  return (
    serverId === record.serverId &&
    session?.userId === record.userId &&
    session.sessionId === record.sessionId &&
    readOAuthLinkGeneration() === record.generation
  );
}

async function readNativeOAuthLinkRecord(
  state: string,
): Promise<NativeOAuthLinkRecord | null> {
  const raw = await readNativeOAuthRecord(`crate.oauth.link.${state}`);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<NativeOAuthLinkRecord>;
    if (
      typeof record.verifier !== "string" ||
      !NATIVE_LINK_VERIFIER_RE.test(record.verifier) ||
      typeof record.createdAt !== "number" ||
      typeof record.serverId !== "string" ||
      typeof record.userId !== "number" ||
      !Number.isSafeInteger(record.userId) ||
      typeof record.sessionId !== "string" ||
      !record.sessionId ||
      typeof record.generation !== "number" ||
      !Number.isSafeInteger(record.generation) ||
      (record.provider !== "google" && record.provider !== "apple")
    ) {
      return null;
    }
    return record as NativeOAuthLinkRecord;
  } catch {
    return null;
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
    const isNativeLinkCallback =
      isTauriRuntime &&
      parsed.protocol === "cratemusic:" &&
      parsed.hostname === "oauth" &&
      parsed.pathname === "/link-callback";
    const isNativeLoginCallback =
      parsed.protocol === "cratemusic:" &&
      parsed.hostname === "oauth" &&
      parsed.pathname === "/callback";

    if (!isNativeLinkCallback && !isNativeLoginCallback) {
      return { handled: false, next: "/" };
    }

    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state");
    const callbackError = parsed.searchParams.get("error");
    if (!state || !NATIVE_LINK_VALUE_RE.test(state)) {
      return { handled: false, next: "/" };
    }
    if (isNativeLinkCallback) {
      if (callbackError === "cancelled") {
        return exchangeNativeOAuthLinkCallback("", state, true);
      }
      if (!code || !NATIVE_LINK_VALUE_RE.test(code)) {
        return { handled: false, next: "/" };
      }
      await writePendingNativeOAuthCallback(
        { code, state, createdAt: Date.now() },
        NATIVE_OAUTH_LINK_PENDING_CALLBACK_KEY,
      );
      return exchangeNativeOAuthLinkCallback(code, state);
    }
    if (callbackError === "cancelled") {
      await Promise.allSettled([
        removeNativeOAuthRecord(oauthRecordKey(state)),
        removePendingNativeOAuthCallback(state),
      ]);
      return { handled: true, next: "/", cancelled: true };
    }
    if (!code) return { handled: false, next: "/" };
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
    let retryableResult: OAuthCallbackResult | undefined;
    for (const pending of pendingCallbacks) {
      const result = await exchangeNativeOAuthCallback(
        pending.code,
        pending.state,
      );
      if (result.handled) return result;
      if (result.retryable) retryableResult = result;
    }
    return retryableResult ?? { handled: false, next: "/" };
  } catch {
    return { handled: false, next: "/" };
  }
}

export async function retryPendingNativeOAuthLinkCallback(): Promise<OAuthCallbackResult> {
  try {
    await pendingCallbackMutation;
    const raw = await readNativeOAuthRecord(
      NATIVE_OAUTH_LINK_PENDING_CALLBACK_KEY,
    );
    if (!raw) return { handled: false, next: "/" };
    const pendingCallbacks = parsePendingNativeOAuthCallbacks(raw).sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    if (pendingCallbacks.length === 0) {
      await removeNativeOAuthRecord(NATIVE_OAUTH_LINK_PENDING_CALLBACK_KEY);
      return { handled: false, next: "/" };
    }
    let retryableResult: OAuthCallbackResult | undefined;
    for (const pending of pendingCallbacks) {
      const result = await exchangeNativeOAuthLinkCallback(
        pending.code,
        pending.state,
      );
      if (result.handled) return result;
      if (result.retryable) retryableResult = result;
    }
    return retryableResult ?? { handled: false, next: "/" };
  } catch {
    return { handled: false, next: "/" };
  }
}

async function exchangeNativeOAuthLinkCallback(
  code: string,
  state: string,
  cancelled = false,
): Promise<OAuthCallbackResult> {
  if (activeNativeOAuthLinkStates.has(state)) {
    return { handled: false, next: "/" };
  }
  activeNativeOAuthLinkStates.add(state);
  const recordKey = `crate.oauth.link.${state}`;
  let removeRecord = true;
  let linkRecord: NativeOAuthLinkRecord | null = null;
  const linkResult = (error = false): OAuthCallbackResult => ({
    handled: true,
    next: "/settings",
    operation: "link",
    provider: linkRecord?.provider,
    userId: linkRecord?.userId,
    ...(error ? { error: true as const } : {}),
  });

  try {
    linkRecord = await readNativeOAuthLinkRecord(state);
    if (!linkRecord) return { handled: false, next: "/" };
    if (Date.now() - linkRecord.createdAt > OAUTH_RECORD_MAX_AGE_MS) {
      return linkResult(true);
    }
    if (cancelled) return linkResult(true);
    if (!isCurrentNativeOAuthLink(linkRecord)) return linkResult(true);

    try {
      await api<{ ok?: boolean }>(
        "/api/auth/oauth/native-link/complete",
        "POST",
        {
          code,
          code_verifier: linkRecord.verifier,
          state,
        },
      );
      return linkResult();
    } catch (error) {
      if (isRetryableOAuthExchangeError(error)) {
        removeRecord = false;
        return { handled: false, next: "/", retryable: true };
      }
      return linkResult(true);
    }
  } catch (error) {
    if (isRetryableOAuthExchangeError(error)) {
      removeRecord = false;
      return { handled: false, next: "/", retryable: true };
    }
    return linkRecord ? linkResult(true) : { handled: false, next: "/" };
  } finally {
    try {
      if (removeRecord) {
        await Promise.allSettled([
          removeNativeOAuthRecord(recordKey),
          removePendingNativeOAuthCallback(
            state,
            NATIVE_OAUTH_LINK_PENDING_CALLBACK_KEY,
          ),
        ]);
      }
    } finally {
      activeNativeOAuthLinkStates.delete(state);
    }
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
