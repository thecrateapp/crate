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

import { AgentConnections } from "./AgentConnections";

const base = "/api/admin/agent-integrations";
const catalog: AgentCatalog = {
  mcp_enabled: true,
  actions_enabled: false,
  oauth_enabled: true,
  scopes: [
    {
      scope: "library.health.read",
      capability: "agents.integrations.manage",
      can_grant: true,
      label: "Inspect library health",
      group: "library",
      access: "read",
    },
    {
      scope: "library.repair.photo_flag",
      capability: "agents.repair.apply",
      can_grant: false,
      label: "Update an artist's photo flag",
      group: "library",
      access: "change",
    },
    {
      scope: "ops.status.read",
      capability: "agents.integrations.manage",
      can_grant: true,
      label: "Read instance status",
      group: "instance",
      access: "read",
    },
  ],
  scope_groups: [
    { id: "library", label: "Library" },
    { id: "instance", label: "Instance" },
  ],
  presets: [
    {
      id: "read_only",
      label: "Read only",
      description: "Inspect library health. Cannot change anything.",
      scopes: ["library.health.read"],
    },
  ],
  mcp_url: null,
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
const emptyPage = { items: [], next_cursor: null };

function readDefault(path: string, items: AgentIntegration[]) {
  if (path === `${base}/catalog`) return Promise.resolve(catalog);
  if (path.startsWith(`${base}/oauth-clients`))
    return Promise.resolve(emptyPage);
  if (path.includes("/activity")) return Promise.resolve(emptyPage);
  // The sheet reads a connection again after every change.
  const single = items.find((item) => path === `${base}/${item.principal_id}`);
  if (single) return Promise.resolve(single);
  return Promise.resolve({ items, next_cursor: null });
}

/** Expiry of each token row the Token section offers actions for. */
function activeTokenExpiries(section: HTMLElement) {
  return within(section)
    .queryAllByRole("listitem")
    .map((row) => row.querySelector("time")?.getAttribute("datetime"));
}

function mockReads(items = [integration]) {
  apiMock.mockImplementation((path: string, method = "GET") => {
    if (method !== "GET") return Promise.resolve(secret);
    return readDefault(path, items);
  });
}

async function openConnection(
  user: ReturnType<typeof userEvent.setup>,
  name = "Library reader",
) {
  await user.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog", { name });
}

beforeEach(() => {
  apiMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  mockReads();
});

describe("AgentConnections", () => {
  it("gates connection data and controls by capability", () => {
    renderWithAdminProviders(<AgentConnections />, {
      auth: { hasCapability: () => false },
    });

    expect(
      screen.getByText(
        "You do not have permission to manage agent connections.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect an agent" }),
    ).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("does not expose activity or plan navigation without their capabilities", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentConnections />, {
      auth: {
        hasCapability: (capability) =>
          capability === "agents.integrations.manage",
      },
    });

    expect(
      await screen.findByRole("button", { name: "Library reader" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Review plans" }),
    ).not.toBeInTheDocument();
    const sheet = await openConnection(user);
    expect(
      within(sheet).getByRole("heading", { name: "Permissions" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("heading", { name: "Activity" }),
    ).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.some(([path]) => String(path).includes("/activity")),
    ).toBe(false);
  });

  it("links plan reviewers to the Agents approvals section", async () => {
    renderWithAdminProviders(<AgentConnections />);
    expect(
      await screen.findByRole("link", { name: "Review plans" }),
    ).toHaveAttribute("href", "/agents/approvals");
  });

  it("shows the instance status and limits", async () => {
    renderWithAdminProviders(<AgentConnections />);

    expect(await screen.findByText("MCP on")).toBeInTheDocument();
    expect(screen.getByText("Changes off")).toBeInTheDocument();
    expect(screen.getByText("OAuth on")).toBeInTheDocument();
    expect(
      screen.getByText(
        "60 calls/min · 2 at once · 1 maintenance job per connection",
      ),
    ).toBeInTheDocument();
  });

  it("reveals a provisioned token once and clears it when the dialog closes", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByRole("button", { name: "Library reader" });

    await user.click(screen.getByRole("button", { name: "Connect an agent" }));
    const form = screen.getByRole("dialog", { name: "Connect your agent" });
    await user.type(within(form).getByLabelText("Name"), "Night operator");
    await user.click(within(form).getByRole("button", { name: "Next" }));
    await user.click(within(form).getByRole("radio", { name: "Custom" }));
    expect(
      within(form).getByLabelText("Update an artist's photo flag"),
    ).toBeDisabled();
    await user.click(
      within(form).getByRole("button", { name: "Create connection" }),
    );

    const token = await within(form).findByRole("textbox", { name: "Token" });
    expect(token).toHaveValue(secret.token);
    expect(apiMock).toHaveBeenCalledWith(base, "POST", {
      name: "Night operator",
      grants: ["library.health.read"],
      expires_in_days: 90,
      require_approval: true,
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await user.click(within(form).getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("textbox", { name: "Token" }),
    ).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(secret.token);

    await user.click(screen.getByRole("button", { name: "Connect an agent" }));
    expect(
      screen.getByRole("dialog", { name: "Connect your agent" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Token" }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByLabelText("Name"),
    ).toHaveValue("");
  });

  it("preserves the complete proposal when provisioning fails", async () => {
    const user = userEvent.setup();
    mockReads([]);
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByText(
      "No agents are connected yet. Connect one to let it inspect or maintain Crate.",
    );
    await user.click(screen.getByRole("button", { name: "Connect an agent" }));
    const dialog = screen.getByRole("dialog", { name: "Connect your agent" });
    await user.type(
      within(dialog).getByLabelText("Name"),
      "Retry this proposal",
    );
    await user.click(within(dialog).getByRole("button", { name: "Next" }));
    await user.click(
      within(dialog).getByLabelText("Require approval before changes"),
    );
    apiMock.mockRejectedValueOnce(new Error("Credential service unavailable"));
    await user.click(
      within(dialog).getByRole("button", { name: "Create connection" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Credential service unavailable",
    );
    expect(
      within(dialog).getByRole("radio", { name: "Read only" }),
    ).toBeChecked();
    expect(
      within(dialog).getByLabelText("Require approval before changes"),
    ).not.toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Create connection" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("textbox", { name: "Token" }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "Custom" }));
    expect(
      within(dialog).getByLabelText("Inspect library health"),
    ).toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(dialog).getByLabelText("Name")).toHaveValue(
      "Retry this proposal",
    );
  });

  it("clears a rotated token when the sheet is dismissed", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentConnections />);
    const sheet = await openConnection(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Rotate token" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Rotate token",
      }),
    );
    expect(
      await within(sheet).findByRole("textbox", { name: "New token" }),
    ).toHaveValue(secret.token);
    expect(apiMock).toHaveBeenCalledWith(
      `${base}/credentials/credential-one/rotate`,
      "POST",
      { expires_in_days: 90 },
    );

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "New token" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Refresh connections" }),
    );
    const reopened = await openConnection(user);
    expect(
      within(reopened).queryByRole("textbox", { name: "New token" }),
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
      if (path === `${base}/service-one`) return Promise.resolve(current);
      return readDefault(path, [current]);
    });
    renderWithAdminProviders(<AgentConnections />);
    const sheet = await openConnection(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Edit permissions" }),
    );
    await user.click(within(sheet).getByRole("radio", { name: "Custom" }));
    await user.click(within(sheet).getByLabelText("Read instance status"));
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "This connection changed since you opened it.",
    );
    expect(within(sheet).getByLabelText("Read instance status")).toBeChecked();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`, "PATCH", {
      grants: ["library.health.read", "ops.status.read"],
      require_approval: false,
      expected_policy_revision: 4,
    });
    current = { ...integration, policy_revision: 5, require_approval: true };
    await user.click(
      within(sheet).getByRole("button", { name: "Reload policy" }),
    );
    await waitFor(() =>
      expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    expect(
      within(sheet).getByText(
        "Policy reloaded. Your proposed permissions are preserved; review them before saving.",
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Read instance status")).toBeChecked();
    expect(
      within(sheet).getByLabelText("Require approval before changes"),
    ).toBeChecked();
    expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`);
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`, "PATCH", {
        grants: ["library.health.read", "ops.status.read"],
        require_approval: true,
        expected_policy_revision: 5,
      }),
    );
  });

  it("treats delegated connections as account revocation rather than service token rotation", async () => {
    const user = userEvent.setup();
    const signIn = {
      authorization_id: "authorization-one",
      user_id: 14,
      client_id: "agent-client",
      revoked_at: null as string | null,
    };
    let delegated: AgentIntegration = {
      ...integration,
      kind: "delegated",
      credentials: null,
      authorizations: [signIn],
    };
    apiMock.mockImplementation((path: string, method = "GET") => {
      if (method === "POST") {
        delegated = {
          ...delegated,
          authorizations: [{ ...signIn, revoked_at: "2026-10-19T12:00:00Z" }],
        };
        return Promise.resolve({ revoked: true });
      }
      return readDefault(path, [delegated]);
    });
    renderWithAdminProviders(<AgentConnections />);

    expect(
      await screen.findByRole("button", { name: "Library reader" }),
    ).toHaveTextContent("OAuth sign-in");
    const sheet = await openConnection(user);
    expect(
      within(sheet).queryByRole("button", { name: "Rotate token" }),
    ).not.toBeInTheDocument();
    expect(
      within(sheet).getByText("User #14 · agent-client"),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Disconnect" }));
    const confirmation = screen.getByRole("alertdialog");
    await user.click(
      within(confirmation).getByRole("button", { name: "Disconnect" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/authorizations/authorization-one/revoke`,
        "POST",
      ),
    );
    expect(await within(sheet).findByText("Revoked")).toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: "Disconnect" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "New token" }),
    ).not.toBeInTheDocument();
  });

  it("shows delegated activity ownership, exact target, boolean diff and review links", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
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
      return readDefault(path, [integration]);
    });
    renderWithAdminProviders(<AgentConnections />);
    const sheet = await openConnection(user);
    const activity = within(sheet).getByRole("region", { name: "Activity" });

    expect(
      await within(activity).findByText("Applied a repair · Apply repairs"),
    ).toBeInTheDocument();
    expect(
      within(activity).getByText("User #14 · remote-client"),
    ).toBeInTheDocument();
    expect(within(activity).getByText("Target artist-one")).toBeInTheDocument();
    expect(
      within(activity).getByText("Photo flag: off → on"),
    ).toBeInTheDocument();
    expect(
      within(activity).getByText("Execution: Applied · Verification: Pending"),
    ).toBeInTheDocument();
    expect(
      within(activity).getByRole("link", { name: "Open plan" }),
    ).toHaveAttribute("href", "/agents/approvals/plan%20%2Fone");
    expect(
      within(activity).getByRole("link", { name: "Open job" }),
    ).toHaveAttribute("href", "/tasks?task=job%20%2Fone");
    expect(
      within(activity).queryByText(/Foreign activity/),
    ).not.toBeInTheDocument();
    expect(
      within(activity).queryByText(/fallback-target/),
    ).not.toBeInTheDocument();
    expect(activity).not.toHaveTextContent("connection-one");
    await user.click(
      within(activity).getByRole("button", { name: "Technical details" }),
    );
    expect(within(activity).getByText("connection-one")).toBeInTheDocument();
  });

  it("edits OAuth app permissions without replacing registered app metadata", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string, method = "GET") => {
      if (method === "POST") return Promise.resolve({ updated: true });
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
      return readDefault(path, [integration]);
    });
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByText("Remote agent");
    await user.click(screen.getByRole("button", { name: "Edit permissions" }));
    const dialog = screen.getByRole("dialog", { name: "Edit app permissions" });
    expect(within(dialog).queryByLabelText("App name")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Redirect URIs (one per line)"),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "Custom" }));
    await user.click(within(dialog).getByLabelText("Read instance status"));
    await user.click(within(dialog).getByLabelText("Inspect library health"));
    await user.click(
      within(dialog).getByRole("button", { name: "Save permissions" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/oauth-clients/update`,
        "POST",
        { client_id: "remote-client", scopes: ["ops.status.read"] },
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "OAuth app permissions updated",
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit app permissions" }),
    ).not.toBeInTheDocument();
  });

  it("summarises each connection without permission ids", async () => {
    const user = userEvent.setup();
    mockReads([
      {
        ...integration,
        grants: ["library.health.read", "library.repair.run"],
        require_approval: true,
      },
    ]);
    renderWithAdminProviders(<AgentConnections />);

    const row = await screen.findByRole("button", { name: "Library reader" });
    expect(row).toHaveTextContent("Token");
    expect(row).toHaveTextContent("2 permissions · 1 can change things");
    expect(row).toHaveTextContent("Changes need approval");
    expect(row).toHaveTextContent("Never used");
    expect(row).toHaveTextContent(/Token expires/);
    expect(document.body).not.toHaveTextContent("library.health.read");

    const sheet = await openConnection(user);
    const permission = within(sheet).getByText("Inspect library health");
    expect(permission).not.toHaveAttribute("title");
    permission.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "library.health.read",
    );
    expect(sheet).not.toHaveTextContent("library.health.read");
    expect(sheet).not.toHaveTextContent("library.repair.run");
  });

  it("flags an integration whose token expired", async () => {
    mockReads([
      {
        ...integration,
        credentials: [
          {
            credential_id: "credential-one",
            expires_at: "2020-01-01T00:00:00Z",
            revoked_at: null,
          },
        ],
      },
    ]);
    renderWithAdminProviders(<AgentConnections />);

    const row = await screen.findByRole("button", { name: "Library reader" });
    expect(row).toHaveTextContent("Token expired");
    expect(within(row).queryByText("Enabled")).not.toBeInTheDocument();
  });

  it("rotating a token shows the new token with client configuration", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentConnections />);
    const sheet = await openConnection(user);

    await user.click(
      within(sheet).getByRole("button", { name: "Rotate token" }),
    );
    const confirmation = screen.getByRole("alertdialog", {
      name: "Rotate the token for Library reader?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Rotate token" }),
    );

    expect(
      await within(sheet).findByRole("textbox", { name: "New token" }),
    ).toHaveValue(secret.token);
    expect(
      within(sheet).getByText(/claude mcp add --transport http crate/),
    ).toHaveTextContent(secret.token);

    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Library reader" }),
      ).not.toBeInTheDocument(),
    );
    expect(document.body).not.toHaveTextContent(secret.token);
  });

  it("loads more connections after the first page", async () => {
    const user = userEvent.setup();
    const second = {
      ...integration,
      principal_id: "service-two",
      name: "Night operator",
    };
    apiMock.mockImplementation((path: string) => {
      if (path === `${base}?limit=20`)
        return Promise.resolve({ items: [integration], next_cursor: "one" });
      if (path === `${base}?limit=20&cursor=one`)
        return Promise.resolve({ items: [second], next_cursor: null });
      return readDefault(path, []);
    });
    renderWithAdminProviders(<AgentConnections />);

    await screen.findByRole("button", { name: "Library reader" });
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(
      await screen.findByRole("button", { name: "Night operator" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Library reader" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("saves the approval switch with the current policy revision", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentConnections />);
    const sheet = await openConnection(user);

    await user.click(
      within(sheet).getByLabelText("Require approval before changes"),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`, "PATCH", {
        grants: ["library.health.read"],
        require_approval: true,
        expected_policy_revision: 4,
      }),
    );
  });

  it("disables a connection and revokes its token only after confirmation", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentConnections />);
    const sheet = await openConnection(user);

    await user.click(
      within(sheet).getByRole("button", { name: "Disable connection" }),
    );
    const disable = screen.getByRole("alertdialog", {
      name: "Disable Library reader?",
    });
    expect(apiMock.mock.calls.some(([, method]) => method === "PATCH")).toBe(
      false,
    );
    await user.click(
      within(disable).getByRole("button", { name: "Disable connection" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`, "PATCH", {
        enabled: false,
        expected_policy_revision: 4,
      }),
    );

    await user.click(
      within(sheet).getByRole("button", { name: "Revoke token" }),
    );
    const revoke = screen.getByRole("alertdialog", {
      name: "Revoke access for Library reader?",
    });
    await user.click(
      within(revoke).getByRole("button", { name: "Revoke token" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/credentials/credential-one/revoke`,
        "POST",
      ),
    );
  });

  it("registers an OAuth app with its redirect URIs and metadata address", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentConnections />);
    expect(
      await screen.findByText(
        "Register an app before anyone can connect with OAuth.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Register app" }));
    const dialog = screen.getByRole("dialog", { name: "Register OAuth app" });
    await user.type(
      within(dialog).getByLabelText("Client ID"),
      "  https://agent.example/client.json ",
    );
    await user.click(
      within(dialog).getByLabelText(
        "Verify the client ID as a public metadata document",
      ),
    );
    await user.type(
      within(dialog).getByLabelText("App name"),
      " Remote agent  ",
    );
    await user.type(
      within(dialog).getByLabelText("Redirect URIs (one per line)"),
      " https://agent.example/callback {Enter}{Enter}http://127.0.0.1/cb",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Register app" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${base}/oauth-clients`, "POST", {
        client_id: "https://agent.example/client.json",
        name: "Remote agent",
        redirect_uris: [
          "https://agent.example/callback",
          "http://127.0.0.1/cb",
        ],
        scopes: ["library.health.read"],
        metadata_url: "https://agent.example/client.json",
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("OAuth app registered");
  });

  it("disables an OAuth app after confirmation", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string, method = "GET") => {
      if (method === "POST") return Promise.resolve({ updated: true });
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
      return readDefault(path, [integration]);
    });
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByText("Remote agent");

    await user.click(screen.getByRole("button", { name: "Disable" }));
    const confirmation = screen.getByRole("alertdialog", {
      name: "Disable Remote agent?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Disable app" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/oauth-clients/update`,
        "POST",
        { client_id: "remote-client", enabled: false },
      ),
    );
  });

  it("keeps a later-page connection current after rotating and revoking its token", async () => {
    const user = userEvent.setup();
    const oldToken = {
      credential_id: "credential-old",
      expires_at: "2030-01-01T00:00:00Z",
      revoked_at: null as string | null,
    };
    const newToken = {
      credential_id: "credential-new",
      expires_at: "2031-06-01T00:00:00Z",
      revoked_at: null as string | null,
    };
    let later: AgentIntegration = {
      ...integration,
      principal_id: "service-two",
      name: "Night operator",
      credentials: [oldToken],
    };
    apiMock.mockImplementation((path: string) => {
      if (path === `${base}/credentials/credential-old/rotate`) {
        later = {
          ...later,
          credentials: [
            newToken,
            { ...oldToken, revoked_at: "2026-10-19T12:00:00Z" },
          ],
        };
        return Promise.resolve({
          ...secret,
          credential_id: newToken.credential_id,
          expires_at: newToken.expires_at,
        });
      }
      if (path === `${base}/credentials/credential-new/revoke`) {
        later = {
          ...later,
          credentials: (later.credentials ?? []).map((credential) => ({
            ...credential,
            revoked_at: credential.revoked_at ?? "2026-10-19T12:05:00Z",
          })),
        };
        return Promise.resolve({ revoked: true });
      }
      if (path === `${base}?limit=20`)
        return Promise.resolve({ items: [integration], next_cursor: "one" });
      if (path === `${base}?limit=20&cursor=one`)
        return Promise.resolve({ items: [later], next_cursor: null });
      if (path === `${base}/service-two`) return Promise.resolve(later);
      return readDefault(path, [integration]);
    });
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByRole("button", { name: "Library reader" });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    const sheet = await openConnection(user, "Night operator");
    const tokens = within(sheet).getByRole("region", { name: "Token" });
    expect(activeTokenExpiries(tokens)).toEqual([oldToken.expires_at]);

    await user.click(
      within(tokens).getByRole("button", { name: "Rotate token" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Rotate token",
      }),
    );
    expect(
      await within(sheet).findByRole("textbox", { name: "New token" }),
    ).toHaveValue(secret.token);
    await waitFor(() =>
      expect(activeTokenExpiries(tokens)).toEqual([newToken.expires_at]),
    );
    expect(
      within(tokens).getAllByRole("button", { name: "Rotate token" }),
    ).toHaveLength(1);
    expect(apiMock).toHaveBeenCalledWith(`${base}/service-two`);

    await user.click(
      within(tokens).getByRole("button", { name: "Revoke token" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Revoke token",
      }),
    );
    expect(
      await within(tokens).findByText("This connection has no active token."),
    ).toBeInTheDocument();
    expect(
      within(tokens).queryByRole("button", { name: "Revoke token" }),
    ).not.toBeInTheDocument();
    expect(
      within(tokens).queryByRole("button", { name: "Rotate token" }),
    ).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Night operator" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Library reader" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Night operator" }),
    ).toHaveTextContent("Token revoked");
    expect(
      apiMock.mock.calls.filter(([path]) => path === `${base}?limit=20`),
    ).toHaveLength(1);
  });

  it("keeps the loaded connections when the next page fails and retries it", async () => {
    const user = userEvent.setup();
    const second = {
      ...integration,
      principal_id: "service-two",
      name: "Night operator",
    };
    let failNextPage = true;
    apiMock.mockImplementation((path: string) => {
      if (path === `${base}?limit=20`)
        return Promise.resolve({ items: [integration], next_cursor: "one" });
      if (path === `${base}?limit=20&cursor=one`) {
        if (failNextPage) {
          failNextPage = false;
          return Promise.reject(new Error("Gateway timeout"));
        }
        return Promise.resolve({ items: [second], next_cursor: null });
      }
      return readDefault(path, []);
    });
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByRole("button", { name: "Library reader" });

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "More connections could not be loaded.",
    );
    expect(
      screen.getByRole("button", { name: "Library reader" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "Night operator" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Library reader" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.filter(([path]) => path === `${base}?limit=20`),
    ).toHaveLength(1);
  });

  it("submits the OAuth app form with Enter in the client ID field", async () => {
    const user = userEvent.setup();
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByText(
      "Register an app before anyone can connect with OAuth.",
    );

    await user.click(screen.getByRole("button", { name: "Register app" }));
    const dialog = screen.getByRole("dialog", { name: "Register OAuth app" });
    await user.type(within(dialog).getByLabelText("App name"), "Remote agent");
    await user.type(
      within(dialog).getByLabelText("Redirect URIs (one per line)"),
      "https://agent.example/callback",
    );
    await user.type(
      within(dialog).getByLabelText("Client ID"),
      "remote-client{Enter}",
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`${base}/oauth-clients`, "POST", {
        client_id: "remote-client",
        name: "Remote agent",
        redirect_uris: ["https://agent.example/callback"],
        scopes: ["library.health.read"],
        metadata_url: null,
      }),
    );
  });

  it("locks the sheet when the approval switch conflicts and keeps the draft on reload", async () => {
    const user = userEvent.setup();
    let current = integration;
    apiMock.mockImplementation((path: string, method = "GET") => {
      if (method === "PATCH")
        return Promise.reject(
          Object.assign(new Error("Integration policy changed"), {
            status: 409,
          }),
        );
      return readDefault(path, [current]);
    });
    renderWithAdminProviders(<AgentConnections />);
    const sheet = await openConnection(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Edit permissions" }),
    );
    await user.click(within(sheet).getByRole("radio", { name: "Custom" }));
    await user.click(within(sheet).getByLabelText("Read instance status"));

    await user.click(
      within(sheet).getByLabelText("Require approval before changes"),
    );

    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "This connection changed since you opened it.",
    );
    expect(apiMock).toHaveBeenCalledWith(`${base}/service-one`, "PATCH", {
      grants: ["library.health.read"],
      require_approval: true,
      expected_policy_revision: 4,
    });
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      within(sheet).getByLabelText("Require approval before changes"),
    ).toBeDisabled();
    expect(within(sheet).getByLabelText("Read instance status")).toBeChecked();

    current = { ...integration, policy_revision: 6 };
    await user.click(
      within(sheet).getByRole("button", { name: "Reload policy" }),
    );
    expect(
      await within(sheet).findByText(
        "Policy reloaded. Your proposed permissions are preserved; review them before saving.",
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Read instance status")).toBeChecked();
    expect(within(sheet).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(
      within(sheet).getByLabelText("Require approval before changes"),
    ).toBeEnabled();
  });

  it("warns beside a rotated token when MCP is turned off", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string, method = "GET") => {
      if (method !== "GET") return Promise.resolve(secret);
      if (path === `${base}/catalog`)
        return Promise.resolve({ ...catalog, mcp_enabled: false });
      return readDefault(path, [integration]);
    });
    renderWithAdminProviders(<AgentConnections />);
    const sheet = await openConnection(user);

    await user.click(
      within(sheet).getByRole("button", { name: "Rotate token" }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Rotate token",
      }),
    );

    expect(
      await within(sheet).findByRole("textbox", { name: "New token" }),
    ).toHaveValue(secret.token);
    expect(
      within(sheet).getByText(
        "MCP is turned off on this server. Agents can't connect until it is enabled.",
      ),
    ).toBeInTheDocument();
  });

  it("starts a new OAuth app with no access when no preset can be granted", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string, method = "GET") => {
      if (method === "POST") return Promise.resolve({ registered: true });
      if (path === `${base}/catalog`)
        return Promise.resolve({
          ...catalog,
          presets: [
            {
              ...catalog.presets[0],
              scopes: ["library.health.read", "library.repair.photo_flag"],
            },
          ],
        });
      return readDefault(path, [integration]);
    });
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByText(
      "Register an app before anyone can connect with OAuth.",
    );

    await user.click(screen.getByRole("button", { name: "Register app" }));
    const dialog = screen.getByRole("dialog", { name: "Register OAuth app" });
    await user.type(within(dialog).getByLabelText("Client ID"), "remote");
    await user.type(within(dialog).getByLabelText("App name"), "Remote agent");
    await user.type(
      within(dialog).getByLabelText("Redirect URIs (one per line)"),
      "https://agent.example/callback",
    );
    expect(
      within(dialog).getByRole("radio", { name: "Read only" }),
    ).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "Custom" })).toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Register app" }),
    ).toBeDisabled();

    await user.click(within(dialog).getByLabelText("Inspect library health"));
    await user.click(
      within(dialog).getByRole("button", { name: "Register app" }),
    );
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        `${base}/oauth-clients`,
        "POST",
        expect.objectContaining({ scopes: ["library.health.read"] }),
      ),
    );
  });

  it("reports a failed reload as such, not as a failed next page", async () => {
    const user = userEvent.setup();
    let failList = false;
    apiMock.mockImplementation((path: string) => {
      if (path === `${base}?limit=20`)
        return failList
          ? Promise.reject(new Error("Service unavailable"))
          : Promise.resolve({ items: [integration], next_cursor: null });
      return readDefault(path, []);
    });
    renderWithAdminProviders(<AgentConnections />);
    await screen.findByRole("button", { name: "Library reader" });

    failList = true;
    await user.click(
      screen.getByRole("button", { name: "Refresh connections" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Service unavailable");
    expect(alert).not.toHaveTextContent(
      "More connections could not be loaded.",
    );
    expect(
      screen.getByRole("button", { name: "Library reader" }),
    ).toBeInTheDocument();
  });
});
