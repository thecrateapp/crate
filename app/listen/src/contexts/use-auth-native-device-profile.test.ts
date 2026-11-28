import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContextValue, AuthUser } from "@/contexts/auth-context";

const { device, serverState } = vi.hoisted(() => ({
  device: {
    runtime: true,
    sync: vi.fn(),
    retire: vi.fn(),
    update: vi.fn(),
    handleChange: vi.fn(),
    listeners: [] as Array<(status: { hasProfile: boolean }) => void>,
    unsubscribe: vi.fn(),
  },
  serverState: { id: "server-1" as string | null },
}));

vi.mock("@/lib/native-device-profile", () => ({
  isNativeDeviceProfileRuntime: () => device.runtime,
  syncNativeDeviceProfile: device.sync,
  retireNativeDeviceProfile: device.retire,
  updateNativeDeviceProfilePreferences: device.update,
  handleNativeDeviceProfileChange: device.handleChange,
  subscribeNativeDeviceProfileChanges: (
    listener: (status: { hasProfile: boolean }) => void,
  ) => {
    device.listeners.push(listener);
    return device.unsubscribe;
  },
}));
vi.mock("@/lib/server-store", () => ({
  getCurrentServerId: () => serverState.id,
}));
vi.mock("@/lib/offline-storage", () => ({
  OFFLINE_ACTIVE_PROFILE_EVENT: "crate:offline-active-profile",
}));
vi.mock("@/lib/player-playback-prefs", () => ({
  PLAYER_PLAYBACK_PREFS_EVENT: "listen-player-playback-prefs",
}));

import { useAuthNativeDeviceProfile } from "@/contexts/use-auth-native-device-profile";

type Props = {
  user: AuthUser | null;
  accessMode: AuthContextValue["accessMode"];
};

function user(id: number): AuthUser {
  return { id, email: `${id}@example.test`, name: null, role: "user" };
}

function renderProfileHook(initial: Props) {
  return renderHook(
    ({ user: current, accessMode }: Props) =>
      useAuthNativeDeviceProfile(current, accessMode),
    { initialProps: initial },
  );
}

describe("useAuthNativeDeviceProfile", () => {
  beforeEach(() => {
    device.runtime = true;
    device.listeners = [];
    serverState.id = "server-1";
    for (const mock of [
      device.sync,
      device.retire,
      device.update,
      device.handleChange,
      device.unsubscribe,
    ]) {
      mock.mockReset();
      mock.mockResolvedValue(undefined);
    }
  });

  it("syncs after sign-in and verifies once per server and user", () => {
    const hook = renderProfileHook({
      user: user(1),
      accessMode: "authenticated",
    });
    expect(device.sync).toHaveBeenLastCalledWith({ verify: true });

    hook.rerender({ user: { ...user(1) }, accessMode: "authenticated" });
    expect(device.sync).toHaveBeenLastCalledWith({ verify: false });

    serverState.id = "server-2";
    hook.rerender({ user: user(1), accessMode: "authenticated" });
    expect(device.sync).toHaveBeenLastCalledWith({ verify: true });
    expect(device.retire).not.toHaveBeenCalled();
  });

  it("retires the profile when the session is gone", () => {
    const hook = renderProfileHook({ user: null, accessMode: "loading" });
    hook.rerender({ user: null, accessMode: "offline" });
    expect(device.retire).not.toHaveBeenCalled();

    hook.rerender({ user: null, accessMode: "unauthenticated" });
    expect(device.retire).toHaveBeenCalledTimes(1);
    expect(device.sync).not.toHaveBeenCalled();
  });

  it("pushes delivery and offline profile changes", () => {
    renderProfileHook({ user: user(1), accessMode: "authenticated" });

    window.dispatchEvent(
      new CustomEvent("listen-player-playback-prefs", {
        detail: { crossfadeSeconds: 4 },
      }),
    );
    expect(device.update).not.toHaveBeenCalled();
    window.dispatchEvent(
      new CustomEvent("listen-player-playback-prefs", {
        detail: { playbackDeliveryPolicy: "data_saver" },
      }),
    );
    window.dispatchEvent(new CustomEvent("crate:offline-active-profile"));

    expect(device.update).toHaveBeenCalledTimes(2);
  });

  it("hands native profile changes to the module and unsubscribes", () => {
    const hook = renderProfileHook({
      user: user(1),
      accessMode: "authenticated",
    });
    device.listeners[0]?.({ hasProfile: false });
    expect(device.handleChange).toHaveBeenCalledWith({ hasProfile: false });

    hook.rerender({ user: null, accessMode: "unauthenticated" });
    expect(device.unsubscribe).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent("crate:offline-active-profile"));
    expect(device.update).not.toHaveBeenCalled();
  });

  it("does nothing off the Android runtime", () => {
    device.runtime = false;
    const hook = renderProfileHook({
      user: user(1),
      accessMode: "authenticated",
    });
    hook.rerender({ user: null, accessMode: "unauthenticated" });
    window.dispatchEvent(new CustomEvent("crate:offline-active-profile"));

    expect(device.sync).not.toHaveBeenCalled();
    expect(device.retire).not.toHaveBeenCalled();
    expect(device.update).not.toHaveBeenCalled();
    expect(device.listeners).toHaveLength(0);
  });
});
