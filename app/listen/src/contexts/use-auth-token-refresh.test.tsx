import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthTokenExpiresAtMock, getAuthTokenMock, refreshAuthTokenMock } =
  vi.hoisted(() => ({
    getAuthTokenExpiresAtMock: vi.fn<() => string | null>(),
    getAuthTokenMock: vi.fn<() => string | null>(),
    refreshAuthTokenMock: vi.fn<() => Promise<boolean>>(),
  }));

vi.mock("@/lib/api", () => ({
  AUTH_TOKEN_EVENT: "crate:auth-token-updated",
  getAuthToken: getAuthTokenMock,
  getAuthTokenExpiresAt: getAuthTokenExpiresAtMock,
  refreshAuthToken: refreshAuthTokenMock,
}));

import { useAuthTokenRefresh } from "@/contexts/use-auth-token-refresh";

describe("useAuthTokenRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T10:00:00Z"));
    getAuthTokenMock.mockReturnValue("short-lived-token");
    getAuthTokenExpiresAtMock.mockReturnValue("2026-07-27T10:01:00Z");
    refreshAuthTokenMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("does not refresh a short-lived token every five seconds", async () => {
    renderHook(() =>
      useAuthTokenRefresh({
        id: 1,
        name: "Listener",
        email: "listener@example.test",
        role: "user",
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(refreshAuthTokenMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(42_000);
    });

    expect(refreshAuthTokenMock).toHaveBeenCalledTimes(1);
  });
});
