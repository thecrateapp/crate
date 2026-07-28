import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  beginNativeOAuth: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  getApiBase: () => "https://api.example.test",
}));

vi.mock("@/lib/capacitor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/capacitor")>()),
  isNative: true,
  beginNativeOAuth: mocks.beginNativeOAuth,
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  isTauriRuntime: false,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

describe("OAuthButtons", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.beginNativeOAuth.mockReset();
    mocks.toastError.mockReset();
    mocks.api.mockResolvedValue({
      google: {
        enabled: true,
        configured: true,
        login_url: "/api/auth/oauth/google/start",
      },
    });
  });

  it("shows a recoverable error when native exchange cannot start", async () => {
    const user = userEvent.setup();
    mocks.beginNativeOAuth.mockRejectedValue(
      new Error("Native OAuth exchange is not enabled"),
    );
    renderWithListenProviders(<OAuthButtons />);

    await user.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Native OAuth exchange is not enabled",
      ),
    );
  });
});
