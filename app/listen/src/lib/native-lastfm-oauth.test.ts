import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secureValues: new Map<string, string>(),
  secureGet: vi.fn(async (key: string) => mocks.secureValues.get(key) ?? null),
  secureSet: vi.fn(async (key: string, value: string) => {
    mocks.secureValues.set(key, value);
  }),
  secureRemove: vi.fn(async (key: string) => {
    mocks.secureValues.delete(key);
  }),
  api: vi.fn(),
  captureIdentity: vi.fn(),
  isCurrentIdentity: vi.fn(),
  openExternalUrl: vi.fn(),
  isTauriRuntime: true,
}));

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  ApiError: class ApiError extends Error {
    constructor(public status: number) {
      super(`API ${status}`);
    }
  },
}));
vi.mock("@/lib/capacitor-oauth", () => ({
  captureNativeOAuthLinkIdentity: mocks.captureIdentity,
  isCurrentNativeOAuthLinkIdentity: mocks.isCurrentIdentity,
}));
vi.mock("@/lib/external-links", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));
vi.mock("@/lib/platform", () => ({ isTauriRuntime: mocks.isTauriRuntime }));
vi.mock("@/lib/native-secure-session", () => ({
  getSecureSessionValue: mocks.secureGet,
  setSecureSessionValue: mocks.secureSet,
  removeSecureSessionValue: mocks.secureRemove,
}));

import {
  beginNativeLastfmLink,
  cancelNativeLastfmLink,
  completeNativeLastfmLink,
  hasPendingNativeLastfmLink,
  migrateLegacyTauriLastfmRecord,
} from "@/lib/native-lastfm-oauth";

const SECURE_PENDING_KEY = "crate.oauth.lastfm-native-link.pending";

function securePendingRecord(): string | null {
  return mocks.secureValues.get(SECURE_PENDING_KEY) ?? null;
}

const identity = {
  serverId: "server-a",
  userId: 42,
  sessionId: "session-a",
  generation: 3,
};

describe("native Last.fm linking", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.secureValues.clear();
    mocks.secureGet.mockClear();
    mocks.secureSet.mockClear();
    mocks.secureRemove.mockClear();
    mocks.api.mockReset().mockImplementation((path: string) => {
      if (path.endsWith("/native/start")) {
        return Promise.resolve({
          flow_id: "f".repeat(43),
          authorization_url: "https://www.last.fm/api/auth/?token=provider",
        });
      }
      if (path.endsWith("/native/complete")) {
        return Promise.resolve({ ok: true, username: "diego" });
      }
      return Promise.resolve({});
    });
    mocks.captureIdentity.mockReset().mockReturnValue(identity);
    mocks.isCurrentIdentity.mockReset().mockReturnValue(true);
    mocks.openExternalUrl.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens Last.fm externally and persists only the session-bound handoff", async () => {
    await beginNativeLastfmLink(42);

    expect(mocks.api).toHaveBeenCalledWith(
      "/api/me/scrobble/lastfm/native/start",
      "POST",
      expect.objectContaining({
        code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      "https://www.last.fm/api/auth/?token=provider",
    );
    expect(await hasPendingNativeLastfmLink(42)).toBe(true);
    expect(securePendingRecord()).not.toContain("provider");
    expect(localStorage.getItem("crate.lastfm.native-link.pending")).toBeNull();
  });

  it("completes with the saved flow and clears it after success", async () => {
    await beginNativeLastfmLink(42);

    await expect(completeNativeLastfmLink(42)).resolves.toEqual({
      ok: true,
      username: "diego",
    });

    const [, , body] = mocks.api.mock.calls.find(([path]) =>
      String(path).endsWith("/native/complete"),
    )!;
    expect(body).toEqual({
      flow_id: "f".repeat(43),
      state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/),
    });
    expect(await hasPendingNativeLastfmLink(42)).toBe(false);
  });

  it("keeps the pending flow after a retryable server failure", async () => {
    await beginNativeLastfmLink(42);
    mocks.api.mockRejectedValueOnce(new Error("network unavailable"));

    await expect(completeNativeLastfmLink(42)).rejects.toThrow(
      "network unavailable",
    );
    expect(await hasPendingNativeLastfmLink(42)).toBe(true);
  });

  it("discards a flow after the active server or session changes", async () => {
    await beginNativeLastfmLink(42);
    mocks.isCurrentIdentity.mockReturnValue(false);

    expect(await hasPendingNativeLastfmLink(42)).toBe(false);
    expect(securePendingRecord()).toBeNull();
    await expect(completeNativeLastfmLink(42)).rejects.toThrow(
      "There is no pending Last.fm connection",
    );
  });

  it("cancels the pending flow on the server and locally", async () => {
    await beginNativeLastfmLink(42);
    await cancelNativeLastfmLink(42);

    expect(mocks.api).toHaveBeenCalledWith(
      "/api/me/scrobble/lastfm/native/cancel",
      "POST",
      {
        flow_id: "f".repeat(43),
        state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{86}$/),
      },
    );
    expect(await hasPendingNativeLastfmLink(42)).toBe(false);
  });

  it("expires the local handoff before Last.fm's one-hour token limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T00:00:00.000Z"));
    await beginNativeLastfmLink(42);

    vi.advanceTimersByTime(55 * 60 * 1000 + 1);

    expect(await hasPendingNativeLastfmLink(42)).toBe(false);
    expect(securePendingRecord()).toBeNull();
  });

  it("migrates the legacy Last.fm handoff only after secure verification", async () => {
    const value = JSON.stringify({
      ...identity,
      flowId: "f".repeat(43),
      verifier: "v".repeat(43),
      state: "s".repeat(43),
      createdAt: Date.now(),
    });
    localStorage.setItem("crate.lastfm.native-link.pending", value);

    await migrateLegacyTauriLastfmRecord();

    expect(securePendingRecord()).toBe(value);
    expect(localStorage.getItem("crate.lastfm.native-link.pending")).toBeNull();
  });

  it("preserves a legacy Last.fm handoff when the secure store is unavailable", async () => {
    const value = JSON.stringify({
      ...identity,
      flowId: "f".repeat(43),
      verifier: "v".repeat(43),
      state: "s".repeat(43),
      createdAt: Date.now(),
    });
    localStorage.setItem("crate.lastfm.native-link.pending", value);
    mocks.secureSet.mockRejectedValueOnce(new Error("secure store locked"));

    await expect(migrateLegacyTauriLastfmRecord()).rejects.toThrow(
      "Native Last.fm migration failed",
    );

    expect(localStorage.getItem("crate.lastfm.native-link.pending")).toBe(
      value,
    );
  });
});
