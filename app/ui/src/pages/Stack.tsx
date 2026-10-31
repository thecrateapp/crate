import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  ExternalLink,
  ListOrdered,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
} from "@crate/ui/icons";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsSnapshotStatus,
  type OpsStreamStatus,
} from "@/components/admin/ops-surfaces";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";

import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { api } from "@/lib/api";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string[];
}

interface StackStatus {
  available: boolean;
  total: number;
  running: number;
  containers: Container[];
}

interface StackSnapshotData {
  snapshot: {
    scope: string;
    subject_key: string;
    version: number;
    built_at?: string | null;
    stale_after?: string | null;
    stale: boolean;
    generation_ms: number;
  };
  stack: StackStatus;
}

interface ContainerLogs {
  name: string;
  logs: string;
}

type ServiceFilter = "all" | "running" | "stopped";

const SERVICE_URLS: Record<string, string> = {
  traefik: "https://traefik.lespedants.org",
};

const STATE_TONES: Record<
  string,
  "neutral" | "success" | "warning" | "danger"
> = {
  running: "success",
  restarting: "warning",
  exited: "neutral",
  dead: "danger",
};

function getServiceUrl(name: string) {
  return SERVICE_URLS[name];
}

function serviceHostname(name: string) {
  const url = getServiceUrl(name);
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function displayImage(image: string) {
  return image.split("@")[0] || image;
}

function createStackEventSource() {
  return new EventSource("/api/admin/stack-stream", {
    withCredentials: true,
  });
}

function ServiceCard({
  container,
  expanded,
  logs,
  logsLoading,
  logsError,
  onRefreshLogs,
  busy,
  onToggleLogs,
  onRestart,
  onToggleState,
}: {
  container: Container;
  expanded: boolean;
  logs: ContainerLogs | null;
  logsLoading: boolean;
  logsError: string | null;
  onRefreshLogs: () => void;
  busy: boolean;
  onToggleLogs: () => void;
  onRestart: () => void;
  onToggleState: () => void;
}) {
  const logsId = useId();
  const isRunning = container.state === "running";
  const serviceUrl = getServiceUrl(container.name);
  const hostname = serviceHostname(container.name);
  const metadata = [
    { label: "Status", value: container.status },
    {
      label: "Ports",
      value: container.ports.length
        ? container.ports.join(", ")
        : "No exposed ports",
    },
    { label: "Public route", value: hostname ?? "Internal only" },
  ];

  return (
    <article
      aria-label={`Service ${container.name}`}
      className="min-w-0 space-y-4 border-b border-border-quiet py-5"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 min-w-0 wrap-anywhere font-display text-base font-semibold tracking-tight text-text-primary">
              {container.name}
            </h3>
            <InfoBadge tone={STATE_TONES[container.state] ?? "neutral"}>
              {container.state}
            </InfoBadge>
          </div>
          <div className="min-w-0 wrap-anywhere font-mono text-label font-normal text-text-muted">
            {displayImage(container.image)}
          </div>
        </div>

        <PageHeaderActions label={`Actions for ${container.name}`}>
          <PageHeaderAction
            label={`${expanded ? "Hide" : "Show"} logs for ${container.name}`}
            tooltip={expanded ? "Hide logs" : "Logs"}
            onClick={onToggleLogs}
            aria-expanded={expanded}
            aria-controls={logsId}
            aria-pressed={expanded}
          >
            <ListOrdered data-admin-ux="service-logs" aria-hidden="true" />
          </PageHeaderAction>
          <PageHeaderAction
            label={`${isRunning ? "Stop" : "Start"} service ${container.name}`}
            tooltip={isRunning ? "Stop" : "Start"}
            onClick={onToggleState}
            loading={busy}
          >
            {isRunning ? (
              <Square data-admin-ux="service-stop" aria-hidden="true" />
            ) : (
              <Play data-admin-ux="service-start" aria-hidden="true" />
            )}
          </PageHeaderAction>
          <PageHeaderAction
            label={`Restart service ${container.name}`}
            tooltip="Restart"
            onClick={onRestart}
            disabled={busy || !isRunning}
          >
            <RotateCcw data-admin-ux="service-restart" aria-hidden="true" />
          </PageHeaderAction>
          {serviceUrl ? (
            <PageHeaderAction
              asChild
              label={`Open service ${container.name}`}
              tooltip="Open service"
            >
              <a href={serviceUrl} target="_blank" rel="noreferrer">
                <ExternalLink
                  data-admin-ux="service-external"
                  aria-hidden="true"
                />
              </a>
            </PageHeaderAction>
          ) : null}
        </PageHeaderActions>
      </div>

      <dl className="m-0 grid min-w-0 gap-4 sm:grid-cols-3">
        {metadata.map(({ label, value }) => (
          <div key={label} className="flex min-w-0 flex-col gap-1.5">
            <MonoLabel as="dt">{label}</MonoLabel>
            <dd className="m-0 wrap-anywhere font-mono text-sm font-normal text-text-primary">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {expanded ? (
        <div
          id={logsId}
          role="region"
          aria-label={`Logs for ${container.name}`}
          className="min-w-0 border-t border-border-quiet pt-4"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <MonoLabel as="div" tone="accent">
              Recent logs
            </MonoLabel>
            <InfoBadge>{container.name}</InfoBadge>
          </div>
          {logsLoading ? (
            <LoadingState label={`Loading logs for ${container.name}`} />
          ) : logsError ? (
            <ErrorState message={logsError} onRetry={onRefreshLogs} />
          ) : logs?.logs ? (
            <pre className="m-0 max-h-80 overflow-y-auto whitespace-pre-wrap break-all font-mono text-label font-normal leading-6 text-text-secondary">
              {logs.logs}
            </pre>
          ) : (
            <EmptyState message="No logs available for this service." />
          )}
        </div>
      ) : null}
    </article>
  );
}

export function Stack() {
  const [snapshot, setSnapshot] = useState<StackSnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] =
    useState<OpsStreamStatus>("connecting");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ServiceFilter>("all");
  const [restartTarget, setRestartTarget] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<Set<string>>(new Set());
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState<ContainerLogs | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const logsRequestRef = useRef(0);
  useEffect(
    () => () => {
      logsRequestRef.current += 1;
    },
    [],
  );
  const reconnectTimerRef = useRef<number | null>(null);
  const data = snapshot?.stack ?? null;

  const fetchSnapshot = useCallback(async (fresh = false, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await api<StackSnapshotData>(
        fresh
          ? "/api/admin/stack-snapshot?fresh=1"
          : "/api/admin/stack-snapshot",
      );
      setSnapshot(response);
      setError(null);
    } catch {
      setError("Failed to load Docker stack status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    let closed = false;
    let stream: EventSource | null = null;

    const connect = () => {
      if (closed) return;
      stream = createStackEventSource();
      stream.onopen = () => setStreamStatus("live");
      stream.onmessage = (event) => {
        if (event.origin && event.origin !== window.location.origin) return;
        try {
          setSnapshot(JSON.parse(event.data) as StackSnapshotData);
          setError(null);
          setStreamStatus("live");
          setLoading(false);
        } catch {
          // Ignore malformed stream payloads and wait for the next event.
        }
      };
      stream.onerror = () => {
        stream?.close();
        if (closed) return;
        setStreamStatus("reconnecting");
        reconnectTimerRef.current = window.setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      stream?.close();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  async function handleRestart(name: string) {
    setRestarting((current) => new Set(current).add(name));
    try {
      await api(`/api/stack/container/${name}/restart`, "POST");
      toast.success(`Restarting ${name}…`);
      window.setTimeout(() => {
        void fetchSnapshot(true, true);
      }, 2500);
    } finally {
      setRestarting((current) => {
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    }
  }

  async function handleToggleState(name: string, currentState: string) {
    const action = currentState === "running" ? "stop" : "start";
    setRestarting((current) => new Set(current).add(name));
    try {
      await api(`/api/stack/container/${name}/${action}`, "POST");
      toast.success(`${action === "stop" ? "Stopping" : "Starting"} ${name}…`);
      window.setTimeout(() => {
        void fetchSnapshot(true, true);
      }, 2000);
    } catch {
      toast.error(`Failed to ${action} ${name}`);
    } finally {
      setRestarting((current) => {
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    }
  }

  async function toggleLogs(name: string) {
    if (expandedLogs === name) {
      logsRequestRef.current += 1;
      setExpandedLogs(null);
      setLogs(null);
      return;
    }

    setExpandedLogs(name);
    await loadLogs(name);
  }

  async function loadLogs(name: string) {
    const request = ++logsRequestRef.current;
    setLogs(null);
    setLogsLoading(true);
    setLogsError(null);
    try {
      const response = await api<ContainerLogs>(
        `/api/stack/container/${name}/logs?tail=30`,
      );
      if (request === logsRequestRef.current) setLogs(response);
    } catch {
      if (request === logsRequestRef.current)
        setLogsError(`Could not load logs for ${name}.`);
    } finally {
      if (request === logsRequestRef.current) setLogsLoading(false);
    }
  }

  const filteredContainers = useMemo(() => {
    const containers = data?.containers ?? [];
    const normalized = search.trim().toLowerCase();

    return containers
      .filter((container) => {
        if (filter === "running" && container.state !== "running") return false;
        if (filter === "stopped" && container.state === "running") return false;
        if (!normalized) return true;
        const haystack = `${container.name} ${container.image} ${
          container.status
        } ${container.ports.join(" ")}`.toLowerCase();
        return haystack.includes(normalized);
      })
      .sort((a, b) => {
        if (a.state === "running" && b.state !== "running") return -1;
        if (a.state !== "running" && b.state === "running") return 1;
        return a.name.localeCompare(b.name);
      });
  }, [data?.containers, filter, search]);

  const publicRoutes = useMemo(
    () =>
      (data?.containers ?? []).filter((container) =>
        Boolean(getServiceUrl(container.name)),
      ).length,
    [data?.containers],
  );

  if (loading && !data) {
    return <LoadingState variant="page" label="Loading stack services" />;
  }

  if (error && !data) {
    return (
      <ErrorState message={error} onRetry={() => void fetchSnapshot(true)} />
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Stack"
        description="Inspect service status, read recent logs and manage Docker services."
        compactActions
        actions={
          <PageHeaderActions>
            <PageHeaderAction
              label="Refresh"
              onClick={() => void fetchSnapshot(true)}
              loading={loading}
            >
              <RefreshCw data-admin-ux="header-refresh" aria-hidden="true" />
            </PageHeaderAction>
          </PageHeaderActions>
        }
      >
        <InfoBadge>
          {data?.available ? "Docker available" : "Docker unavailable"}
        </InfoBadge>
        <OpsSnapshotStatus
          snapshot={snapshot?.snapshot}
          streamStatus={streamStatus}
        />
      </OpsPageHero>

      {error && data ? (
        <OpsRefreshNotice
          message="Could not refresh Docker stack status. Showing the last successful snapshot."
          onRetry={() => void fetchSnapshot(true)}
        />
      ) : null}

      {!data?.available ? (
        <OpsPanel
          title="Docker not available"
          description="The API container cannot see the Docker socket, so stack inspection and service controls are disabled."
        >
          <EmptyState
            title="Docker socket unavailable"
            description={
              <>
                Mount{" "}
                <code className="rounded-sm bg-raised-surface px-1.5 py-0.5 text-text-secondary">
                  /var/run/docker.sock
                </code>{" "}
                into the API container to restore stack operations.
              </>
            }
          />
        </OpsPanel>
      ) : (
        <>
          <section
            aria-label="Stack summary"
            className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-7 py-3 lg:grid-cols-3"
          >
            <StatNumber
              as="div"
              size="sm"
              label="Running services"
              value={(data?.running ?? 0).toLocaleString()}
              unit={`/ ${(data?.total ?? 0).toLocaleString()}`}
            />
            <StatNumber
              as="div"
              size="sm"
              label="Stopped services"
              value={(
                (data?.total ?? 0) - (data?.running ?? 0)
              ).toLocaleString()}
            />
            <StatNumber
              as="div"
              size="sm"
              label="Public routes"
              value={publicRoutes.toLocaleString()}
            />
          </section>

          <OpsPanel
            title="Services"
            action={
              <InfoBadge variant="counter">
                {filteredContainers.length} / {data?.total ?? 0}
              </InfoBadge>
            }
          >
            <div className="mb-4 flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <SearchInput
                label="Search stack services"
                containerClassName="min-w-0 flex-1"
                value={search}
                onValueChange={setSearch}
                placeholder="Search services, images or ports..."
              />
              <SegmentedControl
                as="radio"
                label="Service state"
                value={filter}
                onValueChange={setFilter}
                items={[
                  { value: "all", label: "All" },
                  { value: "running", label: "Running" },
                  { value: "stopped", label: "Stopped" },
                ]}
              />
            </div>
            {filteredContainers.length > 0 ? (
              <div className="grid min-w-0 gap-x-8 xl:grid-cols-2">
                {filteredContainers.map((container) => (
                  <ServiceCard
                    key={container.id}
                    container={container}
                    expanded={expandedLogs === container.name}
                    logs={expandedLogs === container.name ? logs : null}
                    logsLoading={expandedLogs === container.name && logsLoading}
                    logsError={
                      expandedLogs === container.name ? logsError : null
                    }
                    onRefreshLogs={() => void loadLogs(container.name)}
                    busy={restarting.has(container.name)}
                    onToggleLogs={() => toggleLogs(container.name)}
                    onRestart={() => setRestartTarget(container.name)}
                    onToggleState={() =>
                      handleToggleState(container.name, container.state)
                    }
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No services match the current filters." />
            )}
          </OpsPanel>
        </>
      )}

      <ConfirmDialog
        open={restartTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestartTarget(null);
        }}
        title="Restart service"
        description={`Restart ${restartTarget}? This interrupts the container and may briefly affect admin or listener traffic.`}
        confirmLabel="Restart"
        tone="danger"
        onConfirm={async () => {
          if (restartTarget) await handleRestart(restartTarget);
        }}
        onError={() => toast.error(`Failed to restart ${restartTarget}`)}
        eyebrow="Confirm action"
        consequence={`${
          restartTarget ?? "Service"
        } · restarts the container · traffic may be interrupted`}
      />
    </div>
  );
}
