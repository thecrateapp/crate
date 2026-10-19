import { describe, expect, it } from "vitest";

import type {
  AgentIntegration,
  AgentScope,
  AgentScopePreset,
} from "./agent-integrations";
import {
  MCP_URL_PLACEHOLDER,
  activityText,
  approvalPolicyText,
  connectionStatus,
  mcpSnippets,
  permissionSummary,
  presetForGrants,
  presetUnavailableReason,
  scopeLabel,
} from "./agent-connections";

function integration(
  overrides: Partial<AgentIntegration> = {},
): AgentIntegration {
  return {
    principal_id: "svc-1",
    name: "Example integration",
    kind: "service",
    enabled: true,
    grants: [],
    require_approval: false,
    policy_revision: 1,
    last_activity_at: null,
    credentials: [],
    authorizations: null,
    ...overrides,
  };
}

const scopes: AgentScope[] = [
  {
    scope: "library.health.read",
    capability: "agents.integrations.manage",
    can_grant: true,
    label: "Inspect library health",
    group: "library",
    access: "read",
  },
  {
    scope: "library.repair.run",
    capability: "agents.repair.apply",
    can_grant: true,
    label: "Apply reviewed library repairs",
    group: "library",
    access: "change",
  },
  {
    scope: "library.repair.photo_flag",
    capability: "agents.repair.apply",
    can_grant: false,
    label: "Update an artist's photo flag",
    group: "library",
    access: "change",
  },
];

const readOnlyPreset: AgentScopePreset = {
  id: "read_only",
  label: "Read only",
  description: "Inspect library health. Cannot change anything.",
  scopes: ["library.health.read"],
};

const maintainerPreset: AgentScopePreset = {
  id: "library_maintainer",
  label: "Library maintainer",
  description: "Run checks and repairs.",
  scopes: ["library.health.read", "library.repair.run"],
};

const blockedPreset: AgentScopePreset = {
  id: "blocked",
  label: "Blocked preset",
  description: "Needs a permission nobody has.",
  scopes: ["library.repair.photo_flag"],
};

describe("connectionStatus", () => {
  const now = Date.parse("2026-10-19T00:00:00Z");

  it("reports a disabled integration regardless of kind", () => {
    expect(
      connectionStatus(
        integration({ enabled: false, kind: "delegated" }),
        now,
      ),
    ).toEqual({ label: "Disabled", tone: "neutral" });
  });

  it("reports a revoked token when no service credential is active", () => {
    expect(
      connectionStatus(
        integration({
          credentials: [
            {
              credential_id: "c1",
              expires_at: "2030-01-01T00:00:00Z",
              revoked_at: "2026-10-01T00:00:00Z",
            },
          ],
        }),
        now,
      ),
    ).toEqual({ label: "Token revoked", tone: "danger" });
  });

  it("reports an expired token when every active credential is past expiry", () => {
    expect(
      connectionStatus(
        integration({
          credentials: [
            {
              credential_id: "c1",
              expires_at: "2020-01-01T00:00:00Z",
              revoked_at: null,
            },
          ],
        }),
        now,
      ),
    ).toEqual({ label: "Token expired", tone: "warning" });
  });

  it("reports enabled when a service credential is active and unexpired", () => {
    expect(
      connectionStatus(
        integration({
          credentials: [
            {
              credential_id: "c1",
              expires_at: "2030-01-01T00:00:00Z",
              revoked_at: null,
            },
          ],
        }),
        now,
      ),
    ).toEqual({ label: "Enabled", tone: "success" });
  });

  it("reports not signed in for a delegated connection with no active authorization", () => {
    expect(
      connectionStatus(
        integration({
          kind: "delegated",
          credentials: null,
          authorizations: [
            {
              authorization_id: "a1",
              user_id: 1,
              client_id: "client-1",
              revoked_at: "2026-10-01T00:00:00Z",
            },
          ],
        }),
        now,
      ),
    ).toEqual({ label: "Not signed in", tone: "neutral" });
  });

  it("reports enabled for a delegated connection with an active authorization", () => {
    expect(
      connectionStatus(
        integration({
          kind: "delegated",
          credentials: null,
          authorizations: [
            {
              authorization_id: "a1",
              user_id: 1,
              client_id: "client-1",
              revoked_at: null,
            },
          ],
        }),
        now,
      ),
    ).toEqual({ label: "Enabled", tone: "success" });
  });
});

describe("permissionSummary", () => {
  it("counts permissions and how many can change things", () => {
    expect(
      permissionSummary(["library.health.read", "library.repair.run"], scopes),
    ).toBe("2 permissions · 1 can change things");
  });

  it("uses the singular form for a single permission", () => {
    expect(permissionSummary(["library.health.read"], scopes)).toBe(
      "1 permission",
    );
  });

  it("omits the change count when nothing can change", () => {
    expect(permissionSummary(["library.health.read"], scopes)).not.toContain(
      "can change",
    );
  });

  it("counts an unknown scope as a change", () => {
    expect(permissionSummary(["unknown.scope"], scopes)).toBe(
      "1 permission · 1 can change things",
    );
  });
});

describe("approvalPolicyText", () => {
  it("describes required approval", () => {
    expect(approvalPolicyText(true)).toBe("Changes need approval");
  });

  it("describes direct changes", () => {
    expect(approvalPolicyText(false)).toBe("Some changes run directly");
  });
});

describe("scopeLabel", () => {
  it("returns the catalog label", () => {
    expect(scopeLabel("library.health.read", scopes)).toBe(
      "Inspect library health",
    );
  });

  it("falls back to the scope id", () => {
    expect(scopeLabel("unknown.scope", scopes)).toBe("unknown.scope");
  });
});

describe("presetForGrants", () => {
  const presets = [readOnlyPreset, maintainerPreset];

  it("matches a preset with the same scopes regardless of order", () => {
    expect(
      presetForGrants(["library.repair.run", "library.health.read"], presets),
    ).toBe("library_maintainer");
  });

  it("returns custom when no preset matches", () => {
    expect(presetForGrants(["library.repair.run"], presets)).toBe("custom");
  });
});

describe("presetUnavailableReason", () => {
  it("names the first scope the caller cannot grant", () => {
    expect(presetUnavailableReason(blockedPreset, scopes)).toBe(
      "Needs a permission you don't have: Update an artist's photo flag",
    );
  });

  it("returns null when every scope can be granted", () => {
    expect(presetUnavailableReason(maintainerPreset, scopes)).toBeNull();
  });
});

describe("activityText", () => {
  const cases: [string, string][] = [
    ["agent.integration.created", "Connection created"],
    ["agent.integration.updated", "Permissions or approval policy changed"],
    ["agent.credential.created", "Token issued"],
    ["agent.integration.rotated", "Token rotated"],
    ["agent.credential.rotated", "Token rotated"],
    ["agent.integration.revoked", "Token revoked"],
    ["agent.credential.revoked", "Token revoked"],
    ["agent.principal.disabled", "Connection disabled"],
    ["agent.principal.enabled", "Connection enabled"],
    ["agent.oauth.authorization.consented", "Signed in through OAuth"],
    ["agent.oauth.authorization.revoked", "OAuth sign-in revoked"],
    [
      "agent.oauth.authorization.managed_revocation",
      "OAuth sign-in revoked by an admin",
    ],
    ["agent.plan.prepared", "Prepared a plan"],
    ["agent.command.accepted", "Started a job"],
    ["agent.command.cancelled", "Cancelled a job"],
    ["agent.command.failed", "A job failed"],
    ["agent.operation.finished", "Finished a job"],
    ["agent.repair.previewed", "Previewed a repair"],
    ["agent.repair.applied", "Applied a repair"],
    ["agent.repair.verified", "Verified a repair"],
    ["agent.health.observed", "Checked library health"],
    ["agent.diagnostic", "Read diagnostics"],
    ["mcp.tool.denied", "A tool call was denied"],
    ["mcp.tool.rate_limited", "Rate limited"],
    ["mcp.auth.denied", "Sign-in was denied"],
  ];

  it.each(cases)("maps %s to %s", (action, expected) => {
    expect(activityText({ action, evidence: {} })).toBe(expected);
  });

  it("humanizes an unmapped action after the first dot", () => {
    expect(activityText({ action: "agent.unknown.thing", evidence: {} })).toBe(
      "Unknown thing",
    );
  });

  it("appends the humanized tool when evidence includes one", () => {
    expect(
      activityText({
        action: "agent.repair.applied",
        evidence: { tool: "apply_repairs" },
      }),
    ).toBe("Applied a repair · Apply repairs");
  });
});

describe("mcpSnippets", () => {
  it("falls back to the placeholder URL and includes the bearer token", () => {
    const snippets = mcpSnippets(null, "crate_mcp_x");
    expect(snippets.claudeCode).toContain(MCP_URL_PLACEHOLDER);
    expect(snippets.claudeCode).toContain("Bearer crate_mcp_x");
  });

  it("builds the exact claude code command", () => {
    const snippets = mcpSnippets("https://api.example.com/mcp", "tok");
    expect(snippets.claudeCode).toBe(
      'claude mcp add --transport http crate https://api.example.com/mcp --header "Authorization: Bearer tok"',
    );
  });

  it("builds the codex snippet with the bearer token env var", () => {
    const snippets = mcpSnippets("https://api.example.com/mcp", "tok");
    expect(snippets.codex).toBe(
      'export CRATE_MCP_TOKEN="tok"\n\n# ~/.codex/config.toml\n[mcp_servers.crate]\nurl = "https://api.example.com/mcp"\nbearer_token_env_var = "CRATE_MCP_TOKEN"',
    );
  });

  it("builds the plain http snippet", () => {
    const snippets = mcpSnippets("https://api.example.com/mcp", "tok");
    expect(snippets.http).toBe(
      "URL: https://api.example.com/mcp\nHeader: Authorization: Bearer tok",
    );
  });
});
