/**
 * @vitest-environment jsdom
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState(null, "", "/");
});

describe("docs app", () => {
  it("renders the home page", () => {
    render(<App />);

    expect(screen.getByText("Crate Documentation")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /start with the system overview/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /source on github/i }),
    ).toBeTruthy();
  });

  it("groups canonical documents by their published section", () => {
    window.history.pushState(null, "", "/federation");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /federation documentation/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/database index audit/i)).toBeNull();
  });

  it("renders a federation deep link and resolves its Markdown links", async () => {
    window.history.pushState(null, "", "/federation/federation-overview");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /federation overview/i }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("link", {
          name: /federation production acceptance/i,
        }) as HTMLAnchorElement
      ).getAttribute("href"),
    ).toBe("/federation/federation-production-acceptance");
  });

  it("does not publish historical technical audit routes", () => {
    window.history.pushState(
      null,
      "",
      "/technical/2026-04-22-database-index-audit",
    );
    render(<App />);

    expect(screen.getByText("Crate Documentation")).toBeTruthy();
  });

  it("redirects to home for unknown doc routes", () => {
    window.history.pushState(null, "", "/nonexistent/nope");
    render(<App />);

    expect(screen.getByText("Crate Documentation")).toBeTruthy();
  });

  it("links the site navigation back to cratemusic.app with Docs current", () => {
    render(<App />);

    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(primary)
        .getByRole("link", { name: "Listen" })
        .getAttribute("href"),
    ).toBe("https://cratemusic.app/listen");
    expect(
      within(primary)
        .getByRole("link", { name: "Docs" })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("marks the current document in the sidebar", async () => {
    window.history.pushState(null, "", "/federation/federation-overview");
    render(<App />);

    const index = screen.getByRole("navigation", { name: "Documentation" });
    expect(
      within(index)
        .getByRole("link", { name: "Federation overview" })
        .getAttribute("aria-current"),
    ).toBe("page");
    await screen.findByRole("heading", {
      name: /federation overview/i,
      level: 1,
    });
  });

  it("filters the documentation index from the search box", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Search documentation"), {
      target: { value: "zzz-no-match" },
    });
    expect(screen.getByText(/no documents match/i)).toBeTruthy();
  });

  it("opens the mobile menu as a dialog and closes it with Escape", () => {
    render(<App />);

    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Close" }),
    );
    expect(document.documentElement.classList.contains("menu-open")).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(document.documentElement.classList.contains("menu-open")).toBe(
      false,
    );
  });

  it("scrolls the sidebar to the current document when it is out of view", () => {
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("aria-current") === "page" ? 1200 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    window.history.pushState(null, "", "/federation/federation-overview");
    const { container } = render(<App />);

    expect(container.querySelector<HTMLElement>(".sidebar")?.scrollTop).toBe(
      1000,
    );
  });
});
