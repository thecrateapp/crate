import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setAuthTokens: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  setAuthTokens: mocks.setAuthTokens,
}));

vi.mock("@/lib/native-secure-session", () => ({
  getSecureSessionValue: vi.fn(),
  setSecureSessionValue: vi.fn(),
  removeSecureSessionValue: vi.fn(),
}));

vi.mock("@/lib/server-store", () => ({
  waitForPendingSecureSessionWrites: vi.fn(),
}));

import {
  beginDesktopOAuthHandoff,
  consumeOAuthCallbackUrl,
} from "@/lib/capacitor-oauth";

describe("desktop OAuth token handoff", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.setAuthTokens.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("rejects a cratemusic:// token callback with no matching handoff nonce", async () => {
    const result = await consumeOAuthCallbackUrl(
      "cratemusic://oauth/callback?token=attacker-supplied-token",
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(mocks.setAuthTokens).not.toHaveBeenCalled();
  });

  it("rejects a token callback carrying an unknown/guessed state", async () => {
    beginDesktopOAuthHandoff("/library");

    const result = await consumeOAuthCallbackUrl(
      "cratemusic://oauth/callback?token=attacker-supplied-token&state=not-the-real-state",
    );

    expect(result).toEqual({ handled: false, next: "/" });
    expect(mocks.setAuthTokens).not.toHaveBeenCalled();
  });

  it("accepts a token callback whose state matches a handoff we started", async () => {
    const state = beginDesktopOAuthHandoff("/library");

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?token=real-token&refresh_token=r&state=${state}`,
    );

    expect(result).toEqual({ handled: true, next: "/library" });
    expect(mocks.setAuthTokens).toHaveBeenCalledWith(
      "real-token",
      "r",
      undefined,
    );
  });

  it("consumes the handoff nonce so it cannot be replayed", async () => {
    const state = beginDesktopOAuthHandoff("/library");

    await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?token=real-token&state=${state}`,
    );
    mocks.setAuthTokens.mockClear();

    const replay = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?token=another-token&state=${state}`,
    );

    expect(replay).toEqual({ handled: false, next: "/" });
    expect(mocks.setAuthTokens).not.toHaveBeenCalled();
  });

  it("ignores a next carried on the URL itself in favor of the stored destination", async () => {
    const state = beginDesktopOAuthHandoff("/library");

    const result = await consumeOAuthCallbackUrl(
      `cratemusic://oauth/callback?token=real-token&state=${state}&next=/settings/danger-zone`,
    );

    expect(result).toEqual({ handled: true, next: "/library" });
  });
});
