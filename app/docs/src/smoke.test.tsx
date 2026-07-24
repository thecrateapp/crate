/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import App from "./App";

afterEach(() => {
  cleanup();
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
});
