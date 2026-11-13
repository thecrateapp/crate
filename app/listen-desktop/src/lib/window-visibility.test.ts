import { describe, expect, it, vi } from "vitest";

import {
  trackWindowVisibility,
  type WindowVisibilitySource,
} from "./window-visibility";

function fakeShell({
  visible = true as boolean | null,
  minimized = false,
}: { visible?: boolean | null; minimized?: boolean } = {}) {
  let visibilityHandler: ((visible: boolean) => void) | null = null;
  let resizeHandler: (() => void) | null = null;
  const state = { visible, minimized };
  const unlistenVisibility = vi.fn();
  const unlistenResize = vi.fn();
  const source: WindowVisibilitySource = {
    isMinimized: vi.fn(async () => state.minimized),
    onResized: vi.fn(async (handler) => {
      resizeHandler = handler;
      return unlistenResize;
    }),
    queryVisibility: vi.fn(async () => state.visible),
    onVisibilityChanged: vi.fn(async (handler) => {
      visibilityHandler = handler;
      return unlistenVisibility;
    }),
  };
  return {
    source,
    state,
    unlistenVisibility,
    unlistenResize,
    report(next: boolean) {
      state.visible = next;
      visibilityHandler?.(next);
    },
    resize() {
      resizeHandler?.();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("trackWindowVisibility", () => {
  it("keeps motion on while the compositor shows the window", async () => {
    const shell = fakeShell({ visible: true });
    const setHidden = vi.fn();

    await trackWindowVisibility(shell.source, setHidden);

    expect(setHidden).toHaveBeenLastCalledWith(false);
  });

  it("keeps motion on when the compositor cannot tell", async () => {
    const shell = fakeShell({ visible: null });
    const setHidden = vi.fn();

    await trackWindowVisibility(shell.source, setHidden);

    expect(setHidden).toHaveBeenLastCalledWith(false);
  });

  it("does not depend on focus: only visibility reports change it", async () => {
    const shell = fakeShell();
    const setHidden = vi.fn();
    await trackWindowVisibility(shell.source, setHidden);
    expect(shell.source).not.toHaveProperty("onFocusChanged");

    shell.report(false);
    expect(setHidden).toHaveBeenLastCalledWith(true);

    shell.report(true);
    await flush();
    expect(setHidden).toHaveBeenLastCalledWith(false);
  });

  it("starts hidden when the window opens on an unseen workspace", async () => {
    const shell = fakeShell({ visible: false });
    const setHidden = vi.fn();

    await trackWindowVisibility(shell.source, setHidden);

    expect(setHidden).toHaveBeenLastCalledWith(true);
  });

  it("treats a minimised window as hidden until it is restored", async () => {
    const shell = fakeShell();
    const setHidden = vi.fn();
    await trackWindowVisibility(shell.source, setHidden);

    shell.state.minimized = true;
    shell.resize();
    await flush();
    expect(setHidden).toHaveBeenLastCalledWith(true);

    shell.state.minimized = false;
    shell.resize();
    await flush();
    expect(setHidden).toHaveBeenLastCalledWith(false);
  });

  it("never freezes motion when the shell bridge fails", async () => {
    const shell = fakeShell({ visible: false });
    shell.source.onVisibilityChanged = vi.fn(async () => {
      throw new Error("denied");
    });
    const setHidden = vi.fn();

    await trackWindowVisibility(shell.source, setHidden);

    expect(setHidden).toHaveBeenLastCalledWith(false);
  });

  it("releases its listeners and shows motion again on dispose", async () => {
    const shell = fakeShell({ visible: false });
    const setHidden = vi.fn();
    const dispose = await trackWindowVisibility(shell.source, setHidden);

    dispose();

    expect(shell.unlistenVisibility).toHaveBeenCalled();
    expect(shell.unlistenResize).toHaveBeenCalled();
    expect(setHidden).toHaveBeenLastCalledWith(false);
  });
});
