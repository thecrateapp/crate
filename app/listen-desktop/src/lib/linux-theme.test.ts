import { afterEach, describe, expect, it, vi } from "vitest";

type ThemeSnapshot = {
  scheme?: string;
  accent?: string;
  gtkTheme?: string;
  windowButtonLayout?: string;
  iconTheme?: string;
  cursorTheme?: string;
  fontName?: string;
  textScale?: number;
  source?: string[];
};

function installLinuxDom(invoke: ReturnType<typeof vi.fn>) {
  const styleValues = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) =>
        styleValues.set(name, value),
      removeProperty: (name: string) => styleValues.delete(name),
    },
  };
  const fakeWindow = Object.assign(new EventTarget(), {
    __crateTauriInvoke: invoke,
  });
  const fakeDocument = Object.assign(new EventTarget(), {
    documentElement: root,
    visibilityState: "visible",
  });

  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("navigator", { userAgent: "Mozilla Linux" });

  return { fakeDocument, fakeWindow, root, styleValues };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Linux desktop window preferences", () => {
  it("coalesces focus and visibility refreshes while one query is pending", async () => {
    let resolveSnapshot!: (snapshot: ThemeSnapshot) => void;
    const invoke = vi.fn(
      () =>
        new Promise<ThemeSnapshot>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const { fakeDocument, fakeWindow, root } = installLinuxDom(invoke);
    const { initLinuxDesktopTheme } = await import("./linux-theme");

    initLinuxDesktopTheme();
    fakeWindow.dispatchEvent(new Event("focus"));
    fakeDocument.dispatchEvent(new Event("visibilitychange"));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("linux_desktop_theme_snapshot");
    resolveSnapshot({ windowButtonLayout: "close,minimize:maximize" });
    await Promise.resolve();

    expect(root.dataset.crateLinuxWindowButtonLayout).toBe(
      "close,minimize:maximize",
    );
  });

  it.each(["dark", "light"])(
    "ignores all GTK visual preferences in a %s snapshot",
    async (scheme) => {
      const invoke = vi.fn().mockResolvedValue({
        scheme,
        accent: "#9141ac",
        gtkTheme: "Adwaita-dark",
        iconTheme: "Adwaita",
        cursorTheme: "Breeze",
        fontName: "Inter 10",
        textScale: 1.25,
        windowButtonLayout: "close:minimize,maximize",
        source: ["portal", "gsettings"],
      });
      const { root, styleValues } = installLinuxDom(invoke);
      const { initLinuxDesktopTheme } = await import("./linux-theme");

      initLinuxDesktopTheme();
      await Promise.resolve();
      await Promise.resolve();

      expect(root.dataset).toEqual({
        crateLinuxWindowButtonLayout: "close:minimize,maximize",
      });
      expect([...styleValues]).toEqual([]);
    },
  );

  it("keeps cached button placement when a later snapshot is partial", async () => {
    vi.useFakeTimers();
    const invoke = vi
      .fn<() => Promise<ThemeSnapshot | null>>()
      .mockResolvedValueOnce({ windowButtonLayout: "close:minimize,maximize" })
      .mockResolvedValueOnce({ scheme: "light", accent: "#9141ac" });
    const { fakeWindow, root, styleValues } = installLinuxDom(invoke);
    const { initLinuxDesktopTheme } = await import("./linux-theme");

    initLinuxDesktopTheme();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.dataset.crateLinuxWindowButtonLayout).toBe(
      "close:minimize,maximize",
    );

    fakeWindow.dispatchEvent(new Event("focus"));
    expect(invoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_001);
    fakeWindow.dispatchEvent(new Event("focus"));
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(root.dataset).toEqual({
      crateLinuxWindowButtonLayout: "close:minimize,maximize",
    });
    expect([...styleValues]).toEqual([]);
  });

  it("keeps the last valid button placement when the native bridge rejects", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const invoke = vi
      .fn<() => Promise<ThemeSnapshot | null>>()
      .mockResolvedValueOnce({ windowButtonLayout: ":minimize,maximize,close" })
      .mockRejectedValueOnce(new Error("portal unavailable"));
    const { fakeWindow, root } = installLinuxDom(invoke);
    const { initLinuxDesktopTheme } = await import("./linux-theme");

    initLinuxDesktopTheme();
    await Promise.resolve();
    expect(root.dataset.crateLinuxWindowButtonLayout).toBe(
      ":minimize,maximize,close",
    );

    await vi.advanceTimersByTimeAsync(1_001);
    fakeWindow.dispatchEvent(new Event("focus"));
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(root.dataset.crateLinuxWindowButtonLayout).toBe(
      ":minimize,maximize,close",
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
