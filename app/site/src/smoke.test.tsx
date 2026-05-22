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

describe("site routes", () => {
  it("renders the stripped home page", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: /crate is not a streaming service/i,
      }),
    ).toBeTruthy();
    expect(screen.getByText(/cratemusic\.app\/install\.sh/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Quickstart" })).toBeTruthy();

    const docsLinks = screen.getAllByRole("link", { name: "Docs" });
    expect(docsLinks.length).toBe(2);

    const manifestoLinks = screen.getAllByRole("link", { name: "Manifesto" });
    expect(manifestoLinks.length).toBe(2);

    expect(screen.queryByRole("link", { name: "Why Crate" })).toBeNull();
  });

  it("keeps the page reduced to header, hero, and footer content", () => {
    render(<App />);

    expect(screen.queryByText(/not everyone should run this/i)).toBeNull();
    expect(screen.queryByText(/pick one concrete thing/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /screenshots/i })).toBeNull();
  });

  it("shows the installer transparency note", () => {
    render(<App />);

    expect(screen.getByText(/installs crate server on linux/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /read the source/i })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /read the manifesto/i }),
    ).toBeTruthy();
  });

  it("keeps the manifesto route available from the header", () => {
    window.history.pushState(null, "", "/why");

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "The Crate Manifesto" }),
    ).toBeTruthy();
  });

  it("renders manifesto separators with key phrases", () => {
    window.history.pushState(null, "", "/why");

    render(<App />);

    expect(screen.getByText(/the system is not broken/i)).toBeTruthy();
    const biggerThanMusic = screen.getAllByText(/this is bigger than music/i);
    expect(biggerThanMusic.length).toBe(2);
    expect(screen.getByText(/the manifesto is the start/i)).toBeTruthy();
  });

  it("does not restore removed content routes", () => {
    window.history.pushState(null, "", "/screenshots");

    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: /crate is not a streaming service/i,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /current captures/i }),
    ).toBeNull();
  });

  it("does not restore the why crate route", () => {
    window.history.pushState(null, "", "/why-crate");

    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: /crate is not a streaming service/i,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /why i started building this/i }),
    ).toBeNull();
  });
});
