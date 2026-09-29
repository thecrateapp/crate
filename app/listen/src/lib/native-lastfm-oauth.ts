import { ApiError, api } from "@/lib/api";
import {
  captureNativeOAuthLinkIdentity,
  isCurrentNativeOAuthLinkIdentity,
  type NativeOAuthLinkIdentity,
} from "@/lib/capacitor-oauth";
import { openExternalUrl } from "@/lib/external-links";
import { isTauriRuntime } from "@/lib/platform";

const PENDING_KEY = "crate.lastfm.native-link.pending";
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

function readPendingRecord(userId?: number): NativeLastfmLinkRecord | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
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
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return record as NativeLastfmLinkRecord;
  } catch {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // The expired or malformed record is ignored when storage is unavailable.
    }
    return null;
  }
}

function clearPendingRecord(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // A local cleanup failure cannot make the backend apply a different session.
  }
}

export function hasPendingNativeLastfmLink(userId?: number): boolean {
  return isTauriRuntime && readPendingRecord(userId) !== null;
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
  localStorage.setItem(PENDING_KEY, JSON.stringify(record));
  try {
    await openExternalUrl(response.authorization_url);
  } catch (error) {
    clearPendingRecord();
    throw error;
  }
}

export async function completeNativeLastfmLink(
  userId: number,
): Promise<NativeLastfmLinkCompleteResponse> {
  if (!isTauriRuntime) {
    throw new Error("Native Last.fm linking is only available in Tauri");
  }
  const record = readPendingRecord(userId);
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
    clearPendingRecord();
    return result;
  } catch (error) {
    if (
      error instanceof ApiError &&
      [400, 401, 403, 404, 409, 410].includes(error.status)
    ) {
      clearPendingRecord();
    }
    throw error;
  }
}

export async function cancelNativeLastfmLink(userId?: number): Promise<void> {
  const record = readPendingRecord(userId);
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
    clearPendingRecord();
  }
}
