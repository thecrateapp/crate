import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  beginNativeOAuthLink: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/lib/capacitor-oauth", () => ({
  beginNativeOAuthLink: mocks.beginNativeOAuthLink,
}));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  isTauriRuntime: true,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/components/settings/ConnectDevicesSection", () => ({
  ConnectDevicesSection: () => null,
}));

import { AccountSection } from "@/components/settings/AccountSection";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

describe("AccountSection native OAuth linking", () => {
  beforeEach(() => {
    mocks.api.mockReset().mockImplementation((path: string) => {
      if (path === "/api/auth/providers") {
        return Promise.resolve({
          google: { configured: true, enabled: true, login_url: null },
        });
      }
      if (path === "/api/auth/config") return Promise.resolve({});
      return Promise.resolve({});
    });
    mocks.beginNativeOAuthLink.mockReset().mockResolvedValue(undefined);
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts the native session-bound flow and refreshes only for its account", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn(async () => createMockAuthUser({ id: 42 }));
    renderWithListenProviders(<AccountSection />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 42 }), refetch },
    });

    await user.click(await screen.findByRole("button", { name: "Link" }));

    expect(mocks.beginNativeOAuthLink).toHaveBeenCalledWith("google", 42);
    expect(
      mocks.api.mock.calls.some(([path]) =>
        String(path).endsWith("/google/link"),
      ),
    ).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("crate:oauth-link-completed", {
          detail: { provider: "google", userId: 42 },
        }),
      );
    });

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "The Google account was linked successfully",
    );
  });

  it("ignores a completion belonging to a different logged-in user", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn(async () => createMockAuthUser({ id: 42 }));
    renderWithListenProviders(<AccountSection />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 42 }), refetch },
    });

    await user.click(await screen.findByRole("button", { name: "Link" }));
    act(() => {
      window.dispatchEvent(
        new CustomEvent("crate:oauth-link-completed", {
          detail: { provider: "google", userId: 84 },
        }),
      );
    });

    expect(refetch).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
  });

  it("clears the spinner and reports a matching link failure", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<AccountSection />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 42 }) },
    });

    await user.click(await screen.findByRole("button", { name: "Link" }));
    act(() => {
      window.dispatchEvent(
        new CustomEvent("crate:oauth-link-failed", {
          detail: { provider: "google", userId: 42 },
        }),
      );
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Could not complete the Google link",
    );
    expect(screen.getByRole("button", { name: "Link" })).toBeEnabled();
  });

  it("allows retry when the native browser closes without returning a callback", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<AccountSection />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 42 }) },
    });

    await user.click(await screen.findByRole("button", { name: "Link" }));
    expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(await screen.findByRole("button", { name: "Link" })).toBeEnabled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});

describe("AccountSection profile", () => {
  beforeEach(() => {
    mocks.api.mockReset().mockImplementation((path: string) => {
      if (path === "/api/auth/providers") return Promise.resolve({});
      if (path === "/api/auth/config") return Promise.resolve({});
      return Promise.resolve({});
    });
  });

  it("saves the Instagram handle with the profile", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<AccountSection />, {
      locale: "en",
      auth: {
        user: createMockAuthUser({
          id: 7,
          name: "Diego",
          instagram_handle: null,
        }),
        refetch: vi.fn(async () => createMockAuthUser({ id: 7 })),
      },
    });

    await user.type(
      await screen.findByPlaceholderText("your.handle"),
      "@diego.trecedoce",
    );
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/auth/profile",
        "PUT",
        expect.objectContaining({ instagram_handle: "@diego.trecedoce" }),
      ),
    );
  });
});
