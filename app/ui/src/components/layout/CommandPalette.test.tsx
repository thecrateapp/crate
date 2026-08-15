import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { CommandPalette } from "./CommandPalette";

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: TestResizeObserver,
    configurable: true,
  });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

function mockAuth(capabilities: string[]) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 8,
      email: "fed-admin@example.test",
      name: "Federation Admin",
      role: "admin",
      capabilities,
    },
    loading: false,
    logout: vi.fn(),
    isAdmin: true,
    canAccessAdmin: true,
    hasCapability: vi.fn((capability: string) =>
      capabilities.includes(capability),
    ),
    hasAnyCapability: vi.fn((required: readonly string[]) =>
      required.some((capability) => capabilities.includes(capability)),
    ),
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CommandPalette", () => {
  it("filters navigation commands by current capabilities", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 2,
        email: "editor@example.test",
        name: "Editor",
        role: "editor",
        capabilities: ["library.view", "library.metadata.write"],
      },
      loading: false,
      logout: vi.fn(),
      isAdmin: false,
      canAccessAdmin: true,
      hasCapability: vi.fn((capability: string) =>
        ["library.view", "library.metadata.write"].includes(capability),
      ),
      hasAnyCapability: vi.fn((capabilities: readonly string[]) =>
        capabilities.some((capability) =>
          ["library.view", "library.metadata.write"].includes(capability),
        ),
      ),
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.getByText("Browse")).toBeInTheDocument();
    expect(screen.getByText("Discovery")).toBeInTheDocument();
    expect(screen.queryByText("Acquisition")).not.toBeInTheDocument();
    expect(screen.queryByText("Bandcamp")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    expect(screen.getByText("Enrich MusicBrainz IDs")).toBeInTheDocument();
    expect(screen.getByText("Sync Missing Lyrics")).toBeInTheDocument();
    expect(
      screen.queryByText("Analyze All Tracks (BPM, Key, Energy)"),
    ).not.toBeInTheDocument();
  });

  it("shows acquisition and Bandcamp surfaces to librarians without admin access", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 6,
        email: "librarian@example.test",
        name: "Librarian",
        role: "librarian",
        capabilities: [
          "library.view",
          "library.repair.run",
          "library.import.manage",
          "library.bandcamp.manage",
          "library.tidal.manage",
        ],
      },
      loading: false,
      logout: vi.fn(),
      isAdmin: false,
      canAccessAdmin: true,
      hasCapability: vi.fn((capability: string) =>
        [
          "library.view",
          "library.repair.run",
          "library.import.manage",
          "library.bandcamp.manage",
          "library.tidal.manage",
        ].includes(capability),
      ),
      hasAnyCapability: vi.fn((capabilities: readonly string[]) =>
        capabilities.some((capability) =>
          [
            "library.view",
            "library.repair.run",
            "library.import.manage",
            "library.bandcamp.manage",
            "library.tidal.manage",
          ].includes(capability),
        ),
      ),
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.getByText("Health")).toBeInTheDocument();
    expect(screen.getByText("Acquisition")).toBeInTheDocument();
    expect(screen.getByText("Bandcamp")).toBeInTheDocument();
    expect(screen.getByText("New Releases")).toBeInTheDocument();
    expect(screen.getByText("Sync Library")).toBeInTheDocument();
    expect(screen.getByText("Run Health Check")).toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("shows operational surfaces to ops roles without admin access", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 7,
        email: "ops@example.test",
        name: "Ops",
        role: "ops",
        capabilities: [
          "ops.health.view",
          "ops.logs.view",
          "ops.tasks.manage",
          "ops.runtime.manage",
        ],
      },
      loading: false,
      logout: vi.fn(),
      isAdmin: false,
      canAccessAdmin: true,
      hasCapability: vi.fn((capability: string) =>
        [
          "ops.health.view",
          "ops.logs.view",
          "ops.tasks.manage",
          "ops.runtime.manage",
        ].includes(capability),
      ),
      hasAnyCapability: vi.fn((capabilities: readonly string[]) =>
        capabilities.some((capability) =>
          [
            "ops.health.view",
            "ops.logs.view",
            "ops.tasks.manage",
            "ops.runtime.manage",
          ].includes(capability),
        ),
      ),
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Logs")).toBeInTheDocument();
    expect(screen.getByText("Stack")).toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("shows system playlists to playlist curators without admin access", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 3,
        email: "curator@example.test",
        name: "Curator",
        role: "curator",
        capabilities: ["library.view", "curation.playlists.write"],
      },
      loading: false,
      logout: vi.fn(),
      isAdmin: false,
      canAccessAdmin: true,
      hasCapability: vi.fn((capability: string) =>
        ["library.view", "curation.playlists.write"].includes(capability),
      ),
      hasAnyCapability: vi.fn((capabilities: readonly string[]) =>
        capabilities.some((capability) =>
          ["library.view", "curation.playlists.write"].includes(capability),
        ),
      ),
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByText("System Playlists")).toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("shows release and show surfaces to curation roles without admin access", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 4,
        email: "shows@example.test",
        name: "Shows",
        role: "curator",
        capabilities: ["library.view", "curation.shows.write"],
      },
      loading: false,
      logout: vi.fn(),
      isAdmin: false,
      canAccessAdmin: true,
      hasCapability: vi.fn((capability: string) =>
        ["library.view", "curation.shows.write"].includes(capability),
      ),
      hasAnyCapability: vi.fn((capabilities: readonly string[]) =>
        capabilities.some((capability) =>
          ["library.view", "curation.shows.write"].includes(capability),
        ),
      ),
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.queryByText("New Releases")).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("shows new releases to release curators without admin access", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 5,
        email: "releases@example.test",
        name: "Releases",
        role: "curator",
        capabilities: ["library.view", "curation.releases.write"],
      },
      loading: false,
      logout: vi.fn(),
      isAdmin: false,
      canAccessAdmin: true,
      hasCapability: vi.fn((capability: string) =>
        ["library.view", "curation.releases.write"].includes(capability),
      ),
      hasAnyCapability: vi.fn((capabilities: readonly string[]) =>
        capabilities.some((capability) =>
          ["library.view", "curation.releases.write"].includes(capability),
        ),
      ),
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByText("New Releases")).toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("shows federation surfaces and reconciliation tasks to federation admins", () => {
    mockAuth([
      "federation.nodes.view",
      "federation.catalog.sync.manage",
      "federation.policy.manage",
    ]);

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(screen.getByText("Federation")).toBeInTheDocument();
    expect(screen.getByText("Global Catalog")).toBeInTheDocument();
    expect(screen.getByText("Sync Federated Catalogs")).toBeInTheDocument();
    expect(screen.getByText("Reconcile Global Catalog")).toBeInTheDocument();
    expect(
      screen.getByText("Full Global Catalog Reconciliation"),
    ).toBeInTheDocument();
  });

  it("queues all-peer federation catalog sync from the palette", async () => {
    mockAuth(["federation.catalog.sync.manage"]);
    vi.mocked(api).mockResolvedValue({});

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("Sync Federated Catalogs"));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/federation/sync-catalog",
        "POST",
      ),
    );
  });

  it("queues global catalog reconciliation from the palette", async () => {
    mockAuth(["federation.policy.manage"]);
    vi.mocked(api).mockResolvedValue({});

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("Reconcile Global Catalog"));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/global-catalog/reconcile",
        "POST",
        { mode: "incremental" },
      ),
    );
  });

  it("queues the album release date backfill from the palette", async () => {
    mockAuth(["library.metadata.write"]);
    vi.mocked(api).mockResolvedValue({});

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("Backfill Album Release Dates"));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/manage/enrich-mbids", "POST", {
        release_dates_only: true,
      }),
    );
  });
});
