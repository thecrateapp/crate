import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  fetchCrateConnectPreferencesMock,
  registerCurrentConnectDeviceMock,
  setCrateConnectEnabledMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  fetchCrateConnectPreferencesMock: vi.fn(),
  registerCurrentConnectDeviceMock: vi.fn(),
  setCrateConnectEnabledMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/listen-device", () => ({
  getListenDeviceId: vi.fn(() => "phone"),
}));

vi.mock("@/lib/crate-connect", () => ({
  CRATE_CONNECT_FEATURE_ENABLED: true,
  CONNECT_ENABLED_EVENT: "crate:connect-enabled-changed",
  fetchCrateConnectPreferences: fetchCrateConnectPreferencesMock,
  isCrateConnectEnabled: vi.fn(() => true),
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
    fetchCrateConnectPreferencesMock.mockResolvedValue({ enabled: true });
    registerCurrentConnectDeviceMock.mockResolvedValue(undefined);
    setCrateConnectEnabledMock.mockResolvedValue({ enabled: false });
    apiMock.mockResolvedValueOnce({
      devices: [
        {
          device_id: "phone",
          device_label: "Phone",
          device_type: "web",
          app_platform: "listen-web",
          active: true,
          last_seen_at: "2026-05-25T10:00:00.000Z",
        },
        {
          device_id: "desktop",
          device_label: "Desktop",
          device_type: "desktop",
          app_platform: "listen-tauri",
          active: false,
          last_seen_at: "2026-05-25T09:00:00.000Z",
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists current, active, and recent Connect devices", async () => {
    render(<ConnectDevicesSection />);

    expect(await screen.findByText("Phone")).toBeVisible();
    expect(screen.getByText("Desktop")).toBeVisible();
    expect(screen.getByText("Current")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("Recent")).toBeVisible();
    expect(screen.getByRole("button", { name: "Forget Phone" })).toBeDisabled();
  });

  it("forgets a non-current device", async () => {
    apiMock.mockResolvedValueOnce({ ok: true });
    render(<ConnectDevicesSection />);

    await screen.findByText("Desktop");
    fireEvent.click(screen.getByRole("button", { name: "Forget Desktop" }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/me/devices/desktop", "DELETE"),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Device forgotten");
    expect(screen.queryByText("Desktop")).not.toBeInTheDocument();
  });

  it("lets the user disable Crate Connect globally", async () => {
    render(<ConnectDevicesSection />);

    await screen.findByText("Phone");
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));

    await waitFor(() =>
      expect(setCrateConnectEnabledMock).toHaveBeenCalledWith(false),
    );
    expect(registerCurrentConnectDeviceMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Crate Connect disabled");
  });
});
