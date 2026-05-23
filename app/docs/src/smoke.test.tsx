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

  it("renders the technical section page", () => {
    window.history.pushState(null, "", "/technical");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /technical documentation/i }),
    ).toBeTruthy();
  });

  it("redirects to home for unknown doc routes", () => {
    window.history.pushState(null, "", "/nonexistent/nope");
    render(<App />);

    expect(screen.getByText("Crate Documentation")).toBeTruthy();
  });
});
