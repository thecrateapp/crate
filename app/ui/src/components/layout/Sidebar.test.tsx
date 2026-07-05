import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/OpsSnapshotContext", () => ({
  useOpsSnapshot: () => ({ data: null }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    actualUser: null,
    clearRolePreview: vi.fn(),
    hasAnyCapability: (capabilities: readonly string[]) =>
      capabilities.includes("admin.access"),
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
