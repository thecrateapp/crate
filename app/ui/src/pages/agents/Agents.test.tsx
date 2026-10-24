import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
    const approvalsLink = screen.getByRole("tab", { name: /Approvals/ });
    expect(approvalsLink).toHaveTextContent("2");
    expect(approvalsLink).toHaveAccessibleName("Approvals 2 pending");
    expect(
      screen.getByRole("tab", { name: "Connections" }),
    ).toBeInTheDocument();
  });

  it("lands connection managers on connections without offering an Approvals link", () => {
    renderAgentsRoutes("/agents", ["agents.integrations.manage"]);

    expect(screen.getByLabelText("current-path")).toHaveTextContent(
      "/agents/connections",
    );
    expect(
      screen.queryByRole("tab", { name: /Approvals/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Connections" }),
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
  it("keeps native section URLs, tab panels and arrow-key navigation", async () => {
    const user = userEvent.setup();
    renderAgentsRoutes("/agents/approvals/plan-one", [
      "agents.plans.review",
      "agents.integrations.manage",
    ]);
    const approvals = screen.getByRole("tab", { name: /Approvals/ });
    const connections = screen.getByRole("tab", { name: "Connections" });
    expect(approvals).toHaveAttribute("href", "/agents/approvals");
    expect(approvals).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Approval detail stub",
    );
    approvals.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => {
      expect(connections).toHaveFocus();
      expect(screen.getByLabelText("current-path")).toHaveTextContent(
        "/agents/connections",
      );
      expect(screen.getByRole("tabpanel")).toHaveTextContent(
        "Connections list stub",
      );
    });
    await user.click(approvals);
    await waitFor(() =>
      expect(screen.getByRole("tabpanel")).toHaveTextContent(
        "Approvals list stub",
      ),
    );
  });
  it("returns from an approval detail to its list through the already active tab", async () => {
    renderAgentsRoutes("/agents/approvals/plan-one", ["agents.plans.review"]);
    await userEvent.click(screen.getByRole("tab", { name: /Approvals/ }));
    expect(screen.getByLabelText("current-path")).toHaveTextContent(
      /^\/agents\/approvals$/,
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Approvals list stub",
    );
  });

  it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])(
    "keeps the current route when a section is pressed with %s",
    (modifier) => {
      renderAgentsRoutes("/agents/approvals/plan-one", [
        "agents.plans.review",
        "agents.integrations.manage",
      ]);
      const connections = screen.getByRole("tab", { name: "Connections" });
      expect(
        fireEvent.mouseDown(connections, { button: 0, [modifier]: true }),
      ).toBe(false);
      expect(screen.getByLabelText("current-path")).toHaveTextContent(
        "/agents/approvals/plan-one",
      );
      expect(connections).toHaveAttribute("href", "/agents/connections");
      expect(screen.getByRole("tabpanel")).toHaveTextContent(
        "Approval detail stub",
      );
    },
  );
});
