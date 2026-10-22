import {
  PageHeaderAction,
  PageHeaderActions,
  PageHeaderLayout,
} from "@/components/layout/PageHeader";
import {
  RefreshCw as HeaderRefreshCw,
  GitMerge as HeaderGitMerge,
  DatabaseBackup as HeaderDatabaseBackup,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  OpsPanel,
  OpsStatTile,
  OpsSurface,
} from "@/components/admin/ops-surfaces";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Badge } from "@crate/ui/shadcn/badge";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

interface GlobalCatalogStatus {
  serving_mode:
    "global-ready" | "global-refreshing" | "global-degraded" | "local-fallback";
  state: {
    status: string;
  };
  counts: {
    artists: number;
    albums: number;
    tracks: number;
    sources: number;
  };
  last_run?: GlobalCatalogRun | null;
  stale_peer_count: number;
  ambiguous_candidate_count: number;
}

interface GlobalCatalogRun {
  run_id: string;
  mode: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  source_rows_seen: number;
  sources_upserted: number;
  canonical_created: number;
  canonical_updated: number;
  error?: string | null;
}

interface DuplicateCandidate {
  entity_type: string;
  match_key: string;
  source_count: number;
  sources: Array<{
    source_kind: string;
    node_uid?: string | null;
    remote_entity_uid?: string | null;
    local_entity_uid?: string | null;
    global_entity_uid?: string | null;
    match_confidence?: number | null;
    match_method?: string | null;
  }>;
}

type Tab = "overview" | "runs" | "duplicates";

const tabs: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "runs", label: "Runs" },
  { key: "duplicates", label: "Duplicates" },
];

const numberFormatter = new Intl.NumberFormat();

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatNumber(value: number | undefined) {
  return numberFormatter.format(value || 0);
}

function servingModeLabel(mode?: GlobalCatalogStatus["serving_mode"]) {
  const labels: Record<GlobalCatalogStatus["serving_mode"], string> = {
    "global-ready": "Global ready",
    "global-refreshing": "Global refreshing",
    "global-degraded": "Global degraded",
    "local-fallback": "Local fallback",
  };
  return mode ? labels[mode] : "Unknown";
}

function servingModeDescription(mode?: GlobalCatalogStatus["serving_mode"]) {
  if (mode === "local-fallback") {
    return "First reconciliation in progress; local reads remain available.";
  }
  if (mode === "global-refreshing") {
    return "Reconciliation in progress; serving the last complete global catalog.";
  }
  if (mode === "global-degraded") {
    return "Reconciliation failed; serving the last complete global catalog.";
  }
  if (mode === "global-ready") {
    return "Serving the current complete global catalog.";
  }
  return "Catalog serving status is unavailable.";
}

export function GlobalCatalog() {
  const { hasAnyCapability } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [reconciling, setReconciling] = useState<"incremental" | "full" | null>(
    null,
  );
  const canManage = hasAnyCapability(["federation.policy.manage"]);
  const {
    data: status,
    loading,
    refetch: refetchStatus,
  } = useApi<GlobalCatalogStatus>("/api/admin/global-catalog/status");
  const { data: runs, refetch: refetchRuns } = useApi<{
    items: GlobalCatalogRun[];
  }>("/api/admin/global-catalog/runs?limit=25");
  const { data: duplicates } = useApi<{ items: DuplicateCandidate[] }>(
    "/api/admin/global-catalog/duplicates?limit=50",
  );

  async function queueReconcile(mode: "incremental" | "full") {
    setReconciling(mode);
    try {
      await api("/api/admin/global-catalog/reconcile", "POST", { mode });
      toast.success(
        mode === "full"
          ? "Full reconciliation queued"
          : "Incremental reconciliation queued",
      );
      await Promise.all([refetchStatus(), refetchRuns()]);
    } catch {
      toast.error("Failed to queue reconciliation");
    } finally {
      setReconciling(null);
    }
  }

  const counts = status?.counts;
  const runItems = runs?.items || [];
  const duplicateItems = duplicates?.items || [];

  return (
    <main className="min-w-0 space-y-6">
      <PageHeaderLayout
        actions={
          <PageHeaderActions>
            <PageHeaderAction
              label="Refresh"
              onClick={() => void refetchStatus()}
              disabled={loading}
            >
              <HeaderRefreshCw
                data-admin-ux="header-refresh"
                aria-hidden="true"
              />
            </PageHeaderAction>
            <PageHeaderAction
              label="Reconcile"
              aria-busy={reconciling === "incremental"}
              disabled={!canManage || reconciling !== null}
              onClick={() => void queueReconcile("incremental")}
            >
              {reconciling === "incremental" ? (
                <Loader2
                  aria-hidden="true"
                  data-admin-ux="catalog-incremental-loading"
                  className="h-4 w-4 animate-spin"
                />
              ) : null}
              {!(reconciling === "incremental") ? (
                <HeaderGitMerge
                  data-admin-ux="header-reconcile"
                  aria-hidden="true"
                />
              ) : null}
            </PageHeaderAction>
            <PageHeaderAction
              label="Full rebuild"
              aria-busy={reconciling === "full"}
              disabled={!canManage || reconciling !== null}
              onClick={() => void queueReconcile("full")}
            >
              {reconciling === "full" ? (
                <Loader2
                  aria-hidden="true"
                  data-admin-ux="catalog-full-loading"
                  className="h-4 w-4 animate-spin"
                />
              ) : null}
              {!(reconciling === "full") ? (
                <HeaderDatabaseBackup
                  data-admin-ux="header-full-rebuild"
                  aria-hidden="true"
                />
              ) : null}
            </PageHeaderAction>
          </PageHeaderActions>
        }
      >
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Global Catalog
          </h1>
          <p className="text-sm text-muted-foreground">
            Canonical deduped collection built from local library and trusted
            federated catalogs.
          </p>
        </div>
      </PageHeaderLayout>

      <div
        role="group"
        aria-label="Global catalog views"
        className="flex min-w-0 gap-2 overflow-x-auto border-b border-border-quiet"
      >
        {tabs.map((item) => (
          <button
            type="button"
            aria-pressed={tab === item.key}
            key={item.key}
            className={`min-h-11 shrink-0 border-b-2 px-3 py-2 transition-colors ${
              tab === item.key
                ? "border-accent-action-hi text-accent-action-hi"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(item.key)}
          >
            <MonoLabel as="span" tone={tab === item.key ? "accent" : "subtle"}>
              {item.label}
            </MonoLabel>
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <MetricCard label="Artists" value={formatNumber(counts?.artists)} />
            <MetricCard label="Albums" value={formatNumber(counts?.albums)} />
            <MetricCard label="Tracks" value={formatNumber(counts?.tracks)} />
            <MetricCard
              label="Entity sources"
              value={formatNumber(counts?.sources)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <OpsPanel title="Read model">
              <div className="space-y-4 text-sm">
                <StatusDot
                  tone={
                    status?.serving_mode === "global-degraded"
                      ? "warn"
                      : status?.serving_mode === "global-ready"
                        ? "on"
                        : "off"
                  }
                  label={servingModeLabel(status?.serving_mode)}
                />
                <p className="m-0 text-text-muted">
                  {servingModeDescription(status?.serving_mode)}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <OpsSurface className="p-3">
                    <MonoLabel as="div">Reconciliation state</MonoLabel>
                    <p className="mb-0 mt-1 text-text-primary">
                      {status?.state.status || "unknown"}
                    </p>
                  </OpsSurface>
                  <OpsSurface className="p-3">
                    <MonoLabel as="div">Stale peers</MonoLabel>
                    <p className="mb-0 mt-1 tabular-nums text-text-primary">
                      {status ? formatNumber(status.stale_peer_count) : "—"}
                    </p>
                  </OpsSurface>
                  <OpsSurface className="p-3 sm:col-span-2">
                    <MonoLabel as="div">Unresolved match candidates</MonoLabel>
                    <p className="mb-0 mt-1 tabular-nums text-text-primary">
                      {status
                        ? formatNumber(status.ambiguous_candidate_count)
                        : "—"}
                    </p>
                  </OpsSurface>
                </div>
                <p className="m-0 text-xs text-text-muted">
                  Similar sources below the automatic merge threshold; they
                  remain separate until reviewed.
                </p>
              </div>
            </OpsPanel>

            <OpsPanel title="Last run" className="lg:col-span-2">
              {status?.last_run ? (
                <RunSummary run={status.last_run} />
              ) : (
                <p className="m-0 text-sm text-text-muted">
                  No reconciliation runs yet.
                </p>
              )}
            </OpsPanel>
          </div>
        </div>
      ) : null}

      {tab === "runs" ? (
        <OpsPanel title="Reconciliation runs">
          <div className="space-y-3">
            {runItems.length ? (
              runItems.map((run) => <RunSummary key={run.run_id} run={run} />)
            ) : (
              <p className="m-0 text-sm text-text-muted">No runs found.</p>
            )}
          </div>
        </OpsPanel>
      ) : null}

      {tab === "duplicates" ? (
        <OpsPanel title="Duplicate candidates">
          <div className="space-y-3">
            {duplicateItems.length ? (
              duplicateItems.map((candidate) => (
                <OpsSurface
                  as="article"
                  key={`${candidate.entity_type}-${candidate.match_key}`}
                  className="p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{candidate.entity_type}</Badge>
                    <span className="min-w-0 break-all font-mono text-sm text-text-primary">
                      {candidate.match_key}
                    </span>
                    <MonoLabel as="span">
                      {candidate.source_count} sources
                    </MonoLabel>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {candidate.sources.map((source) => (
                      <OpsSurface
                        as="div"
                        key={`${source.source_kind}-${
                          source.node_uid ??
                          source.local_entity_uid ??
                          source.remote_entity_uid ??
                          source.global_entity_uid ??
                          source.match_method ??
                          "source"
                        }`}
                        className="min-w-0 p-3 text-xs text-text-muted"
                      >
                        <MonoLabel as="div" tone="accent">
                          {source.source_kind}
                        </MonoLabel>
                        <div className="break-all font-mono">
                          {source.node_uid || source.local_entity_uid}
                        </div>
                        <div className="break-all font-mono">
                          {source.match_method}
                        </div>
                      </OpsSurface>
                    ))}
                  </div>
                </OpsSurface>
              ))
            ) : (
              <p className="m-0 text-sm text-text-muted">
                No duplicate candidates above the confidence threshold.
              </p>
            )}
          </div>
        </OpsPanel>
      ) : null}
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <OpsStatTile label={label} value={value} />;
}

function RunSummary({ run }: { run: GlobalCatalogRun }) {
  return (
    <OpsSurface as="article" className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={run.status === "completed" ? "default" : "secondary"}>
            {run.status}
          </Badge>
          <MonoLabel as="span" tone="accent">
            {run.mode}
          </MonoLabel>
          <span className="break-all font-mono text-xs text-text-muted">
            {run.run_id}
          </span>
        </div>
        <MonoLabel as="span">{formatDate(run.started_at)}</MonoLabel>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-text-muted md:grid-cols-4">
        <span>Seen {formatNumber(run.source_rows_seen)}</span>
        <span>Upserted {formatNumber(run.sources_upserted)}</span>
        <span>Created {formatNumber(run.canonical_created)}</span>
        <span>Updated {formatNumber(run.canonical_updated)}</span>
      </div>
      {run.error ? (
        <p className="mt-3 text-sm text-state-warning-text">{run.error}</p>
      ) : null}
    </OpsSurface>
  );
}
