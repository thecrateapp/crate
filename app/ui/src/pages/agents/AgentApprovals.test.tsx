import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentPlanListItem } from "@/lib/agent-integrations";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMock }));

import { AgentApprovals } from "./AgentApprovals";

const HEX_64 = "a1".repeat(32);

function planItem(
  overrides: Partial<AgentPlanListItem> = {},
): AgentPlanListItem {
  return {
    plan_id: "plan-one",
    principal_id: HEX_64,
    state: "awaiting_approval",
    approval_required: true,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    created_at: new Date(Date.now() - 600_000).toISOString(),
    operation: "shows_import",
    integration_name: "Local lab MCP",
    integration_kind: "service",
    target_count: 3,
    risk: "safe",
    expired: false,
    ...overrides,
  };
}

function mockList(
  responder: (url: string) => {
    items: AgentPlanListItem[];
    next_cursor: string | null;
  },
) {
  apiMock.mockImplementation((url: string) => Promise.resolve(responder(url)));
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("AgentApprovals", () => {
  it("lists pending plans with a readable title, connection and expiry", async () => {
    mockList(() => ({ items: [planItem()], next_cursor: null }));
    renderWithAdminProviders(<AgentApprovals />);

    const link = await screen.findByRole("link", {
      name: "Import shows · 3 items",
    });
    expect(link).toHaveAttribute("href", "/agents/approvals/plan-one");
    expect(screen.getByText("Local lab MCP · Token")).toBeInTheDocument();
    expect(screen.getByText("Needs approval")).toBeInTheDocument();
    expect(screen.getByText("Safe")).toBeInTheDocument();
    expect(String(apiMock.mock.calls[0]?.[0])).toContain("view=pending");
    expect(document.body.textContent ?? "").not.toMatch(/[0-9a-f]{64}/i);
  });

  it("switches to history and shows expired plans as expired", async () => {
    const user = userEvent.setup();
    mockList((url) =>
      url.includes("view=history")
        ? {
            items: [
              planItem({
                plan_id: "plan-two",
                operation: "metadata_update",
                expired: true,
              }),
            ],
            next_cursor: null,
          }
        : { items: [planItem()], next_cursor: null },
    );
    renderWithAdminProviders(<AgentApprovals />);
    await screen.findByRole("link", { name: "Import shows · 3 items" });

    await user.click(screen.getByRole("radio", { name: "History" }));

    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(([url]) =>
          String(url).includes("view=history"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Expired")).toBeInTheDocument();
  });

  it("appends the next page when loading more", async () => {
    const user = userEvent.setup();
    mockList((url) =>
      url.includes("cursor=plan-one")
        ? {
            items: [
              planItem({
                plan_id: "plan-two",
                operation: "editorial_change",
                target_count: 1,
              }),
            ],
            next_cursor: null,
          }
        : { items: [planItem()], next_cursor: "plan-one" },
    );
    renderWithAdminProviders(<AgentApprovals />);
    await screen.findByRole("link", { name: "Import shows · 3 items" });

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() =>
      expect(
        apiMock.mock.calls.some(([url]) =>
          String(url).includes("cursor=plan-one"),
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByRole("link", {
        name: "Change editorial playlist · 1 item",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Import shows · 3 items" }),
    ).toBeInTheDocument();
  });

  it("explains an empty pending queue", async () => {
    mockList(() => ({ items: [], next_cursor: null }));
    renderWithAdminProviders(<AgentApprovals />);

    expect(
      await screen.findByText("No changes are waiting for approval."),
    ).toBeInTheDocument();
  });

  it("explains an empty history", async () => {
    mockList(() => ({ items: [], next_cursor: null }));
    renderWithAdminProviders(<AgentApprovals />, {
      auth: { hasCapability: () => true },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "History" }));

    expect(
      await screen.findByText("No decided or expired plans yet."),
    ).toBeInTheDocument();
  });

  it("hides the queue without a review-capable domain", () => {
    renderWithAdminProviders(<AgentApprovals />, {
      auth: { hasCapability: () => false },
    });

    expect(
      screen.getByText("You do not have permission to review these plans."),
    ).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
