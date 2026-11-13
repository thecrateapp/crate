import { describe, expect, it, vi } from "vitest";

import {
  trackWindowActivity,
  type WindowActivitySource,
} from "./window-activity";

function fakeWindow({
  focused = true,
  minimized = false,
}: { focused?: boolean; minimized?: boolean } = {}) {
  let focusHandler: ((event: { payload: boolean }) => void) | null = null;
  let resizeHandler: (() => void) | null = null;
  const state = { focused, minimized };
  const unlistenFocus = vi.fn();
  const unlistenResize = vi.fn();
  const source: WindowActivitySource = {
    isFocused: vi.fn(async () => state.focused),
    isMinimized: vi.fn(async () => state.minimized),
    onFocusChanged: vi.fn(async (handler) => {
      focusHandler = handler;
      return unlistenFocus;
    }),
    onResized: vi.fn(async (handler) => {
      resizeHandler = handler;
      return unlistenResize;
    }),
  };
  return {
    source,
    state,
    unlistenFocus,
    unlistenResize,
    focus(next: boolean) {
      state.focused = next;
      focusHandler?.({ payload: next });
    },
    resize() {
      resizeHandler?.();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("trackWindowActivity", () => {
  it("starts active when the window is focused", async () => {
    const win = fakeWindow();
    const setInactive = vi.fn();

    await trackWindowActivity(win.source, setInactive);

    expect(setInactive).toHaveBeenLastCalledWith(false);
  });

  it("starts inactive when the window opens unfocused", async () => {
    const win = fakeWindow({ focused: false });
    const setInactive = vi.fn();

    await trackWindowActivity(win.source, setInactive);

    expect(setInactive).toHaveBeenLastCalledWith(true);
  });

  it("pauses motion on blur and resumes it on focus", async () => {
    const win = fakeWindow();
    const setInactive = vi.fn();
    await trackWindowActivity(win.source, setInactive);

    win.focus(false);
    expect(setInactive).toHaveBeenLastCalledWith(true);

    win.focus(true);
    await flush();
    expect(setInactive).toHaveBeenLastCalledWith(false);
  });

  it("stays inactive while minimised, then resumes when restored", async () => {
    const win = fakeWindow();
    const setInactive = vi.fn();
    await trackWindowActivity(win.source, setInactive);

    win.state.minimized = true;
    win.resize();
    await flush();
    expect(setInactive).toHaveBeenLastCalledWith(true);

    win.state.minimized = false;
    win.focus(true);
    await flush();
    expect(setInactive).toHaveBeenLastCalledWith(false);
  });

  it("never freezes motion when the window API fails", async () => {
    const win = fakeWindow();
    win.source.onFocusChanged = vi.fn(async () => {
      throw new Error("denied");
    });
    const setInactive = vi.fn();

    await trackWindowActivity(win.source, setInactive);

    expect(setInactive).toHaveBeenLastCalledWith(false);
  });

  it("releases its listeners and reactivates motion on dispose", async () => {
    const win = fakeWindow({ focused: false });
    const setInactive = vi.fn();
    const dispose = await trackWindowActivity(win.source, setInactive);

    dispose();

    expect(win.unlistenFocus).toHaveBeenCalled();
    expect(win.unlistenResize).toHaveBeenCalled();
    expect(setInactive).toHaveBeenLastCalledWith(false);
  });
});
