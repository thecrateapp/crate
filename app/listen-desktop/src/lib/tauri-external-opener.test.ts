import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { installTauriExternalOpenerBridge } from "./tauri-init";

type TauriOpenerWindow = Window & {
  __crateOpenExternalUrl?: (url: string) => Promise<void>;
};

afterEach(() => {
  vi.unstubAllGlobals();
  openUrl.mockReset();
  openUrl.mockResolvedValue(undefined);
});

describe("Tauri external opener bridge", () => {
  it("loads the opener plugin only when an external link is requested", async () => {
    const tauriWindow = {} as TauriOpenerWindow;
    vi.stubGlobal("window", tauriWindow);
    installTauriExternalOpenerBridge();

    await tauriWindow.__crateOpenExternalUrl?.(
      "https://bandcamp.com/album/example",
    );

    expect(openUrl).toHaveBeenCalledWith("https://bandcamp.com/album/example");
  });

  it("propagates native opener failures", async () => {
    const tauriWindow = {} as TauriOpenerWindow;
    vi.stubGlobal("window", tauriWindow);
    openUrl.mockRejectedValue(new Error("opener failed"));
    installTauriExternalOpenerBridge();

    await expect(
      tauriWindow.__crateOpenExternalUrl?.(
        "https://bandcamp.com/album/example",
      ),
    ).rejects.toThrow("opener failed");
  });
});
