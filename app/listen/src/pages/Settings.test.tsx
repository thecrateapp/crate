import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation, useNavigate, type NavigateFunction } from "react-router";
import { useEffect } from "react";

import { Settings } from "@/pages/Settings";
import { api } from "@/lib/api";
import {
  renderWithListenProviders,
  createMockAuthUser,
} from "@/test/render-with-listen-providers";

const { androidNativePlayerState, credentialState } = vi.hoisted(() => ({
  credentialState: { configured: false },
  androidNativePlayerState: { enabled: false },
}));

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => androidNativePlayerState.enabled,
}));

vi.mock("@/components/settings/ServersSection", () => ({
  ServersSection: () => <section>Servers</section>,
}));

vi.mock("@/components/settings/ConnectDevicesSection", () => ({
  ConnectDevicesSection: () => <section>Connect devices</section>,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: vi.fn(async (url: string, method?: string, body?: unknown) => {
      if (url === "/api/me/location") {
        return {
          city: "Madrid",
          country: "Spain",
          country_code: "ES",
          latitude: 40.4,
          longitude: -3.7,
          show_radius_km: 60,
          show_location_mode: "fixed",
        };
      }
      if (url === "/api/bandcamp/me/status") {
        return {
          connected: false,
          status: "disconnected",
          bridge_enabled: false,
        };
      }
      if (url === "/api/me/scrobble/preferences") {
        if (method === "PUT") return body;
        return { remote_scrobbling_enabled: false };
      }
      if (url === "/api/auth/subsonic-token") {
        return { configured: credentialState.configured };
      }
      return {};
    }),
  };
});

function RouteProbe({
  onNavigate,
}: {
  onNavigate?: (navigate: NavigateFunction) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => onNavigate?.(navigate), [onNavigate, navigate]);
  return (
    <>
      <output aria-label="Current route">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      <button type="button" onClick={() => void navigate(-1)}>
        Previous tab
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        Next tab
      </button>
    </>
  );
}

describe("Settings", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api).mockClear();
    androidNativePlayerState.enabled = false;
    credentialState.configured = false;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
  });

  it("localizes the settings page chrome", async () => {
    const { container } = renderWithListenProviders(<Settings />, {
      locale: "es",
    });

    expect(
      screen.getByRole("heading", { name: "Ajustes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Idioma de la app" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Idioma de la app" }),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Reproducción" }));
    expect(screen.getByRole("heading", { name: "Temporizador" })).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Temporizador" }));
    expect(screen.getByRole("option", { name: "1 h" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Al terminar la pista" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Cuenta" }));
    expect(screen.getByPlaceholderText("tu-handle")).toBeVisible();
    expect(screen.queryByText("Enlaces rápidos")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Conexiones" }));
    expect(screen.getByText("OpenSubsonic")).toBeVisible();
    expect(container.querySelector(".settings-header")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Reproducción" }),
    ).not.toBeInTheDocument();
  });

  it("exposes functional interface preferences without a theme selector", () => {
    renderWithListenProviders(<Settings />, { locale: "en" });

    expect(
      screen.getByRole("region", { name: "Interface" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Appearance" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Crate Red")).not.toBeInTheDocument();
  });

  it("keeps the real playback controls inside a named instrument section", () => {
    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=playback",
    });

    const playback = screen.getByRole("region", { name: "Playback" });
    expect(playback.tagName).toBe("SECTION");
    expect(playback).toHaveClass(
      "border-t",
      "border-border-quiet",
      "@container",
    );
    expect(
      within(playback).getByRole("heading", { level: 2, name: "Playback" }),
    ).toBeInTheDocument();
    expect(
      within(playback).getByText(
        "These preferences shape how the player behaves between tracks.",
      ),
    ).toBeInTheDocument();
    expect(
      within(playback).getByRole("combobox", { name: "Stream quality" }),
    ).toHaveTextContent("Auto (recommended)");
    expect(within(playback).getByText("Crossfade")).toBeInTheDocument();
  });

  it("groups the actual sections into five panels with only the selected panel exposed", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings",
    });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Preferences",
      "Playback",
      "Account",
      "Connections",
      "Offline",
    ]);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Interface" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Shows" })).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Playback" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Playback" }));
    expect(screen.getByRole("region", { name: "Playback" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /^Sleep timer$/i }),
    ).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Connections" }));
    expect(screen.getByRole("heading", { name: "OpenSubsonic" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Scrobbling" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Bandcamp" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Account" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Offline" }));
    expect(
      screen.getByRole("heading", { name: "Offline mirror" }),
    ).toBeVisible();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  });

  it("separates profile, listening preferences and security within Account", async () => {
    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=account",
    });
    const profile = screen.getByRole("region", { name: "Profile" });
    const listening = screen.getByRole("region", {
      name: "Listening preferences",
    });
    const security = screen.getByRole("region", { name: "Security" });
    expect(
      screen.queryByRole("region", { name: "Quick links" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("tabpanel")).queryByRole("link", {
        name: "Public profile",
      }),
    ).not.toBeInTheDocument();
    const email = within(profile).getByRole("textbox", { name: "Email" });
    expect(email).toHaveAttribute("readonly");
    expect(within(profile).getAllByRole("textbox")[0]).toBe(email);
    expect(
      within(listening).getByRole("switch", { name: "Show me in Crate Pulse" }),
    ).toBeVisible();
    expect(
      within(security).getByRole("button", { name: "Change password" }),
    ).toBeVisible();
  });

  it("keeps the automatically detected timezone out of Account settings", () => {
    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=account",
      auth: { user: createMockAuthUser({ timezone: "America/New_York" }) },
    });
    expect(screen.queryByText("Listening timezone")).not.toBeInTheDocument();
    expect(screen.queryByText("America/New_York")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Use Europe/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Show me in Crate Pulse" }),
    ).toBeVisible();
  });

  it("keeps profile and password drafts when switching panels without saving", async () => {
    const user = userEvent.setup();
    const { api } = await import("@/lib/api");
    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=account",
    });
    const name = screen.getByRole("textbox", { name: "Display name" });
    await user.clear(name);
    await user.type(name, "Draft Mixed Case Name");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await user.type(
      screen.getByLabelText("Current password", { exact: true }),
      "draft only",
    );
    await user.click(screen.getByRole("tab", { name: "Playback" }));
    expect(
      screen.queryByRole("textbox", { name: "Display name" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Account" }));
    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue(
      "Draft Mixed Case Name",
    );
    expect(
      screen.getByLabelText("Current password", { exact: true }),
    ).toHaveValue("draft only");
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([, method]) => method && method !== "GET"),
    ).toEqual([]);
  });

  it("reads deep links and follows back/forward while preserving other query and hash", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(
      <>
        <Settings />
        <RouteProbe />
      </>,
      { locale: "en", route: "/settings?tab=account&source=library#profile" },
    );
    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("tab", { name: "Connections" }));
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/settings?tab=connections&source=library#profile",
    );
    await user.click(screen.getByRole("button", { name: "Previous tab" }));
    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Next tab" }));
    expect(screen.getByRole("tab", { name: "Connections" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("dismisses a hidden Connections confirmation on browser history without revoking credentials", async () => {
    credentialState.configured = true;
    const user = userEvent.setup();
    let navigate: NavigateFunction;
    renderWithListenProviders(
      <>
        <Settings />
        <RouteProbe
          onNavigate={(value) => {
            navigate = value;
          }}
        />
      </>,
      { locale: "en", route: "/settings?tab=account" },
    );
    await user.click(screen.getByRole("tab", { name: "Connections" }));
    await user.click(await screen.findByRole("button", { name: "Revoke key" }));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    await act(() => navigate(-1));
    expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await act(() => navigate(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      vi.mocked(api).mock.calls.filter(([, method]) => method === "DELETE"),
    ).toEqual([]);
  });

  it("dismisses hidden Select menus on history while retaining preference values", async () => {
    const user = userEvent.setup();
    let navigate: NavigateFunction;
    renderWithListenProviders(
      <>
        <Settings />
        <RouteProbe
          onNavigate={(value) => {
            navigate = value;
          }}
        />
      </>,
      { locale: "en", route: "/settings?tab=account" },
    );
    await user.click(screen.getByRole("tab", { name: "Playback" }));
    await user.click(screen.getByRole("combobox", { name: "Stream quality" }));
    expect(screen.getByRole("listbox")).toBeVisible();
    await act(() => navigate(-1));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await act(() => navigate(1));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Stream quality" }),
    ).toHaveTextContent("Auto (recommended)");
  });

  it("falls back to Preferences for unknown tabs without rewriting the URL", () => {
    renderWithListenProviders(
      <>
        <Settings />
        <RouteProbe />
      </>,
      { locale: "en", route: "/settings?tab=unknown&source=library" },
    );
    expect(screen.getByRole("tab", { name: "Preferences" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/settings?tab=unknown&source=library",
    );
  });

  it("changes and stores the selected Listen language", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(<Settings />, { locale: "en" });

    expect(
      screen.getByRole("combobox", { name: "App language" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "App language" }));
    await user.click(screen.getByRole("option", { name: /Español/i }));

    expect(localStorage.getItem("crate-listen-locale")).toBe("es");
    expect(
      await screen.findByRole("heading", { name: "Ajustes" }),
    ).toBeInTheDocument();
  });

  it("lets the user opt into automatic stream quality", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=playback",
    });

    const auto = screen.getByRole("combobox", { name: "Stream quality" });
    expect(auto).toHaveTextContent("Auto (recommended)");

    await user.click(auto);
    await user.click(screen.getByRole("option", { name: /^Original/i }));
    expect(localStorage.getItem("listen-player-delivery-policy")).toBe(
      "original",
    );

    await user.click(auto);
    await user.click(
      screen.getByRole("option", { name: /Auto \(recommended\)/i }),
    );
    expect(localStorage.getItem("listen-player-delivery-policy")).toBe("auto");
  });

  it("hides crossfade controls on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });

    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=playback",
    });

    expect(screen.queryByText("Crossfade")).not.toBeInTheDocument();
    expect(screen.queryByText("Smart transitions")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Enhanced mobile audio (EQ)"),
    ).not.toBeInTheDocument();
  });

  it("shows the native equalizer toggle on Android and defaults it on", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    androidNativePlayerState.enabled = true;
    const user = userEvent.setup();

    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=playback",
    });

    const toggle = screen.getByRole("switch", { name: "Equalizer" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);
    expect(localStorage.getItem("listen-eq-enabled")).toBe("false");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("keeps crossfade controls on desktop", () => {
    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=playback",
    });

    expect(screen.getByText("Crossfade")).toBeInTheDocument();
    expect(screen.getByText("Smart transitions")).toBeInTheDocument();
  });

  it("keeps remote scrobbling opt-in and persists an explicit toggle", async () => {
    const user = userEvent.setup();
    const { api } = await import("@/lib/api");

    renderWithListenProviders(<Settings />, {
      locale: "en",
      route: "/settings?tab=connections",
    });

    const toggle = await screen.findByRole("switch", {
      name: "Scrobble remote plays",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    expect(api).toHaveBeenCalledWith("/api/me/scrobble/preferences", "PUT", {
      remote_scrobbling_enabled: true,
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
