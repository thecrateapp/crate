import { screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-pending-approvals", () => ({
  usePendingApprovals: () => 2,
}));

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { Agents, AgentsIndex, LegacyPlanRedirect } from "./Agents";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current-path">{location.pathname}</output>;
}

function renderAgentsRoutes(route: string, capabilities: string[]) {
  return renderWithAdminProviders(
    <>
      <LocationProbe />
      <Routes>
        <Route path="/agents" element={<Agents />}>
          <Route index element={<AgentsIndex />} />
          <Route path="approvals" element={<p>Approvals list stub</p>} />
          <Route
            path="approvals/:planId"
            element={<p>Approval detail stub</p>}
          />
          <Route path="connections" element={<p>Connections list stub</p>} />
        </Route>
        <Route path="/agent-plans/:planId?" element={<LegacyPlanRedirect />} />
      </Routes>
    </>,
    {
      route,
      auth: {
        hasAnyCapability: (required: readonly string[]) =>
          required.some((capability) => capabilities.includes(capability)),
      },
    },
  );
}

describe("Agents", () => {
  it("lands reviewers on approvals and shows the pending badge on the Approvals link", () => {
    renderAgentsRoutes("/agents", [
      "agents.plans.review",
      "agents.integrations.manage",
    ]);

    expect(screen.getByLabelText("current-path")).toHaveTextContent(
      "/agents/approvals",
    );
    const approvalsLink = screen.getByRole("link", { name: /Approvals/ });
    expect(approvalsLink).toHaveTextContent("2");
    expect(
      screen.getByRole("link", { name: "Connections" }),
    ).toBeInTheDocument();
  });

  it("lands connection managers on connections without offering an Approvals link", () => {
    renderAgentsRoutes("/agents", ["agents.integrations.manage"]);

    expect(screen.getByLabelText("current-path")).toHaveTextContent(
      "/agents/connections",
    );
    expect(
      screen.queryByRole("link", { name: /Approvals/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Connections" }),
    ).toBeInTheDocument();
  });

  it("redirects a legacy plan link to the new approvals detail route", () => {
    renderAgentsRoutes("/agent-plans/plan-one", [
      "agents.plans.review",
      "agents.integrations.manage",
    ]);

    expect(screen.getByLabelText("current-path")).toHaveTextContent(
      "/agents/approvals/plan-one",
    );
  });
});
