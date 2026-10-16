import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentPlan } from "@/lib/agent-integrations";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { apiMock, toastSuccessMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
}));

import { AgentPlanReview } from "./AgentPlanReview";

const base = "/api/admin/agent-plans";
const uid = "10000000-0000-0000-0000-000000000001";

function plan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    plan_id: "plan-one",
    principal_id: "service-one",
    state: "awaiting_approval",
    approval_required: true,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    plan_version: "a".repeat(64),
    content_hash: "b".repeat(64),
    authorization_context_hash: "c".repeat(64),
    policy_revision: 7,
    operation: "repair_photo_flag",
    risk: "low",
    target_count: 1,
    returned_count: 1,
    truncated: false,
    targets: [{ artist_uid: uid, name: "Echo" }],
    changes: [
      { artist_uid: uid, field: "has_photo", before: false, after: true },
    ],
    impact: { artist_count: 1, filesystem_writes: false, notifications: false },
    reversibility: "The flag can be recomputed from current photo evidence.",
    source_versions: {
      observation_id: "observation-one",
      observed_at: new Date().toISOString(),
    },
    authorization_context: {},
    ...overrides,
  };
}

function renderReview(capabilities?: string[]) {
  return renderWithAdminProviders(
    <Routes>
      <Route
        path="/agent-plans/:planId"
        element={
          <>
            <Link to="/agent-plans/plan-two">Next review target</Link>
            <AgentPlanReview />
          </>
        }
      />
    </Routes>,
    {
      route: "/agent-plans/plan-one",
      auth: capabilities
        ? { hasCapability: (capability) => capabilities.includes(capability) }
        : undefined,
    },
  );
}

function exactDecision(item: AgentPlan) {
  return {
    plan_version: item.plan_version,
    content_hash: item.content_hash,
    policy_revision: item.policy_revision,
    authorization_context_hash: item.authorization_context_hash,
  };
}

beforeEach(() => {
  apiMock.mockReset();
  toastSuccessMock.mockReset();
});

describe("AgentPlanReview", () => {
  it.each([
    ["domain permission", ["agents.plans.review", "agents.plans.approve"]],
    ["review permission", ["agents.plans.approve", "library.repair.run"]],
  ] as const)("does not fetch plans without %s", (_label, capabilities) => {
    renderReview([...capabilities]);
    expect(
      screen.getByText("You do not have permission to review these plans."),
    ).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("lets reviewers inspect exact changes without approval controls", async () => {
    apiMock.mockResolvedValue(plan());
    renderReview(["agents.plans.review", "library.repair.run"]);
    expect(
      await screen.findByRole("table", { name: "Complete proposed changes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Echo")).toBeInTheDocument();
    expect(screen.getByText("No photo")).toBeInTheDocument();
    expect(screen.getByText("Photo present")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve exact plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reject plan" }),
    ).not.toBeInTheDocument();
  });

  it.each(["approve", "reject"] as const)(
    "submits a human %s decision with the exact reviewed hashes and policy",
    async (decision) => {
      const user = userEvent.setup();
      let current = plan();
      const reviewed = current;
      apiMock.mockImplementation((_path: string, method = "GET") => {
        if (method === "POST")
          current = {
            ...current,
            state: decision === "approve" ? "authorized" : "rejected",
          };
        return Promise.resolve(current);
      });
      renderReview();
      const button = await screen.findByRole("button", {
        name: decision === "approve" ? "Approve exact plan" : "Reject plan",
      });
      expect(button).toBeDisabled();
      await user.click(
        screen.getByRole("checkbox", {
          name: "I reviewed all 1 proposed changes and their effects.",
        }),
      );
      expect(button).toBeEnabled();
      await user.click(button);

      await waitFor(() =>
        expect(apiMock).toHaveBeenCalledWith(
          `${base}/plan-one/${decision}`,
          "POST",
          exactDecision(reviewed),
        ),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Approve exact plan" }),
        ).not.toBeInTheDocument(),
      );
      expect(toastSuccessMock).toHaveBeenCalledWith(
        decision === "approve" ? "Plan approved" : "Plan rejected",
      );
      expect(
        apiMock.mock.calls.filter(([, method]) => method === "POST"),
      ).toHaveLength(1);
    },
  );

  it.each([
    ["truncated changes", { truncated: true }],
    ["missing change", { changes: [] }],
    ["missing target", { targets: [] }],
    [
      "mismatched target",
      { targets: [{ artist_uid: "another-artist", name: "Another" }] },
    ],
    [
      "empty target selection",
      { targets: [], changes: [], target_count: 0, returned_count: 0 },
    ],
    ["expired plan", { expires_at: "2020-01-01T00:00:00Z" }],
    ["invalid expiry", { expires_at: "invalid-timestamp" }],
  ] satisfies [string, Partial<AgentPlan>][])(
    "blocks approval for %s",
    async (_label, invalid) => {
      const user = userEvent.setup();
      apiMock.mockResolvedValue(plan(invalid));
      renderReview();
      const button = await screen.findByRole("button", {
        name: "Approve exact plan",
      });
      const checkbox = screen.getByRole("checkbox");
      if (!checkbox.hasAttribute("disabled")) await user.click(checkbox);
      expect(button).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Reject plan" }),
      ).toBeDisabled();
      expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
        false,
      );
    },
  );

  it("requires a fresh review after a conflicting decision and reloads the changed version", async () => {
    const user = userEvent.setup();
    let current = plan();
    let conflict = true;
    apiMock.mockImplementation((_path: string, method = "GET") => {
      if (method === "POST" && conflict)
        return Promise.reject(
          Object.assign(
            new Error("The reviewed plan or policy is no longer current"),
            { status: 409 },
          ),
        );
      if (method === "POST") current = { ...current, state: "authorized" };
      return Promise.resolve(current);
    });
    renderReview();
    await screen.findByText("Echo");
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Approve exact plan" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The reviewed plan or policy is no longer current",
    );
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeDisabled();
    expect(screen.getByText("Echo")).toBeInTheDocument();

    current = {
      ...current,
      plan_version: "d".repeat(64),
      content_hash: "e".repeat(64),
      policy_revision: 8,
    };
    conflict = false;
    await user.click(screen.getByRole("button", { name: "Reload plan" }));
    await screen.findByText(/Policy revision 8/);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Approve exact plan" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenLastCalledWith(
        `${base}/plan-one`,
        "GET",
        undefined,
        expect.any(Object),
      ),
    );
    expect(apiMock).toHaveBeenCalledWith(
      `${base}/plan-one/approve`,
      "POST",
      exactDecision(current),
    );
  });

  it("resets the review checkbox when navigating to another exact plan", async () => {
    const user = userEvent.setup();
    const first = plan();
    const second = plan({
      plan_id: "plan-two",
      plan_version: "d".repeat(64),
      content_hash: "e".repeat(64),
      targets: [{ artist_uid: uid, name: "Second artist" }],
    });
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/plan-two") ? second : first),
    );
    renderReview();
    await screen.findByText("Echo");
    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeEnabled();

    await user.click(screen.getByRole("link", { name: "Next review target" }));
    await screen.findByText("Second artist");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Approve exact plan" }),
    ).toBeDisabled();
    expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
      false,
    );
  });
});
