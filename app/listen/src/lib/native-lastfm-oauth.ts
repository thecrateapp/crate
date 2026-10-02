import { ApiError, api } from "@/lib/api";
import {
  captureNativeOAuthLinkIdentity,
  isCurrentNativeOAuthLinkIdentity,
  type NativeOAuthLinkIdentity,
} from "@/lib/capacitor-oauth";
import { openExternalUrl } from "@/lib/external-links";
import {
  getSecureSessionValue,
  removeSecureSessionValue,
  setSecureSessionValue,
} from "@/lib/native-secure-session";
import { isTauriRuntime } from "@/lib/platform";

const LEGACY_PENDING_KEY = "crate.lastfm.native-link.pending";
const PENDING_KEY = "crate.oauth.lastfm-native-link.pending";
const FLOW_TTL_MS = 55 * 60 * 1000;
const FLOW_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const STATE_RE = /^[A-Za-z0-9_-]{16,256}$/;

interface NativeLastfmLinkRecord extends NativeOAuthLinkIdentity {
  flowId: string;
  verifier: string;
  state: string;
  createdAt: number;
}

interface NativeLastfmLinkStartResponse {
  flow_id: string;
  authorization_url: string;
}

interface NativeLastfmLinkCompleteResponse {
  ok: true;
  username: string;
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

async function readPendingRecord(
  userId?: number,
): Promise<NativeLastfmLinkRecord | null> {
  const raw = await getSecureSessionValue(PENDING_KEY);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<NativeLastfmLinkRecord>;
    if (
      typeof record.flowId !== "string" ||
      !FLOW_ID_RE.test(record.flowId) ||
      typeof record.verifier !== "string" ||
      !VERIFIER_RE.test(record.verifier) ||
      typeof record.state !== "string" ||
      !STATE_RE.test(record.state) ||
      typeof record.createdAt !== "number" ||
      !Number.isFinite(record.createdAt) ||
      typeof record.serverId !== "string" ||
      typeof record.userId !== "number" ||
      !Number.isSafeInteger(record.userId) ||
      typeof record.sessionId !== "string" ||
      !record.sessionId ||
      typeof record.generation !== "number" ||
      !Number.isSafeInteger(record.generation) ||
      Date.now() - record.createdAt > FLOW_TTL_MS ||
      (userId !== undefined && userId !== record.userId) ||
      !isCurrentNativeOAuthLinkIdentity(record as NativeOAuthLinkIdentity)
    ) {
      await clearPendingRecord();
      return null;
    }
    return record as NativeLastfmLinkRecord;
  } catch (error) {
    await clearPendingRecord();
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function clearPendingRecord(): Promise<void> {
  await removeSecureSessionValue(PENDING_KEY);
}

export async function migrateLegacyTauriLastfmRecord(): Promise<void> {
  if (!isTauriRuntime) return;
  try {
    const legacyValue = localStorage.getItem(LEGACY_PENDING_KEY);
    if (legacyValue === null) return;
    const secureValue = await getSecureSessionValue(PENDING_KEY);
    if (secureValue !== null) {
      JSON.parse(secureValue);
    } else {
      JSON.parse(legacyValue);
      await setSecureSessionValue(PENDING_KEY, legacyValue);
      if ((await getSecureSessionValue(PENDING_KEY)) !== legacyValue) {
        throw new Error("Secure Last.fm migration verification failed");
      }
    }
    localStorage.removeItem(LEGACY_PENDING_KEY);
  } catch (error) {
    const wrapped = new Error("Native Last.fm migration failed");
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
}

export async function hasPendingNativeLastfmLink(
  userId?: number,
): Promise<boolean> {
  return isTauriRuntime && (await readPendingRecord(userId)) !== null;
}

export async function beginNativeLastfmLink(userId: number): Promise<void> {
  if (!isTauriRuntime) {
    throw new Error("Native Last.fm linking is only available in Tauri");
  }
  const identity = captureNativeOAuthLinkIdentity(userId);
  if (!identity) {
    throw new Error("Sign in to a Crate server before linking Last.fm");
  }

  const verifier = randomBase64Url(64);
  const state = randomBase64Url(32);
  const codeChallenge = await challengeForVerifier(verifier);
  const response = await api<NativeLastfmLinkStartResponse>(
    "/api/me/scrobble/lastfm/native/start",
    "POST",
    { code_challenge: codeChallenge, state },
  );
  if (!isCurrentNativeOAuthLinkIdentity(identity)) {
    throw new Error("The active account or server changed during linking");
  }
  if (!FLOW_ID_RE.test(response.flow_id)) {
    throw new Error("The server returned an invalid Last.fm flow");
  }

  const record: NativeLastfmLinkRecord = {
    ...identity,
    flowId: response.flow_id,
    verifier,
    state,
    createdAt: Date.now(),
  };
  await setSecureSessionValue(PENDING_KEY, JSON.stringify(record));
  try {
    await openExternalUrl(response.authorization_url);
  } catch (error) {
    await clearPendingRecord();
    throw error;
  }
}

export async function completeNativeLastfmLink(
  userId: number,
): Promise<NativeLastfmLinkCompleteResponse> {
  if (!isTauriRuntime) {
    throw new Error("Native Last.fm linking is only available in Tauri");
  }
  const record = await readPendingRecord(userId);
  if (!record) {
    throw new Error("There is no pending Last.fm connection for this session");
  }

  try {
    const result = await api<NativeLastfmLinkCompleteResponse>(
      "/api/me/scrobble/lastfm/native/complete",
      "POST",
      {
        flow_id: record.flowId,
        state: record.state,
        code_verifier: record.verifier,
      },
    );
    if (!isCurrentNativeOAuthLinkIdentity(record)) {
      throw new Error("The active account or server changed during linking");
    }
    await clearPendingRecord();
    return result;
  } catch (error) {
    if (
      error instanceof ApiError &&
      [400, 401, 403, 404, 409, 410].includes(error.status)
    ) {
      await clearPendingRecord();
    }
    throw error;
  }
}

export async function cancelNativeLastfmLink(userId?: number): Promise<void> {
  const record = await readPendingRecord(userId);
  if (!record) return;
  try {
    await api("/api/me/scrobble/lastfm/native/cancel", "POST", {
      flow_id: record.flowId,
      state: record.state,
      code_verifier: record.verifier,
    });
  } catch {
    // The server-side flow still expires even when cancellation cannot reach it.
  } finally {
    await clearPendingRecord();
  }
}
