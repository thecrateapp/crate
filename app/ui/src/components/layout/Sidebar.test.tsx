import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { granted } = vi.hoisted(() => ({ granted: new Set(["admin.access"]) }));

vi.mock("@/contexts/OpsSnapshotContext", () => ({
  useOpsSnapshot: () => ({ data: null }),
}));

vi.mock("@/hooks/use-pending-approvals", () => ({
  usePendingApprovals: () => 4,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    actualUser: null,
    clearRolePreview: vi.fn(),
    hasAnyCapability: (capabilities: readonly string[]) =>
      capabilities.some((c) => granted.has(c)),
    logout: vi.fn(),
    previewRole: null,
    rolePresets: [],
    setPreviewRole: vi.fn(),
    user: {
      id: 1,
      email: "admin@example.test",
      name: "Admin",
      role: "admin",
      roles: ["admin"],
      capabilities: ["admin.access"],
    },
  }),
  userCanAccessAdminConsole: () => true,
}));

import { Sidebar, SIDEBAR_KEY } from "./Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.removeItem(SIDEBAR_KEY);
    granted.clear();
    granted.add("admin.access");
  });

  it("links admins with settings access to Listen translation review", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Translations/i })).toHaveAttribute(
      "href",
      "/i18n",
    );
  });
});

it("links agents reviewers to the unified Agents section with the pending badge", () => {
  granted.clear();
  granted.add("agents.plans.review");
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );

  const link = screen.getByRole("link", { name: /Agents/i });
  expect(link).toHaveAttribute("href", "/agents");
  expect(link).toHaveTextContent("4");
  expect(
    screen.queryByRole("link", { name: /Agent plans/i }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /Agent integrations/i }),
  ).not.toBeInTheDocument();
});

it("gates AI navigation by configuration read capability", () => {
  granted.clear();
  const { rerender } = render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("link", { name: /AI Agents/i }),
  ).not.toBeInTheDocument();
  granted.add("ai.config.read");
  rerender(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: /AI Agents/i })).toHaveAttribute(
    "href",
    "/ai-agents",
  );
});
