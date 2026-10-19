import type { StatusTone } from "@/components/admin/StatusBadge";
import { humanizeKey } from "@/lib/humanize";

import type {
  AgentIntegration,
  AgentScope,
  AgentScopePreset,
} from "./agent-integrations";

export const MCP_URL_PLACEHOLDER = "https://<your-crate-api>/mcp";

/**
 * Human-readable status for a connection card: whether it is enabled, and
 * whether its credential (service) or sign-in (delegated) is still active.
 */
export function connectionStatus(
  item: AgentIntegration,
  now: number,
): { label: string; tone: StatusTone } {
  if (!item.enabled) return { label: "Disabled", tone: "neutral" };

  if (item.kind === "service") {
    const active = (item.credentials ?? []).filter(
      (credential) => credential.revoked_at === null,
    );
    if (active.length === 0) return { label: "Token revoked", tone: "danger" };
    const allExpired = active.every(
      (credential) => Date.parse(credential.expires_at) <= now,
    );
    if (allExpired) return { label: "Token expired", tone: "warning" };
    return { label: "Enabled", tone: "success" };
  }

  const hasActiveAuthorization = (item.authorizations ?? []).some(
    (authorization) => authorization.revoked_at === null,
  );
  if (!hasActiveAuthorization)
    return { label: "Not signed in", tone: "neutral" };
  return { label: "Enabled", tone: "success" };
}

/**
 * "1 permission" / "n permissions", plus a count of how many of those grants
 * can change things (as opposed to only reading). A grant without a matching
 * catalog entry is treated as a change, since its access level is unknown.
 */
export function permissionSummary(
  grants: string[],
  scopes: AgentScope[],
): string {
  const byScope = new Map(scopes.map((scope) => [scope.scope, scope]));
  const changeCount = grants.filter((grant) => {
    const scope = byScope.get(grant);
    return !scope || scope.access === "change";
  }).length;
  const base =
    grants.length === 1 ? "1 permission" : `${grants.length} permissions`;
  return changeCount > 0 ? `${base} · ${changeCount} can change things` : base;
}

export function approvalPolicyText(requireApproval: boolean): string {
  return requireApproval
    ? "Changes need approval"
    : "Some changes run directly";
}

/** The catalog label for a scope id, falling back to the id itself. */
export function scopeLabel(scope: string, scopes: AgentScope[]): string {
  return scopes.find((candidate) => candidate.scope === scope)?.label ?? scope;
}

/**
 * The id of the preset whose scopes exactly match `grants` (set equality,
 * order-independent), or "custom" when no preset matches.
 */
export function presetForGrants(
  grants: string[],
  presets: AgentScopePreset[],
): string {
  const grantSet = new Set(grants);
  const match = presets.find((preset) => {
    if (preset.scopes.length !== grantSet.size) return false;
    return preset.scopes.every((scope) => grantSet.has(scope));
  });
  return match?.id ?? "custom";
}

/**
 * Why a preset cannot currently be granted: the label of the first scope it
 * needs that the caller cannot grant, or null when every scope is grantable.
 */
export function presetUnavailableReason(
  preset: AgentScopePreset,
  scopes: AgentScope[],
): string | null {
  const byScope = new Map(scopes.map((scope) => [scope.scope, scope]));
  const missing = preset.scopes
    .map((scope) => byScope.get(scope))
    .find((scope) => scope?.can_grant === false);
  if (!missing) return null;
  return `Needs a permission you don't have: ${missing.label}`;
}

const ACTIVITY_TEXT: Record<string, string> = {
  "agent.integration.created": "Connection created",
  "agent.integration.updated": "Permissions or approval policy changed",
  "agent.credential.created": "Token issued",
  "agent.integration.rotated": "Token rotated",
  "agent.credential.rotated": "Token rotated",
  "agent.integration.revoked": "Token revoked",
  "agent.credential.revoked": "Token revoked",
  "agent.principal.disabled": "Connection disabled",
  "agent.principal.enabled": "Connection enabled",
  "agent.oauth.authorization.consented": "Signed in through OAuth",
  "agent.oauth.authorization.revoked": "OAuth sign-in revoked",
  "agent.oauth.authorization.managed_revocation":
    "OAuth sign-in revoked by an admin",
  "agent.plan.prepared": "Prepared a plan",
  "agent.command.accepted": "Started a job",
  "agent.command.cancelled": "Cancelled a job",
  "agent.command.failed": "A job failed",
  "agent.operation.finished": "Finished a job",
  "agent.repair.previewed": "Previewed a repair",
  "agent.repair.applied": "Applied a repair",
  "agent.repair.verified": "Verified a repair",
  "agent.health.observed": "Checked library health",
  "agent.diagnostic": "Read diagnostics",
  "mcp.tool.denied": "A tool call was denied",
  "mcp.tool.rate_limited": "Rate limited",
  "mcp.auth.denied": "Sign-in was denied",
};

/**
 * Prose for one activity entry: a known action maps to a fixed phrase;
 * anything else is humanized from the text after its first dot. Appends the
 * humanized tool name when the evidence names one.
 */
export function activityText(entry: {
  action: string;
  evidence: { tool?: string };
}): string {
  const known = ACTIVITY_TEXT[entry.action];
  const base =
    known ??
    humanizeKey(
      entry.action.slice(entry.action.indexOf(".") + 1).replace(/\./g, " "),
    );
  return entry.evidence.tool
    ? `${base} · ${humanizeKey(entry.evidence.tool)}`
    : base;
}

/** Client configuration snippets for connecting to Crate's MCP server. */
export function mcpSnippets(
  url: string | null,
  token: string,
): { claudeCode: string; codex: string; http: string } {
  const u = url ?? MCP_URL_PLACEHOLDER;
  return {
    claudeCode: `claude mcp add --transport http crate ${u} --header "Authorization: Bearer ${token}"`,
    codex: `export CRATE_MCP_TOKEN="${token}"\n\n# ~/.codex/config.toml\n[mcp_servers.crate]\nurl = "${u}"\nbearer_token_env_var = "CRATE_MCP_TOKEN"`,
    http: `URL: ${u}\nHeader: Authorization: Bearer ${token}`,
  };
}
