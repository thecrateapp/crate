import { useId, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { ConnectAgentDialog } from "@/components/agents/connections/ConnectAgentDialog";
import { ConnectionSheet } from "@/components/agents/connections/ConnectionSheet";
import { OAuthApps } from "@/components/agents/connections/OAuthApps";
import { useCursorList } from "@/components/agents/connections/use-cursor-list";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import {
  approvalPolicyText,
  connectionStatus,
  permissionSummary,
} from "@/lib/agent-connections";
import type {
  AgentCatalog,
  AgentIntegration,
  AgentScope,
} from "@/lib/agent-integrations";
import {
  apiErrorText,
  connectionKindLabel,
} from "@/lib/agent-plan-presentation";

const base = "/api/admin/agent-integrations";

function onOff(label: string, on: boolean) {
  return (
    <StatusBadge tone={on ? "success" : "neutral"}>
      {`${label} ${on ? "on" : "off"}`}
    </StatusBadge>
  );
}

/** The active credential that expires last, if the connection has one. */
function activeCredential(item: AgentIntegration) {
  return (item.credentials ?? [])
    .filter((credential) => credential.revoked_at === null)
    .reduce<NonNullable<AgentIntegration["credentials"]>[number] | null>(
      (latest, credential) =>
        !latest ||
        Date.parse(credential.expires_at) > Date.parse(latest.expires_at)
          ? credential
          : latest,
      null,
    );
}

function ConnectionRow({
  item,
  scopes,
  now,
  onOpen,
}: {
  item: AgentIntegration;
  scopes: AgentScope[];
  now: number;
  onOpen: () => void;
}) {
  const nameId = useId();
  const detailsId = useId();
  const statusId = useId();
  const status = connectionStatus(item, now);
  const credential = item.kind === "service" ? activeCredential(item) : null;
  const expired = credential ? Date.parse(credential.expires_at) <= now : false;

  return (
    <li>
      <button
        type="button"
        aria-labelledby={nameId}
        aria-describedby={`${detailsId} ${statusId}`}
        onClick={onOpen}
        className="flex w-full flex-col gap-2 rounded-md border border-white/10 bg-white/[0.02] p-4 text-left transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring md:flex-row md:items-center md:justify-between"
      >
        <span className="block min-w-0 space-y-1">
          <span
            id={nameId}
            className="block font-medium text-foreground [overflow-wrap:anywhere]"
          >
            {item.name}
          </span>
          <span
            id={detailsId}
            className="block space-y-0.5 text-sm text-muted-foreground"
          >
            <span className="block">
              {[
                connectionKindLabel(item.kind),
                permissionSummary(item.grants, scopes),
                approvalPolicyText(item.require_approval),
              ].join(" · ")}
            </span>
            <span className="block">
              {item.last_activity_at ? (
                <>
                  Last used <RelativeTime value={item.last_activity_at} />
                </>
              ) : (
                "Never used"
              )}
              {credential ? (
                <>
                  {expired ? " · Token expired " : " · Token expires "}
                  <RelativeTime value={credential.expires_at} />
                </>
              ) : null}
            </span>
          </span>
        </span>
        <span id={statusId} className="shrink-0">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </span>
      </button>
    </li>
  );
}

export function AgentConnections() {
  const { hasCapability } = useAuth();
  const canManage = hasCapability("agents.integrations.manage");
  const canReadActivity = hasCapability("agents.activity.view");
  const canReviewPlans = hasCapability("agents.plans.review");
  const now = useNow(60_000);
  const connections = useCursorList<AgentIntegration>(
    canManage ? `${base}?limit=20` : null,
    (item) => item.principal_id,
  );
  const catalog = useApi<AgentCatalog>(canManage ? `${base}/catalog` : null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [selected, setSelected] = useState<AgentIntegration | null>(null);
  // Remounting the OAuth apps panel reloads its list from the first page.
  const [oauthGeneration, setOauthGeneration] = useState(0);

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        You do not have permission to manage agent connections.
      </p>
    );
  }

  // The sheet shows the freshest copy: the one it re-read after a change
  // (patched into the list as well) or the list's own after a reload.
  const current = selected
    ? (connections.items.find(
        (item) => item.principal_id === selected.principal_id,
      ) ?? selected)
    : null;
  const error = catalog.error
    ? catalog.error
    : connections.moreFailed
      ? "More connections could not be loaded."
      : connections.error;
  // Rows summarise grants with the catalog's access levels, so they wait for
  // it rather than briefly counting every grant as a change.
  const listLoading =
    (connections.loading && connections.items.length === 0) ||
    (catalog.loading && !catalog.data);
  const scopes = catalog.data?.scopes ?? null;

  function refreshAll() {
    connections.reload();
    catalog.refetch();
    setOauthGeneration((value) => value + 1);
  }

  function connectionChanged(fresh: AgentIntegration) {
    // Patch the changed row in place so the pages already loaded stay put.
    connections.replace(fresh);
    setSelected(fresh);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1.5">
          {catalog.data ? (
            <>
              <div className="flex flex-wrap gap-2">
                {onOff("MCP", catalog.data.mcp_enabled)}
                {onOff("Changes", catalog.data.actions_enabled)}
                {onOff("OAuth", catalog.data.oauth_enabled)}
              </div>
              <p className="text-sm text-muted-foreground">
                {`${catalog.data.limits.calls_per_minute} calls/min · ${catalog.data.limits.concurrent_calls} at once · ${catalog.data.limits.active_maintenance_jobs} maintenance job per connection`}
              </p>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReviewPlans ? (
            <Button variant="link" asChild>
              <Link to="/agents/approvals">Review plans</Link>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh connections"
            onClick={refreshAll}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
          <Button disabled={!catalog.data} onClick={() => setConnectOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Connect an agent
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-state-warning-text">
          {apiErrorText(error, "The connections could not be loaded.")}
        </p>
      ) : null}

      <OpsPanel
        title="Connections"
        description="Agents that can reach Crate with a token or through an OAuth sign-in."
      >
        <div className="space-y-3">
          {listLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading connections…
            </p>
          ) : null}
          {!listLoading && !error && connections.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents are connected yet. Connect one to let it inspect or
              maintain Crate.
            </p>
          ) : null}
          {scopes && connections.items.length > 0 ? (
            <ul className="space-y-3">
              {connections.items.map((item) => (
                <ConnectionRow
                  key={item.principal_id}
                  item={item}
                  scopes={scopes}
                  now={now}
                  onOpen={() => setSelected(item)}
                />
              ))}
            </ul>
          ) : null}
          {connections.error || catalog.error ? (
            <Button
              variant="outline"
              disabled={connections.loadingMore}
              onClick={() => {
                // A failed next page is asked for again; the rows already
                // shown stay.
                if (connections.error) connections.retry();
                if (catalog.error) catalog.refetch();
              }}
            >
              Try again
            </Button>
          ) : connections.nextCursor ? (
            <Button
              variant="outline"
              disabled={connections.loadingMore}
              onClick={connections.loadMore}
            >
              {connections.loadingMore ? "Loading more…" : "Load more"}
            </Button>
          ) : null}
        </div>
      </OpsPanel>

      {catalog.data ? (
        <OAuthApps key={oauthGeneration} catalog={catalog.data} />
      ) : null}

      {catalog.data ? (
        <ConnectAgentDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          catalog={catalog.data}
          onCreated={connections.reload}
        />
      ) : null}

      {current && catalog.data ? (
        <ConnectionSheet
          key={current.principal_id}
          integration={current}
          catalog={catalog.data}
          canReadActivity={canReadActivity}
          onChanged={connectionChanged}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
