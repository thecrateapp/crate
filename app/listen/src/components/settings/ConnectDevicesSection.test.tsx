import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  fetchCrateConnectPreferencesMock,
  registerCurrentConnectDeviceMock,
  refreshCrateConnectPreferencesMock,
  setCrateConnectEnabledMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  fetchCrateConnectPreferencesMock: vi.fn(),
  registerCurrentConnectDeviceMock: vi.fn(),
  refreshCrateConnectPreferencesMock: vi.fn(),
  setCrateConnectEnabledMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/listen-device", () => ({
  formatCrateAppPlatform: vi.fn((appPlatform?: string | null) => {
    if (appPlatform === "listen-tauri") return "Desktop app";
    if (appPlatform === "listen-web") return "Web app";
    return appPlatform || null;
  }),
  formatCrateDeviceName: vi.fn(
    (device: { app_platform?: string | null; device_label?: string | null }) =>
      device.device_label ||
      (device.app_platform === "listen-tauri"
        ? "Crate Desktop"
        : "Crate device"),
  ),
  formatCrateDeviceType: vi.fn((deviceType?: string | null) => {
    if (deviceType === "desktop") return "Desktop";
    if (deviceType === "web") return "Browser";
    return deviceType || null;
  }),
  getListenDeviceId: vi.fn(() => "phone"),
}));

vi.mock("@/lib/crate-connect", () => ({
  CRATE_CONNECT_FEATURE_ENABLED: true,
  CONNECT_ENABLED_EVENT: "crate:connect-enabled-changed",
  fetchCrateConnectPreferences: fetchCrateConnectPreferencesMock,
  isCrateConnectEnabled: vi.fn(() => true),
  refreshCrateConnectPreferences: refreshCrateConnectPreferencesMock,
  resetCrateConnectPreferences: vi.fn(),
  setCrateConnectEnabled: setCrateConnectEnabledMock,
}));

vi.mock("@/lib/remote-playback-state", () => ({
  registerCurrentConnectDevice: registerCurrentConnectDeviceMock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

import { ConnectDevicesSection } from "@/components/settings/ConnectDevicesSection";

describe("ConnectDevicesSection", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-25T10:01:00.000Z").getTime(),
    );
    fetchCrateConnectPreferencesMock.mockResolvedValue({ enabled: true });
    registerCurrentConnectDeviceMock.mockResolvedValue(undefined);
    setCrateConnectEnabledMock.mockResolvedValue({ enabled: false });
    apiMock.mockResolvedValueOnce({
      devices: [
        {
          device_id: "phone",
          device_label: "Crate on Mobile Chrome (Android)",
          device_type: "web",
          app_platform: "listen-web",
          active: true,
          last_seen_at: "2026-05-25T10:00:00.000Z",
        },
        {
          device_id: "desktop",
          device_label: "Crate Desktop",
          device_type: "desktop",
          app_platform: "listen-tauri",
          active: false,
          last_seen_at: "2026-05-25T10:00:30.000Z",
        },
        {
          device_id: "old-tablet",
          device_label: "Crate on iPad",
          device_type: "web",
          app_platform: "listen-web",
          active: false,
          last_seen_at: "2026-05-25T09:00:00.000Z",
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("lists current, active, and recent Connect devices", async () => {
    render(<ConnectDevicesSection />);

    expect(
      await screen.findByText("Crate on Mobile Chrome (Android)"),
    ).toBeVisible();
    expect(screen.getByText("Crate Desktop")).toBeVisible();
    expect(screen.getByText("Current")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("Recent")).toBeVisible();
    expect(screen.queryByText("Crate on iPad")).not.toBeInTheDocument();
    expect(screen.queryByText("listen-web")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Revoke Crate on Mobile Chrome (Android)",
      }),
    ).toBeDisabled();
  });

  it("revokes a non-current device", async () => {
    apiMock.mockResolvedValueOnce({ ok: true });
    render(<ConnectDevicesSection />);

    await screen.findByText("Crate Desktop");
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke Crate Desktop" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/me/devices/desktop", "DELETE"),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Device revoked");
    expect(screen.queryByText("Crate Desktop")).not.toBeInTheDocument();
  });

  it("lets the user disable Crate Connect globally", async () => {
    render(<ConnectDevicesSection />);

    await screen.findByText("Crate on Mobile Chrome (Android)");
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));

    await waitFor(() =>
      expect(setCrateConnectEnabledMock).toHaveBeenCalledWith(false),
    );
    expect(registerCurrentConnectDeviceMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Crate Connect disabled");
  });
});
