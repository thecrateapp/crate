import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { OAuthButtons } from "./OAuthButtons";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

import { api } from "@/lib/api";

describe("OAuthButtons", () => {
  it("renders provider buttons when available", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      google: {
        enabled: true,
        configured: true,
        login_url: "https://example.com/google",
      },
    });

    renderWithAdminProviders(<OAuthButtons />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Continue with Google/i),
      ).toBeInTheDocument();
    });
  });

  it("renders nothing when no providers are enabled", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      google: { enabled: false, configured: false, login_url: null },
    });

    const { container } = renderWithAdminProviders(<OAuthButtons />);

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});
