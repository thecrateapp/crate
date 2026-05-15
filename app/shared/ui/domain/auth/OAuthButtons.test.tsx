import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OAuthButtons } from "./OAuthButtons";

function mockProviders(config: Record<string, boolean> = {}) {
  return vi.fn().mockResolvedValue({
    google: {
      enabled: config.google ?? true,
      configured: config.googleConfigured ?? true,
      login_url: "https://example.com/oauth/google",
    },
    apple: {
      enabled: config.apple ?? false,
      configured: config.appleConfigured ?? false,
      login_url: null,
    },
  });
}

describe("OAuthButtons", () => {
  it("renders nothing when no providers are enabled", async () => {
    const fetchProviders = vi.fn().mockResolvedValue({
      google: { enabled: false, configured: false, login_url: null },
      apple: { enabled: false, configured: false, login_url: null },
    });
    const { container } = render(
      <OAuthButtons
        fetchProviders={fetchProviders}
        onOAuthNavigate={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders Google button when enabled and configured", async () => {
    render(
      <OAuthButtons
        fetchProviders={mockProviders()}
        onOAuthNavigate={vi.fn()}
      />,
    );
    expect(
      await screen.findByLabelText(/Continue with Google/i),
    ).toBeInTheDocument();
  });

  it("renders nothing when google is enabled but not configured and apple is disabled", async () => {
    const { container } = render(
      <OAuthButtons
        fetchProviders={mockProviders({
          googleConfigured: false,
          apple: false,
        })}
        onOAuthNavigate={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("calls onOAuthNavigate when Google button is clicked", async () => {
    const onNavigate = vi.fn();
    render(
      <OAuthButtons
        fetchProviders={mockProviders()}
        onOAuthNavigate={onNavigate}
        returnTo="/home"
        inviteToken="abc"
      />,
    );
    const btn = await screen.findByLabelText(/Continue with Google/i);
    await userEvent.click(btn);
    expect(onNavigate).toHaveBeenCalledWith(
      "https://example.com/oauth/google",
      "/home",
      "abc",
    );
  });

  it("renders Apple button when enabled", async () => {
    render(
      <OAuthButtons
        fetchProviders={mockProviders({ apple: true, appleConfigured: true })}
        onOAuthNavigate={vi.fn()}
      />,
    );
    expect(
      await screen.findByLabelText(/Continue with Apple/i),
    ).toBeInTheDocument();
  });
});
