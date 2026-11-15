import { describe, expect, it, vi } from "vitest";

import {
  applyLinuxDesktopProfile,
  loadLinuxDesktopProfile,
  parseLinuxDesktopProfile,
} from "./linux-desktop-profile";

describe("linux desktop profile", () => {
  it("loads the profile from the native command", async () => {
    const invoke = vi.fn().mockResolvedValue({
      compositor: "hyprland",
      tiling: true,
    });
    await expect(loadLinuxDesktopProfile(invoke)).resolves.toEqual({
      compositor: "hyprland",
      tiling: true,
    });
    expect(invoke).toHaveBeenCalledWith("linux_desktop_profile");
  });

  it("falls back to null without a shell or on an older shell", async () => {
    await expect(loadLinuxDesktopProfile(undefined)).resolves.toBeNull();
    const invoke = vi.fn().mockRejectedValue(new Error("unknown command"));
    await expect(loadLinuxDesktopProfile(invoke)).resolves.toBeNull();
  });

  it("rejects malformed payloads and sanitises the compositor name", () => {
    expect(parseLinuxDesktopProfile(null)).toBeNull();
    expect(parseLinuxDesktopProfile({ compositor: "gnome" })).toBeNull();
    expect(
      parseLinuxDesktopProfile({ compositor: "<script>", tiling: false }),
    ).toEqual({ compositor: "other", tiling: false });
    // fields an older shell still sends are not carried along
    expect(
      parseLinuxDesktopProfile({
        compositor: "niri",
        tiling: true,
        ryoku: true,
      }),
    ).toEqual({ compositor: "niri", tiling: true });
  });

  it("drops the titlebar on a tiling compositor", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    const result = applyLinuxDesktopProfile(
      { compositor: "niri", tiling: true },
      root,
    );
    expect(result.showTitlebar).toBe(false);
    expect(root.dataset).toEqual({
      crateLinuxWm: "tiling",
      crateLinuxCompositor: "niri",
    });
  });

  it("keeps the titlebar on a floating desktop and without a profile", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    expect(
      applyLinuxDesktopProfile({ compositor: "gnome", tiling: false }, root)
        .showTitlebar,
    ).toBe(true);
    expect(root.dataset.crateLinuxWm).toBe("floating");

    const untouched = { dataset: {} as Record<string, string | undefined> };
    expect(applyLinuxDesktopProfile(null, untouched).showTitlebar).toBe(true);
    expect(untouched.dataset).toEqual({});
  });
});
