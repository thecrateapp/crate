import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { ScrobbleSettingsView } from "./ScrobbleSettingsView";
import { BandcampSettingsView } from "./BandcampSettingsView";
import { OpenSubsonicSettingsView } from "./OpenSubsonicSettingsView";

const scrobble = {
  status: { lastfm: { connected: false }, listenbrainz: { connected: false } },
  loading: false,
  loadError: false,
  onRetry: vi.fn(),
  remoteScrobblingEnabled: false,
  savingRemotePreference: false,
  onRemoteChange: vi.fn(),
  lbToken: "",
  onTokenChange: vi.fn(),
  connecting: null,
  nativeLastfmPending: false,
  isTauriRuntime: false,
  onLastfmConnect: vi.fn(),
  onNativeComplete: vi.fn(),
  onNativeCancel: vi.fn(),
  onListenBrainzConnect: vi.fn(),
  onDisconnect: vi.fn(),
};
const bandcamp = {
  status: { connected: false, status: "disconnected", bridge_enabled: false },
  counts: { collection: 0, wishlist: 0, following: 0 },
  busy: null,
  loading: false,
  loadError: false,
  onRetry: vi.fn(),
  isTauriRuntime: false,
  bandcampCookie: "",
  setBandcampCookie: vi.fn(),
  onSync: vi.fn(),
  onDisconnect: vi.fn(),
  onOpenDesktop: vi.fn(),
  onConnect: vi.fn(),
};
describe("Settings integration views", () => {
  it("labels the ListenBrainz secret and blocks submission until it has a value", async () => {
    const user = userEvent.setup(),
      onConnect = vi.fn();
    function Fixture() {
      const [token, setToken] = useState("");
      return (
        <ScrobbleSettingsView
          {...scrobble}
          lbToken={token}
          onTokenChange={setToken}
          onListenBrainzConnect={onConnect}
        />
      );
    }
    renderWithListenProviders(<Fixture />, { locale: "en" });
    const form = screen.getByRole("form", { name: "ListenBrainz" });
    expect(within(form).getByLabelText("API token")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      within(form).getByRole("button", { name: "Connect" }),
    ).toBeDisabled();
    await user.type(within(form).getByLabelText("API token"), "example-token");
    await user.click(within(form).getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledOnce();
  });
  it("keeps native completion/cancel and connected provider actions in the same view", async () => {
    const user = userEvent.setup(),
      complete = vi.fn(),
      cancel = vi.fn(),
      disconnect = vi.fn();
    renderWithListenProviders(
      <ScrobbleSettingsView
        {...scrobble}
        isTauriRuntime
        nativeLastfmPending
        onNativeComplete={complete}
        onNativeCancel={cancel}
        status={{
          lastfm: { connected: false },
          listenbrainz: { connected: true, username: "Mixed Case" },
        }}
        onDisconnect={disconnect}
      />,
      { locale: "en" },
    );
    await user.click(screen.getByRole("button", { name: "Finish connection" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(complete).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledWith("listenbrainz");
    expect(screen.queryByLabelText("API token")).not.toBeInTheDocument();
  });
  it("does not label a failed scrobble read as disconnected or allow preference writes", async () => {
    const user = userEvent.setup(),
      retry = vi.fn();
    renderWithListenProviders(
      <ScrobbleSettingsView {...scrobble} loadError onRetry={retry} />,
      { locale: "en" },
    );
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("Not connected")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("keeps the cookie field labelled and native/browser connect actions disabled while busy", () => {
    renderWithListenProviders(
      <BandcampSettingsView
        {...bandcamp}
        isTauriRuntime
        busy="tauri-connect"
      />,
      { locale: "en" },
    );
    expect(screen.getByLabelText("Session cookie")).toHaveAttribute(
      "autocomplete",
      "off",
    );
    expect(
      screen.getByRole("button", { name: "Connect in Bandcamp window" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Connect with cookie" }),
    ).toBeDisabled();
  });
  it("shows verified Bandcamp zero counts and delegates sync/disconnect without exposing the cookie form", async () => {
    const user = userEvent.setup(),
      sync = vi.fn(),
      disconnect = vi.fn();
    renderWithListenProviders(
      <BandcampSettingsView
        {...bandcamp}
        status={{
          ...bandcamp.status,
          connected: true,
          display_name: "Record Collector",
        }}
        onSync={sync}
        onDisconnect={disconnect}
      />,
      { locale: "en" },
    );
    expect(screen.getByText("Record Collector")).toBeVisible();
    expect(screen.queryByLabelText("Session cookie")).toBeNull();
    expect(screen.getByText(/Collection 0/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sync" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(sync).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("keeps OpenSubsonic auth explanations named and secret reveal actions separate from destructive confirmation", async () => {
    const request = vi.fn(),
      hide = vi.fn(),
      user = userEvent.setup();
    renderWithListenProviders(
      <OpenSubsonicSettingsView
        configured
        loading={false}
        loadError={false}
        secret="example-only-key"
        notice={null}
        error={null}
        busy={false}
        confirmOpen={false}
        confirmingAction="rotate"
        onRetry={vi.fn()}
        onCreate={vi.fn()}
        onCopy={vi.fn()}
        onHide={hide}
        onRequestConfirmation={request}
        onConfirm={vi.fn()}
        onConfirmOpenChange={vi.fn()}
      />,
      { locale: "en" },
    );
    expect(
      screen.getByRole("group", { name: "API key authentication" }),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Legacy username and password" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide key" }));
    expect(hide).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Revoke key" }));
    expect(request).toHaveBeenCalledWith("revoke");
  });
});
