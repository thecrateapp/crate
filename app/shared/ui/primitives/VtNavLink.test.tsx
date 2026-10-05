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

  it("keeps view transitions outside the transparent Linux Tauri window", () => {
    const startViewTransition = installViewTransition();
    renderNavigation();

    fireEvent.click(screen.getByRole("link", { name: "Library" }));

    expect(screen.getByTestId("current-path").textContent).toBe("/library");
    expect(startViewTransition).toHaveBeenCalledTimes(1);
  });
});
