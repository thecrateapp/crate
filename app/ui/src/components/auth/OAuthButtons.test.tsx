import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { OAuthButtons } from "./OAuthButtons";

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

    render(
      <MemoryRouter>
        <OAuthButtons />
      </MemoryRouter>,
    );

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

    const { container } = render(
      <MemoryRouter>
        <OAuthButtons />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});
