// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VtNavLink } from "./VtNavLink";

function CurrentPath() {
  return <span data-testid="current-path">{useLocation().pathname}</span>;
}

function renderNavigation() {
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <VtNavLink to="/library">Library</VtNavLink>
      <CurrentPath />
    </MemoryRouter>,
  );
}

function installViewTransition() {
  const startViewTransition = vi.fn((update: () => void) => {
    update();
    return {} as ViewTransition;
  });

  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: startViewTransition,
  });

  return startViewTransition;
}

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.crateLinuxWindowChrome;
  Reflect.deleteProperty(document, "startViewTransition");
  vi.restoreAllMocks();
});

describe("VtNavLink", () => {
  it("navigates without a view transition in the transparent Linux Tauri window", () => {
    document.documentElement.dataset.crateLinuxWindowChrome = "true";
    const startViewTransition = installViewTransition();
    renderNavigation();

    fireEvent.click(screen.getByRole("link", { name: "Library" }));

    expect(screen.getByTestId("current-path").textContent).toBe("/library");
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("handles transitions the browser skips so they are not unhandled rejections", async () => {
    // CRATE-LISTEN-1F: WebKit aborts the animation when the viewport resizes.
    const skipped = () =>
      Promise.reject(
        new DOMException(
          "Transition was aborted because of invalid state. Viewport size changed",
          "InvalidStateError",
        ),
      );
    const ready = skipped();
    const finished = skipped();
    const updateCallbackDone = Promise.resolve();
    const readyCatch = vi.spyOn(ready, "catch");
    const finishedCatch = vi.spyOn(finished, "catch");
    const updateCatch = vi.spyOn(updateCallbackDone, "catch");
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        update();
        return {
          ready,
          finished,
          updateCallbackDone,
        } as unknown as ViewTransition;
      }),
    });
    renderNavigation();

    fireEvent.click(screen.getByRole("link", { name: "Library" }));

    expect(screen.getByTestId("current-path").textContent).toBe("/library");
    expect(readyCatch).toHaveBeenCalledOnce();
    expect(finishedCatch).toHaveBeenCalledOnce();
    // A failing navigation callback must still surface.
    expect(updateCatch).not.toHaveBeenCalled();
    await expect(ready.catch(() => "handled")).resolves.toBe("handled");
  });

  it("keeps view transitions outside the transparent Linux Tauri window", () => {
    const startViewTransition = installViewTransition();
    renderNavigation();

    fireEvent.click(screen.getByRole("link", { name: "Library" }));

    expect(screen.getByTestId("current-path").textContent).toBe("/library");
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });
});
