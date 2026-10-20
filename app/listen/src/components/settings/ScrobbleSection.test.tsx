import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  beginNativeLastfmLink: vi.fn(),
  completeNativeLastfmLink: vi.fn(),
  cancelNativeLastfmLink: vi.fn(),
  hasPendingNativeLastfmLink: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/lib/native-lastfm-oauth", () => ({
  beginNativeLastfmLink: mocks.beginNativeLastfmLink,
  completeNativeLastfmLink: mocks.completeNativeLastfmLink,
  cancelNativeLastfmLink: mocks.cancelNativeLastfmLink,
  hasPendingNativeLastfmLink: mocks.hasPendingNativeLastfmLink,
}));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  isTauriRuntime: true,
}));
vi.mock("sonner", () => ({
  toast: {
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

import { ScrobbleSection } from "@/components/settings/ScrobbleSection";
import {
  createMockAuthUser,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

describe("ScrobbleSection native Last.fm flow", () => {
  beforeEach(() => {
    mocks.api.mockReset().mockImplementation((path: string) => {
      if (path === "/api/me/scrobble/status") {
        return Promise.resolve({
          lastfm: { connected: false },
          listenbrainz: { connected: false },
        });
      }
      if (path === "/api/me/scrobble/preferences") {
        return Promise.resolve({ remote_scrobbling_enabled: false });
      }
      return Promise.resolve({});
    });
    mocks.beginNativeLastfmLink.mockReset().mockResolvedValue(undefined);
    mocks.completeNativeLastfmLink.mockReset().mockResolvedValue({
      ok: true,
      username: "diego",
    });
    mocks.cancelNativeLastfmLink.mockReset();
    mocks.hasPendingNativeLastfmLink.mockReset().mockResolvedValue(false);
    mocks.toastInfo.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  it("opens the system browser and asks the user to finish after returning", async () => {
    const user = userEvent.setup();
    const initialUrl = window.location.href;
    renderWithListenProviders(<ScrobbleSection />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 42 }) },
    });

    await user.click(
      (await screen.findAllByRole("button", { name: "Connect" }))[0]!,
    );

    expect(mocks.beginNativeLastfmLink).toHaveBeenCalledWith(42);
    expect(window.location.href).toBe(initialUrl);
    expect(
      mocks.api.mock.calls.some(
        ([path]) => path === "/api/me/scrobble/lastfm/auth-url",
      ),
    ).toBe(false);
    expect(
      await screen.findByRole("button", { name: "Finish connection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Authorize Last\.fm in your browser/),
    ).toBeVisible();
    expect(mocks.toastInfo).toHaveBeenCalledWith(
      "Last.fm opened in your browser. Return here after authorizing it.",
    );
  });

  it("finishes the pending link and refreshes status", async () => {
    mocks.hasPendingNativeLastfmLink.mockResolvedValue(true);
    const user = userEvent.setup();
    renderWithListenProviders(<ScrobbleSection />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 42 }) },
    });

    await user.click(
      await screen.findByRole("button", { name: "Finish connection" }),
    );

    await waitFor(() => {
      expect(mocks.completeNativeLastfmLink).toHaveBeenCalledWith(42);
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Last.fm connected");
    });
  });

  it("lets the user cancel the waiting native flow", async () => {
    mocks.hasPendingNativeLastfmLink.mockResolvedValue(true);
    const user = userEvent.setup();
    renderWithListenProviders(<ScrobbleSection />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 42 }) },
    });

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mocks.cancelNativeLastfmLink).toHaveBeenCalledWith(42);
    expect(screen.getAllByRole("button", { name: "Connect" })[0]).toBeEnabled();
  });
  it("keeps preferences and linking unavailable when the initial provider read fails, then retries", async () => {
    mocks.api.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    renderWithListenProviders(<ScrobbleSection />, { locale: "en" });
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("switch")).toBeEnabled();
    expect(mocks.api.mock.calls.every((call) => call.length === 1)).toBe(true);
  });
  it("blocks finishing while native cancellation is pending and reports a failure without discarding the pending link", async () => {
    mocks.hasPendingNativeLastfmLink.mockResolvedValue(true);
    let rejectCancel!: (error: Error) => void;
    mocks.cancelNativeLastfmLink.mockReturnValue(
      new Promise((_, reject) => {
        rejectCancel = reject;
      }),
    );
    const user = userEvent.setup();
    renderWithListenProviders(<ScrobbleSection />, {
      locale: "en",
      auth: { user: createMockAuthUser({ id: 42 }) },
    });
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Finish connection" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    rejectCancel(new Error("Secure store unavailable"));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Could not cancel the connection. Try again.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Finish connection" }),
    ).toBeEnabled();
  });
  it("blocks competing provider actions during disconnect and keeps the connected status until confirmed", async () => {
    let resolveDisconnect!: (value: unknown) => void;
    mocks.api.mockResolvedValueOnce({
      lastfm: { connected: true, username: "Mixed Case" },
      listenbrainz: { connected: true, username: "Listener" },
    });
    const usual = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((path: string, method?: string) =>
      method === "DELETE"
        ? new Promise((resolve) => {
            resolveDisconnect = resolve;
          })
        : usual(path),
    );
    const user = userEvent.setup();
    renderWithListenProviders(<ScrobbleSection />, { locale: "en" });
    await user.click(
      (await screen.findAllByRole("button", { name: "Disconnect" }))[0]!,
    );
    for (const button of screen.getAllByRole("button", { name: "Disconnect" }))
      expect(button).toBeDisabled();
    resolveDisconnect({});
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled(),
    );
  });
});
