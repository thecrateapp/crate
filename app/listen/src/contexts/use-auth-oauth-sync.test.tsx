import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumePendingOAuthNext: vi.fn<() => string | null>(() => null),
  consumePendingOAuthProviderError: vi.fn<() => boolean>(() => false),
  toastError: vi.fn(),
}));

vi.mock("@/lib/capacitor", () => ({
  consumePendingOAuthNext: mocks.consumePendingOAuthNext,
  consumePendingOAuthProviderError: mocks.consumePendingOAuthProviderError,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

import { useAuthOAuthSync } from "./use-auth-oauth-sync";

describe("useAuthOAuthSync", () => {
  beforeEach(() => {
    mocks.consumePendingOAuthNext.mockReset().mockReturnValue(null);
    mocks.consumePendingOAuthProviderError.mockReset().mockReturnValue(false);
    mocks.toastError.mockReset();
  });

  it("shows a generic retryable error for native OAuth provider failures", () => {
    const refetch = vi.fn(async () => null);
    const navigate = vi.fn();
    renderHook(() => useAuthOAuthSync({ navigate, refetch }));

    act(() => {
      window.dispatchEvent(new CustomEvent("crate:oauth-provider-error"));
    });

    expect(mocks.toastError).toHaveBeenCalledWith("auth.login.connectionError");
    expect(refetch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a provider failure that arrived before the auth hook mounted", () => {
    mocks.consumePendingOAuthProviderError.mockReturnValueOnce(true);

    renderHook(() =>
      useAuthOAuthSync({ navigate: vi.fn(), refetch: vi.fn(async () => null) }),
    );

    expect(mocks.toastError).toHaveBeenCalledWith("auth.login.connectionError");
  });
});
