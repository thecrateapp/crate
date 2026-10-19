import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentCatalog, AgentIntegration } from "@/lib/agent-integrations";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

const { apiMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

import { AgentIntegrations } from "./AgentIntegrations";

const base = "/api/admin/agent-integrations";
const catalog: AgentCatalog = {
  mcp_enabled: true,
  actions_enabled: false,
  oauth_enabled: true,
  scopes: [
    { scope: "library.health.read", can_grant: true },
    { scope: "library.repair.photo_flag", can_grant: false },
  ],
  tools: [],
  limits: {
    calls_per_minute: 60,
    concurrent_calls: 2,
    active_maintenance_jobs: 1,
  },
};
const integration: AgentIntegration = {
  principal_id: "service-one",
  name: "Library reader",
  kind: "service",
  enabled: true,
  grants: ["library.health.read"],
  require_approval: false,
  policy_revision: 4,
  last_activity_at: null,
  credentials: [
    {
      credential_id: "credential-one",
      expires_at: "2030-01-01T00:00:00Z",
      revoked_at: null,
    },
  ],
  authorizations: null,
};
const secret = {
  token: "crate_mcp_visible-only-once",
  credential_id: "credential-two",
  expires_at: "2030-01-01T00:00:00Z",
};

function mockReads(items = [integration]) {
  apiMock.mockImplementation((path: string, method = "GET") => {
    if (method !== "GET") return Promise.resolve(secret);
    if (path === `${base}/catalog`) return Promise.resolve(catalog);
    if (path === `${base}/oauth-clients`)
      return Promise.resolve({ items: [], next_cursor: null });
    return Promise.resolve({ items, next_cursor: null });
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  mockReads();
});

describe("AgentIntegrations", () => {
  it("gates integration data and controls by capability", () => {
    renderWithAdminProviders(<AgentIntegrations />, {
      auth: { hasCapability: () => false },
    });

    expect(
      screen.getByText(
        "You do not have permission to manage agent integrations.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Service integration" }),
    ).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("does not expose activity or plan navigation without their capabilities", async () => {
    renderWithAdminProviders(<AgentIntegrations />, {
      auth: {
        hasCapability: (capability) =>
          capability === "agents.integrations.manage",
      },
    });

    expect(await screen.findByText("Library reader")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Activity" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Review plans" }),
    ).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.some(([path]) => String(path).includes("/activity")),
    ).toBe(false);
  });

  it("links plan reviewers to the Agents approvals section", async () => {
    renderWithAdminProviders(<AgentIntegrations />);
    expect(
      await screen.findByRole("link", { name: "Review plans" }),
    ).toHaveAttribute("href", "/agents/approvals");
  });

  it("reveals a provisioned token once and clears it when the dialog closes", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentIntegrations />);
    await screen.findByText("Library reader");

    await user.click(
      screen.getByRole("button", { name: "Service integration" }),
    );
    const form = screen.getByRole("dialog", {
      name: "Create service integration",
    });
    await user.type(within(form).getByLabelText("Name"), "Night operator");
    expect(
      within(form).getByLabelText(/Update an artist's photo flag/),
    ).toBeDisabled();
    await user.click(
      within(form).getByLabelText("Require human review before changes"),
    );
    await user.click(
      within(form).getByRole("button", { name: "Save integration" }),
    );

    const token = await screen.findByRole("textbox", {
      name: "Integration token",
    });
    expect(token).toHaveValue(secret.token);
    expect(apiMock).toHaveBeenCalledWith(base, "POST", {
      name: "Night operator",
      grants: ["library.health.read"],
      expires_in_days: 90,
      require_approval: true,
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("textbox", { name: "Integration token" }),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(secret.token);

    await user.click(
      screen.getByRole("button", { name: "Service integration" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Create service integration" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Integration token" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByLabelText("Name"),
    ).toHaveValue("");
  });

  it("preserves the complete proposal when provisioning fails", async () => {
    const user = userEvent.setup();
    mockReads([]);
    apiMock.mockImplementationOnce(() =>
      Promise.resolve({ items: [], next_cursor: null }),
    );
    renderWithAdminProviders(<AgentIntegrations />);
    await screen.findByText("No agent integrations yet.");
    await user.click(
      screen.getByRole("button", { name: "Service integration" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Create service integration",
    });
    await user.type(
      within(dialog).getByLabelText("Name"),
      "Retry this proposal",
    );
    await user.click(
      within(dialog).getByLabelText("Require human review before changes"),
    );
    apiMock.mockRejectedValueOnce(new Error("Credential service unavailable"));
    await user.click(
      within(dialog).getByRole("button", { name: "Save integration" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Credential service unavailable",
    );
    expect(within(dialog).getByLabelText("Name")).toHaveValue(
      "Retry this proposal",
    );
    expect(
      within(dialog).getByLabelText("Inspect library health"),
    ).toBeChecked();
    expect(
      within(dialog).getByLabelText("Require human review before changes"),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Save integration" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("textbox", { name: "Integration token" }),
    ).not.toBeInTheDocument();
  });

  it("clears a rotated token when the secret dialog is dismissed", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentIntegrations />);
    await screen.findByText("Library reader");
    await user.click(screen.getByRole("button", { name: "Rotate token" }));
    expect(
      await screen.findByRole("textbox", { name: "Integration token" }),
    ).toHaveValue(secret.token);
    expect(apiMock).toHaveBeenCalledWith(
      `${base}/credentials/credential-one/rotate`,
      "POST",
      { expires_in_days: 90 },
    );

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "Integration token" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Refresh integrations" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Save this token" }),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(secret.token);
  });

  it("locks a conflicting policy proposal until the current policy is reloaded", async () => {
    const user = userEvent.setup();
    let current = integration;
    apiMock.mockImplementation((path: string, method = "GET") => {
      if (method === "PATCH")
        return Promise.reject(
          Object.assign(
            new Error("Integration policy changed; reload before saving"),
            { status: 409 },
          ),
        );
      if (path === `${base}/catalog`) return Promise.resolve(catalog);
      if (path === `${base}/oauth-clients`)
        return Promise.resolve({ items: [] });
      if (path === `${base}/service-one`) return Promise.resolve(current);
      return Promise.resolve({ items: [current] });
    });
    renderWithAdminProviders(<AgentIntegrations />);
    await screen.findByText("Library reader");
    await user.click(screen.getByRole("button", { name: "Edit permissions" }));
    const dialog = screen.getByRole("dialog", {
      name: "Edit integration permissions",
    });
    await user.click(
      within(dialog).getByLabelText("Require human review before changes"),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save integration" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Integration policy changed",
    );
    expect(
      within(dialog).getByLabelText("Require human review before changes"),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Save integration" }),
    ).toBeDisabled();
    expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`, "PATCH", {
      grants: ["library.health.read"],
      require_approval: true,
      expected_policy_revision: 4,
    });
    current = { ...integration, policy_revision: 5, require_approval: false };
    await user.click(
      within(dialog).getByRole("button", { name: /reload.*policy/i }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save integration" }),
      ).toBeEnabled(),
    );
    expect(
      within(dialog).getByLabelText("Require human review before changes"),
    ).toBeChecked();
    expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`);
    await user.click(
      within(dialog).getByRole("button", { name: "Save integration" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`, "PATCH", {
        grants: ["library.health.read"],
        require_approval: true,
        expected_policy_revision: 5,
      }),
    );
  });

  it("treats delegated connections as account revocation rather than service token rotation", async () => {
    const user = userEvent.setup();
    mockReads([
      {
        ...integration,
        kind: "delegated",
        credentials: null,
        authorizations: [
          {
            authorization_id: "authorization-one",
            user_id: 14,
            client_id: "agent-client",
            revoked_at: null,
          },
        ],
      },
    ]);
    renderWithAdminProviders(<AgentIntegrations />);

    expect(await screen.findByText("Connected account")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Rotate token" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const confirmation = screen.getByRole("alertdialog");
    await user.click(
      within(confirmation).getByRole("button", { name: "Confirm" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/authorizations/authorization-one/revoke`,
        "POST",
      ),
    );
    expect(
      screen.queryByRole("textbox", { name: "Integration token" }),
    ).not.toBeInTheDocument();
  });

  it("shows delegated activity ownership, exact target, boolean diff and review links", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === `${base}/catalog`) return Promise.resolve(catalog);
      if (path === `${base}/oauth-clients`)
        return Promise.resolve({ items: [] });
      if (path.startsWith(`${base}/service-one/activity`))
        return Promise.resolve({
          items: [
            {
              id: 1,
              timestamp: "2026-10-16T12:00:00Z",
              action: "agent.repair.applied",
              target: "fallback-target",
              user_id: null,
              evidence: {
                principal_id: "service-one",
                actor_user_id: 14,
                client_id: "remote-client",
                authorization_id: "connection-one",
                artist_uid: "artist-one",
                tool: "apply_repairs",
                execution: "applied",
                verification: "pending",
                before: false,
                after: true,
                plan_id: "plan /one",
                job_id: "job /one",
              },
            },
            {
              id: 2,
              timestamp: "2026-10-16T12:00:00Z",
              action: "Foreign activity",
              target: "foreign-target",
              evidence: { principal_id: "another-principal" },
            },
          ],
          next_cursor: null,
        });
      return Promise.resolve({ items: [integration] });
    });
    renderWithAdminProviders(<AgentIntegrations />);
    await screen.findByText("Library reader");
    await user.click(screen.getByRole("button", { name: "Activity" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Integration activity",
    });

    expect(
      await within(dialog).findByText("User 14 · Client remote-client"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Connection connection-one"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Target artist-one")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Photo flag: false → true"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "View plan" }),
    ).toHaveAttribute("href", "/agents/approvals/plan%20%2Fone");
    expect(
      within(dialog).getByRole("link", { name: "View job" }),
    ).toHaveAttribute("href", "/tasks?task=job%20%2Fone");
    expect(
      within(dialog).queryByText(/Foreign activity/),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText(/fallback-target/),
    ).not.toBeInTheDocument();
  });

  it("edits OAuth client permissions without replacing registered client metadata", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string, method = "GET") => {
      if (method === "POST") return Promise.resolve({ updated: true });
      if (path === `${base}/catalog`)
        return Promise.resolve({
          ...catalog,
          scopes: [
            ...catalog.scopes,
            { scope: "ops.status.read", can_grant: true },
          ],
        });
      if (path === `${base}/oauth-clients`)
        return Promise.resolve({
          items: [
            {
              client_id: "remote-client",
              name: "Remote agent",
              enabled: true,
              scopes: ["library.health.read"],
            },
          ],
        });
      return Promise.resolve({ items: [integration] });
    });
    renderWithAdminProviders(<AgentIntegrations />);
    await screen.findByText("Remote agent");
    await user.click(
      screen.getByRole("button", { name: "Edit client permissions" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Edit OAuth client permissions",
    });
    expect(
      within(dialog).queryByLabelText("Client name"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Callback addresses (one per line)"),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("Read instance status"));
    await user.click(within(dialog).getByLabelText("Inspect library health"));
    await user.click(
      within(dialog).getByRole("button", { name: "Save client permissions" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/oauth-clients/update`,
        "POST",
        { client_id: "remote-client", scopes: ["ops.status.read"] },
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "OAuth client permissions updated",
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit OAuth client permissions" }),
    ).not.toBeInTheDocument();
  });
});
