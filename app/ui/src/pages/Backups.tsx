import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";

import { Button } from "@crate/ui/shadcn/button";

import { OpsPageHero } from "@/components/admin/ops-surfaces";
import { BackupsDestinations } from "@/components/backups/BackupsDestinations";
import {
  BackupsPolicies,
  NEW_POLICY,
} from "@/components/backups/BackupsPolicies";
import {
  BackupsOverview,
  type CheckKind,
} from "@/components/backups/BackupsOverview";
import {
  DestinationDrawer,
  type DrawerTarget,
} from "@/components/backups/DestinationDrawer";
import { RecoveryKitDialog } from "@/components/backups/RecoveryKit";
import { CheckMenuButton, RunNowButton } from "@/components/backups/RunMenus";
import { useApi } from "@/hooks/use-api";
import { useTabParam } from "@/hooks/use-tab-param";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import { api } from "@/lib/api";
import {
  BACKUPS_API,
  TEST_TIMEOUT_MS,
  notifyBackupsChanged,
  connectionFromTask,
  type BackupDestination,
  type BackupOverview,
  type BackupPolicy,
  type TaskEnqueue,
} from "@/lib/backups";

const VIEWS = ["overview", "destinations", "policies", "runs"] as const;
type BackupsView = (typeof VIEWS)[number];

const VIEW_ITEMS: { value: BackupsView; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "destinations", label: "Destinations" },
  { value: "policies", label: "Policies" },
  { value: "runs", label: "Runs" },
];

const OVERVIEW_URL = `${BACKUPS_API}/overview`;
const POLICIES_URL = `${BACKUPS_API}/policies`;

export function Backups() {
  const [view, setView] = useTabParam(VIEWS, "overview", { param: "view" });
  const [searchParams, setSearchParams] = useSearchParams();
  const overview = useApi<BackupOverview>(OVERVIEW_URL);
  const policies = useApi<BackupPolicy[]>(POLICIES_URL);
  const { pollTask } = useTaskPoll();
  const [running, setRunning] = useState(false);
  const [kitOpen, setKitOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [created, setCreated] = useState<BackupDestination | null>(null);
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set());
  const [policyId, setPolicyId] = useState<string | null>(null);

  function refresh() {
    overview.refetch();
    policies.refetch();
    notifyBackupsChanged();
  }

  // The OAuth callback returns here with ?oauth=connected|error (BK4).
  useEffect(() => {
    const outcome = searchParams.get("oauth");
    if (!outcome) return;
    if (outcome === "connected")
      toast.success("Connected. Crate is testing the connection.");
    else toast.error(searchParams.get("message") || "The connection failed");
    const next = new URLSearchParams(searchParams);
    next.delete("oauth");
    next.delete("message");
    next.delete("destination");
    const destinationId = searchParams.get("destination");
    if (outcome === "connected") next.set("view", "destinations");
    setSearchParams(next, { replace: true });
    if (outcome === "connected" && destinationId)
      setDrawer({ mode: "edit", id: destinationId });
    overview.refetch();
    // Runs once per callback: the params are removed right away.
  }, [searchParams.get("oauth")]);

  function follow(taskId: string, label: string) {
    if (!taskId) return;
    pollTask(
      taskId,
      () => {
        toast.success(`${label} finished`);
        refresh();
      },
      (error) => {
        toast.error(`${label} failed${error ? `: ${error}` : ""}`);
        refresh();
      },
      3000,
      TEST_TIMEOUT_MS,
    );
  }

  async function queue(body: Record<string, unknown>, label: string) {
    setRunning(true);
    try {
      const result = await api<TaskEnqueue>(`${BACKUPS_API}/run`, "POST", body);
      toast.success(
        result.deduplicated ? `${label} is already queued` : `${label} queued`,
      );
      follow(result.task_id, label);
    } catch (error) {
      toast.error(apiErrorText(error, `${label} could not start`));
    } finally {
      setRunning(false);
    }
  }

  function runPolicy(policyId: string | null) {
    const policy = overview.data?.policies.find((p) => p.id === policyId);
    void queue(
      policyId ? { kind: "backup", policy_id: policyId } : { kind: "backup" },
      policy ? `Backup “${policy.name}”` : "Local dump",
    );
  }

  function runCheck(kind: CheckKind, destinationId: string) {
    const destination = overview.data?.destinations.find(
      (d) => d.id === destinationId,
    );
    const what = kind === "verify" ? "Verify" : "Restore drill";
    void queue(
      { kind, destination_id: destinationId },
      destination ? `${what} of ${destination.name}` : what,
    );
  }

  function openDestination(id: string) {
    setView("destinations");
    setDrawer({ mode: "edit", id });
  }

  function setTestingFor(id: string, on: boolean) {
    setTesting((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function testDestination(id: string) {
    const destination = overview.data?.destinations.find((d) => d.id === id);
    const name = destination?.name ?? "The destination";
    setTestingFor(id, true);
    try {
      const result = await api<TaskEnqueue>(
        `${BACKUPS_API}/destinations/${encodeURIComponent(id)}/test`,
        "POST",
      );
      pollTask(
        result.task_id,
        (task) => {
          setTestingFor(id, false);
          const connection = connectionFromTask(task);
          if (connection?.status === "ok")
            toast.success(`${name}: connection works`);
          else
            toast.error(
              `${name}: ${connection?.error || "the connection test failed"}`,
            );
          refresh();
        },
        (error) => {
          setTestingFor(id, false);
          toast.error(`${name}: ${error || "the connection test failed"}`);
          refresh();
        },
        3000,
        TEST_TIMEOUT_MS,
      );
    } catch (error) {
      setTestingFor(id, false);
      toast.error(apiErrorText(error, "The test could not start"));
    }
  }

  async function toggleDestination(id: string, enabled: boolean) {
    try {
      await api(
        `${BACKUPS_API}/destinations/${encodeURIComponent(id)}`,
        "PATCH",
        {
          enabled,
        },
      );
      toast.success(enabled ? "Destination enabled" : "Destination disabled");
      refresh();
    } catch (error) {
      toast.error(apiErrorText(error, "The destination could not be changed"));
    }
  }

  const data = overview.data;
  let actions: ReactNode = null;
  if (view === "overview" && data)
    actions = (
      <>
        <RunNowButton
          policies={data.policies}
          busy={running}
          onRun={runPolicy}
        />
        <CheckMenuButton
          kind="verify"
          destinations={data.destinations}
          busy={running}
          onRun={runCheck}
        />
        <CheckMenuButton
          kind="restore_drill"
          destinations={data.destinations}
          busy={running}
          onRun={runCheck}
        />
      </>
    );

  if (view === "destinations")
    actions = (
      <Button type="button" onClick={() => setDrawer({ mode: "add" })}>
        Add destination
      </Button>
    );

  if (view === "policies")
    actions = (
      <Button
        type="button"
        variant="outline"
        onClick={() => setPolicyId(NEW_POLICY)}
      >
        New policy
      </Button>
    );

  let content: ReactNode;
  if (overview.loading && !data) content = <LoadingState variant="section" />;
  else if (!data)
    content = (
      <ErrorState
        title="Backups unavailable"
        message={overview.error ?? "The backups overview could not be loaded."}
        onRetry={overview.refetch}
      />
    );
  else if (view === "destinations")
    content = (
      <BackupsDestinations
        destinations={data.destinations}
        testing={testing}
        onEdit={(id) => setDrawer({ mode: "edit", id })}
        onTest={(id) => void testDestination(id)}
        onToggle={(id, enabled) => void toggleDestination(id, enabled)}
      />
    );
  else if (view === "policies")
    content = policies.data ? (
      <BackupsPolicies
        policies={policies.data}
        overview={data}
        selected={policyId}
        onSelect={setPolicyId}
        onChanged={refresh}
      />
    ) : policies.loading ? (
      <LoadingState variant="section" />
    ) : (
      <ErrorState
        title="Policies unavailable"
        message={policies.error ?? "The policies could not be loaded."}
        onRetry={policies.refetch}
      />
    );
  else
    content = (
      <BackupsOverview
        overview={data}
        policies={policies.data ?? []}
        actions={{
          onOpenDestination: openDestination,
          onRunPolicy: runPolicy,
          onRunCheck: runCheck,
          onDownloadKit: () => setKitOpen(true),
        }}
      />
    );

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Backups"
        description="Database dumps, off-site copies, retention, verification and restore drills."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl<BackupsView>
            as="tabs"
            label="Backups views"
            value={view}
            onValueChange={setView}
            items={VIEW_ITEMS}
          />
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      <div className="space-y-8">{content}</div>
      <DestinationDrawer
        target={drawer}
        destination={
          drawer?.mode === "edit"
            ? (data?.destinations.find((d) => d.id === drawer.id) ??
              (created?.id === drawer.id ? created : null))
            : null
        }
        onClose={() => setDrawer(null)}
        onChanged={refresh}
        onSaved={(saved) => {
          setCreated(saved);
          setDrawer({ mode: "edit", id: saved.id });
        }}
      />
      <RecoveryKitDialog
        open={kitOpen}
        destinationCount={data?.kit.total ?? 0}
        onClose={() => {
          setKitOpen(false);
          overview.refetch();
        }}
        onConfirmed={() => {
          setKitOpen(false);
          refresh();
        }}
      />
    </div>
  );
}
