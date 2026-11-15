import { cn } from "@crate/ui/lib/cn";
import { Button } from "@crate/ui/shadcn/button";
import { StatusDot } from "@crate/ui/primitives/StatusDot";

import { OpsStatTile, OpsSurface } from "@/components/admin/ops-surfaces";
import {
  SeverityMeter,
  severityTextClass,
} from "@/components/admin/status-indicators";
import {
  formatAgo,
  formatBackupBytes,
  formatHours,
  formatNext,
  formatStamp,
  tiersSchedule,
  type BackupAlert,
  type BackupDestinationHealth,
  type BackupHealth,
  type BackupOverview,
  type BackupPolicy,
  type BackupRunRow,
} from "@/lib/backups";

import { Facts, HealthDot, KindMark, Section } from "./backup-ui";
import { RecoveryKitWarning } from "./RecoveryKit";
import { RepositorySizeChart } from "./RepositorySizeChart";

export type CheckKind = "verify" | "restore_drill";

export interface OverviewActions {
  onOpenDestination: (id: string) => void;
  onRunPolicy: (policyId: string | null) => void;
  onRunCheck: (kind: CheckKind, destinationId: string) => void;
  onDownloadKit: () => void;
}

/** What a card and the table show: a never-tested destination is untested. */
export function displayHealth(
  destination: Pick<
    BackupDestinationHealth,
    "health" | "repository_initialized_at"
  >,
): BackupHealth {
  if (!destination.repository_initialized_at) return "untested";
  return destination.health;
}

function runAt(run?: BackupRunRow | null) {
  return run?.finished_at ?? run?.started_at ?? null;
}

function checkText(run: BackupRunRow | null | undefined, now: number) {
  if (!run) return "Never";
  if (run.status === "running") return "Running";
  if (run.status === "failed") return `Failed ${formatAgo(runAt(run), now)}`;
  return formatAgo(runAt(run), now);
}

function drillOverdue(
  destination: BackupDestinationHealth,
  policies: readonly BackupPolicy[],
  now: number,
) {
  const every = policies
    .filter(
      (p) => destination.policy_ids.includes(p.id) && p.drill_every_days > 0,
    )
    .map((p) => p.drill_every_days);
  if (!every.length) return false;
  const at = runAt(destination.last_drill);
  if (!at) return false;
  return now - Date.parse(at) > Math.min(...every) * 86_400_000;
}

function nextRun(
  destination: BackupDestinationHealth,
  overview: BackupOverview,
): string | null {
  const times = overview.policies
    .filter((p) => destination.policy_ids.includes(p.id) && p.next_run)
    .map((p) => p.next_run!)
    .sort();
  return times[0] ?? null;
}

function DestinationCard({
  destination: d,
  overview,
  policies,
  now,
}: {
  destination: BackupDestinationHealth;
  overview: BackupOverview;
  policies: readonly BackupPolicy[];
  now: number;
}) {
  const health = displayHealth(d);
  const late = health === "late";
  const failing = health === "failing";
  const note = failing
    ? d.last_error || "The last test or copy failed."
    : late
      ? d.last_error || null
      : health === "untested"
        ? "Not tested yet. A passing connection test enables it."
        : health === "disabled"
          ? "Disabled. Crate keeps the repository and stops writing to it."
          : null;
  const next = nextRun(d, overview);
  const footer =
    health === "untested"
      ? "After a passing test"
      : health === "disabled"
        ? "Disabled"
        : next
          ? `Next: ${formatNext(next, now)}`
          : d.tiers.length
            ? "Next: manual only"
            : "Not in any policy";
  return (
    <OpsSurface
      as="article"
      aria-label={d.name}
      className="flex flex-col gap-4 p-4"
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <KindMark kind={d.kind} className="mt-0.5" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text-primary">
              {d.name}
            </p>
            <p className="mt-1 truncate font-mono text-label text-text-subtle">
              {d.location}
            </p>
          </div>
        </div>
        <HealthDot health={health} />
      </header>
      {note ? (
        <p
          className={
            failing
              ? cn("text-sm", severityTextClass("error"))
              : late
                ? "text-sm text-state-warning-text"
                : "text-sm text-text-muted"
          }
        >
          {note}
        </p>
      ) : null}
      <Facts
        items={[
          {
            label: "Last copy",
            value: d.last_copy_at ? formatAgo(d.last_copy_at, now) : "None yet",
            tone: failing ? "danger" : late ? "warning" : undefined,
          },
          {
            label: "Schedule",
            value: health === "disabled" ? "Off" : tiersSchedule(d, policies),
          },
          {
            label: "Last verify",
            value: checkText(d.last_verify, now),
            tone: d.last_verify?.status === "failed" ? "danger" : undefined,
          },
          {
            label: "Last drill",
            value: checkText(d.last_drill, now),
            tone:
              d.last_drill?.status === "failed"
                ? "danger"
                : drillOverdue(d, policies, now)
                  ? "warning"
                  : undefined,
          },
          { label: "Snapshots", value: d.snapshot_count ?? "—" },
          {
            label: "Size",
            value:
              d.repository_bytes == null
                ? "—"
                : formatBackupBytes(d.repository_bytes),
          },
        ]}
      />
      <p
        className={
          late
            ? "mt-auto border-t border-border-quiet-subtle pt-3 font-mono text-label text-state-warning-text"
            : "mt-auto border-t border-border-quiet-subtle pt-3 font-mono text-label text-text-subtle"
        }
      >
        {late
          ? `Over ${formatHours(d.late_after_hours ?? 0)}, 1.5 times its schedule`
          : footer}
      </p>
    </OpsSurface>
  );
}

const ALERT_ACTION: Record<string, string> = {
  test: "Open destination",
  run: "Run now",
  verify: "Verify",
  restore_drill: "Restore drill",
};

function AlertAction({
  alert,
  overview,
  actions,
}: {
  alert: BackupAlert;
  overview: BackupOverview;
  actions: OverviewActions;
}) {
  const id = alert.destination_id;
  const label = alert.action ? ALERT_ACTION[alert.action] : undefined;
  if (!id || !label) return null;
  function act() {
    if (!id) return;
    if (alert.action === "run") {
      const destination = overview.destinations.find((d) => d.id === id);
      actions.onRunPolicy(destination?.policy_ids[0] ?? null);
    } else if (alert.action === "verify" || alert.action === "restore_drill")
      actions.onRunCheck(alert.action, id);
    else actions.onOpenDestination(id);
  }
  return (
    <Button type="button" size="sm" variant="outline" onClick={act}>
      {label}
    </Button>
  );
}

export function BackupsOverview({
  overview,
  policies,
  actions,
  now = Date.now(),
}: {
  overview: BackupOverview;
  policies: readonly BackupPolicy[];
  actions: OverviewActions;
  now?: number;
}) {
  const { stats } = overview;
  const verifyDetails = stats.last_verify?.details ?? {};
  const readPercent = verifyDetails.read_percent;
  const nextPolicy = overview.policies
    .filter((p) => p.enabled && p.next_run)
    .sort((a, b) => (a.next_run! < b.next_run! ? -1 : 1))[0];
  return (
    <>
      <RecoveryKitWarning
        kit={overview.kit}
        onDownload={actions.onDownloadKit}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
        <OpsStatTile
          label="Last off-site copy"
          value={
            stats.last_copy_at ? formatAgo(stats.last_copy_at, now) : "None"
          }
          caption={
            stats.last_copy_at
              ? `${stats.last_copy_destination} · ${formatStamp(stats.last_copy_at)}`
              : "No copy yet"
          }
        />
        <OpsStatTile
          label="Stored"
          value={formatBackupBytes(stats.stored_bytes ?? 0)}
          caption={`${stats.repositories ?? 0} repositor${
            stats.repositories === 1 ? "y" : "ies"
          } · ${stats.snapshots ?? 0} snapshots`}
        />
        <OpsStatTile
          label="Latest local dump"
          value={
            stats.latest_dump
              ? formatBackupBytes(stats.latest_dump.bytes)
              : "None"
          }
          caption={
            stats.latest_dump
              ? `${formatAgo(runAt(stats.latest_dump), now)}${
                  stats.latest_dump.checksum ? " · checksum recorded" : ""
                }`
              : overview.local_backups_enabled
                ? "No dump yet"
                : "Local dumps are off"
          }
        />
        <OpsStatTile
          label="Last verify"
          value={
            stats.last_verify ? formatAgo(stats.last_verify.at, now) : "Never"
          }
          tone={stats.last_verify?.status === "failed" ? "danger" : "default"}
          caption={
            stats.last_verify
              ? [
                  stats.last_verify.destination,
                  typeof readPercent === "number"
                    ? `${readPercent}% read`
                    : null,
                  stats.last_verify.status === "failed" ? "failed" : "passed",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "No verification yet"
          }
        />
        <OpsStatTile
          label="Last restore drill"
          value={
            stats.last_drill ? formatAgo(stats.last_drill.at, now) : "Never"
          }
          tone={stats.last_drill?.status === "failed" ? "danger" : "default"}
          caption={
            stats.last_drill
              ? `${stats.last_drill.destination} · ${
                  stats.last_drill.status === "failed" ? "failed" : "passed"
                }`
              : "No drill yet"
          }
        />
      </div>

      <Section
        title="Destinations"
        description="Health of each repository. A copy is late once it is older than 1.5 times its schedule."
        action={
          nextPolicy ? (
            <span className="font-mono text-label text-text-subtle">
              {nextPolicy.name} policy · next run{" "}
              {formatNext(nextPolicy.next_run, now).toLowerCase()}
            </span>
          ) : undefined
        }
      >
        {overview.destinations.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {overview.destinations.map((destination) => (
              <DestinationCard
                key={destination.id}
                destination={destination}
                overview={overview}
                policies={policies}
                now={now}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            No destination yet. Add one from Destinations: local dumps alone do
            not survive losing the server.
          </p>
        )}
      </Section>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title="Alerts"
          description="Crate Operator also sends each new one, through its backup alerts rule."
          className="xl:order-2"
        >
          {overview.alerts.length ? (
            <ol className="m-0 list-none divide-y divide-border-quiet-subtle border-y border-border-quiet-subtle p-0">
              {overview.alerts.map((alert, index) => (
                <li
                  key={`${alert.kind}-${alert.destination_id}-${index}`}
                  className="space-y-2 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {alert.level === "danger" ? (
                      <SeverityMeter level="error" label={alert.title} />
                    ) : (
                      <StatusDot tone="warn" label={alert.title} />
                    )}
                    {alert.at ? (
                      <time
                        dateTime={alert.at}
                        className="font-mono text-label text-text-subtle"
                      >
                        {formatStamp(alert.at)}
                      </time>
                    ) : null}
                  </div>
                  <p className="text-sm text-text-secondary">{alert.text}</p>
                  <AlertAction
                    alert={alert}
                    overview={overview}
                    actions={actions}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="border-y border-border-quiet-subtle py-4 text-sm text-text-muted">
              No alerts. Every destination is within its schedule.
            </p>
          )}
        </Section>
        <Section
          title="Repository size"
          description="Last 90 days, after each copy and prune."
          className="xl:order-1"
        >
          <RepositorySizeChart overview={overview} now={now} />
          <p className="font-mono text-label text-text-subtle">
            Restic repository size after each copy and prune
          </p>
        </Section>
      </div>
    </>
  );
}
