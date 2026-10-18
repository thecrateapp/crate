import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, apiMock } = vi.hoisted(() => ({
  state: { signedIn: true, libraryView: true },
  apiMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: state.signedIn
      ? { id: 1, email: "sample@example.test", role: "admin" }
      : null,
    loading: false,
    canAccessAdmin: true,
    hasCapability: (capability: string) =>
      state.libraryView && capability === "library.view",
    hasAnyCapability: (required: readonly string[]) =>
      state.libraryView && required.includes("library.view"),
  }),
}));
vi.mock("@/hooks/use-llm", () => ({
  LLMStatusProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/contexts/OpsSnapshotContext", () => ({
  OpsSnapshotProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@/components/layout/Shell", async () => {
  const { Outlet } = await import("react-router");
  return { Shell: () => <Outlet /> };
});
vi.mock("@/pages/Browse", () => ({
  Browse: () => <h1>Browse destination</h1>,
}));
vi.mock("@/pages/Login", () => ({ Login: () => <h1>Sign in destination</h1> }));
// Unrelated data hooks stay isolated while the actual App router/gates run unchanged.
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({ data: null, loading: true, error: null, refetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ Toaster: () => null }));
import App from "./App";

beforeEach(() => {
  state.signedIn = true;
  state.libraryView = true;
  apiMock.mockReset().mockResolvedValue({ needs_setup: false });
  window.history.replaceState(null, "", "/timeline?year=2020#albums");
});
afterEach(cleanup);

describe("Library Timeline retirement", () => {
  it("replaces old Timeline URLs with Browse using the actual App router", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Browse destination" });
    expect(window.location.pathname).toBe("/browse");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.history.state.idx).toBe(0);
  });

  it("preserves authentication for old links", async () => {
    state.signedIn = false;
    render(<App />);
    await screen.findByRole("heading", { name: "Sign in destination" });
    expect(window.location.pathname).toBe("/login");
    expect(new URLSearchParams(window.location.search).get("redirect")).toBe(
      "/timeline?year=2020#albums",
    );
  });

  it("preserves the library capability gate rather than exposing another area", async () => {
    state.libraryView = false;
    render(<App />);
    await screen.findByRole("heading", { name: "Permission required" });
    expect(window.location.pathname).toBe("/timeline");
    expect(
      screen.queryByRole("heading", { name: "Browse destination" }),
    ).not.toBeInTheDocument();
  });

  it("removes the page/lazy import and its retired glyph exceptions", () => {
    const source = readFileSync(resolve("src/App.tsx"), "utf8");
    expect(source).not.toContain("@/pages/Timeline");
    expect(existsSync(resolve("src/pages/Timeline.tsx"))).toBe(false);
    expect(
      readFileSync(resolve("src/admin-icon-policy.test.ts"), "utf8"),
    ).not.toContain('"Timeline:timeline-');
  });

  it("keeps distinct release/artist timelines while retiring this destination", () => {
    const palette = readFileSync(
      resolve("src/components/layout/CommandPalette.tsx"),
      "utf8",
    );
    expect(palette).not.toContain('path: "/timeline"');
    expect(
      readFileSync(resolve("src/pages/NewReleases.tsx"), "utf8"),
    ).toContain("ReleaseTimelineRow");
    expect(
      readFileSync(resolve("src/components/artist/ArtistStats.tsx"), "utf8"),
    ).toContain("albums_timeline");
  });
});
