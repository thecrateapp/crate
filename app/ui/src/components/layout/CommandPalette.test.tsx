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
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { resetTaskCatalogForTests } from "@/lib/task-catalog";
import { toast } from "sonner";
import {
  CommandPalette,
  describeActionResult,
  matchesCommandQuery,
} from "./CommandPalette";

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

function catalogAction(
  id: string,
  label: string,
  path: string,
  capability: string,
  body: Record<string, unknown> | null = null,
) {
  return {
    id,
    label,
    task_type: id,
    task_label: label,
    category: "library",
    path,
    capability,
    icon: "sparkles",
    body,
  };
}

const TASK_CATALOG = {
  categories: { library: "Library" },
  types: [],
  actions: [
    catalogAction(
      "sync-library",
      "Sync Library",
      "/api/tasks/sync-library",
      "library.import.manage",
    ),
    catalogAction(
      "sync-federated-catalogs",
      "Sync Federated Catalogs",
      "/api/admin/federation/sync-catalog",
      "federation.catalog.sync.manage",
    ),
    catalogAction(
      "reconcile-global-catalog",
      "Reconcile Global Catalog",
      "/api/admin/global-catalog/reconcile",
      "federation.policy.manage",
      { mode: "incremental" },
    ),
    catalogAction(
      "reconcile-global-catalog-full",
      "Full Global Catalog Reconciliation",
      "/api/admin/global-catalog/reconcile",
      "federation.policy.manage",
      { mode: "full" },
    ),
    catalogAction(
      "health-check",
      "Run Health Check",
      "/api/manage/health-check",
      "library.repair.run",
    ),
    catalogAction(
      "remove-duplicate-tracks",
      "Remove Duplicate Tracks",
      "/api/manage/repair-duplicate-tracks",
      "library.repair.run",
    ),
    catalogAction(
      "analyze-all",
      "Analyze All Tracks (BPM, Key, Energy)",
      "/api/manage/analyze-all",
      "library.analysis.manage",
    ),
    catalogAction(
      "enrich-mbids",
      "Enrich MusicBrainz IDs",
      "/api/manage/enrich-mbids",
      "library.metadata.write",
    ),
    catalogAction(
      "backfill-release-dates",
      "Backfill Album Release Dates",
      "/api/manage/enrich-mbids",
      "library.metadata.write",
      { release_dates_only: true },
    ),
    catalogAction(
      "sync-lyrics",
      "Sync Missing Lyrics",
      "/api/manage/sync-lyrics",
      "library.metadata.write",
      { limit: 1000 },
    ),
  ],
};

function mockApi(result: unknown = {}) {
  vi.mocked(api).mockImplementation(async (path: string) =>
    path === "/api/admin/task-catalog" ? TASK_CATALOG : result,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTaskCatalogForTests();
  mockApi();
});

describe("CommandPalette", () => {
  it("filters navigation commands by current capabilities", async () => {
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
    expect(
      await screen.findByText("Enrich MusicBrainz IDs"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Sync Missing Lyrics")).toBeInTheDocument();
    expect(
      screen.queryByText("Analyze All Tracks (BPM, Key, Energy)"),
    ).not.toBeInTheDocument();
  });

  it("shows acquisition and Bandcamp surfaces to librarians without admin access", async () => {
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
    expect(await screen.findByText("Sync Library")).toBeInTheDocument();
    expect(await screen.findByText("Run Health Check")).toBeInTheDocument();
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

  it("shows federation surfaces and reconciliation tasks to federation admins", async () => {
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
    expect(
      await screen.findByText("Sync Federated Catalogs"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Reconcile Global Catalog"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Full Global Catalog Reconciliation"),
    ).toBeInTheDocument();
  });

  it("queues all-peer federation catalog sync from the palette", async () => {
    mockAuth(["federation.catalog.sync.manage"]);
    mockApi();

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByText("Sync Federated Catalogs"));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/api/admin/federation/sync-catalog",
        "POST",
      ),
    );
  });

  it("queues global catalog reconciliation from the palette", async () => {
    mockAuth(["federation.policy.manage"]);
    mockApi();

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByText("Reconcile Global Catalog"));

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
    mockApi();

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByText("Backfill Album Release Dates"));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/api/manage/enrich-mbids", "POST", {
        release_dates_only: true,
      }),
    );
  });

  it("opens as an accessible modal dialog", () => {
    mockAuth(["admin.access", "library.repair.run"]);
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(
      screen.getByRole("dialog", { name: "Command palette" }),
    ).toBeInTheDocument();
  });

  it("finds actions and pages by typing their name", async () => {
    mockAuth(["admin.access", "library.repair.run", "library.import.manage"]);
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    fireEvent.change(
      screen.getByPlaceholderText("Type a command or search..."),
      {
        target: { value: "sync lib" },
      },
    );

    expect(await screen.findByText("Sync Library")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("loads the task catalog once across palette mounts", async () => {
    mockAuth(["library.import.manage"]);
    const first = render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(await screen.findByText("Sync Library")).toBeInTheDocument();
    first.unmount();

    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByText("Sync Library")).toBeInTheDocument();
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path === "/api/admin/task-catalog"),
    ).toHaveLength(1);
  });

  it("tells the user when the backend did not start the task", async () => {
    mockAuth(["library.import.manage"]);
    mockApi({
      task_id: null,
      reason: "global_scope_not_supported",
    });
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    fireEvent.click(await screen.findByText("Sync Library"));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Sync Library not started: global scope not supported",
      ),
    );
  });
});

describe("command palette helpers", () => {
  it.each([
    [{ task_id: "abc" }, { kind: "queued" }],
    [{ status: "already_running" }, { kind: "already" }],
    [{ task_id: null }, { kind: "already" }],
    [
      { task_id: null, reason: "not_fixable" },
      { kind: "skipped", reason: "not fixable" },
    ],
    [undefined, { kind: "queued" }],
  ])("describes %j as %j", (result, expected) => {
    expect(describeActionResult(result)).toEqual(expected);
  });

  it("matches every word of the query in any order", () => {
    expect(matchesCommandQuery("Remove duplicate tracks", "dup rem")).toBe(
      true,
    );
    expect(matchesCommandQuery("Sync Library", "health")).toBe(false);
  });
});
