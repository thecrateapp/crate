import { Pencil } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";

import {
  formatAgo,
  formatBackupBytes,
  kindBadge,
  type BackupDestinationHealth,
} from "@/lib/backups";

import { severityTextClass } from "@/components/admin/status-indicators";

import { HealthDot, KindMark } from "./backup-ui";
import { displayHealth } from "./BackupsOverview";

const TH = "font-mono text-label uppercase tracking-caps";

function statusNote(d: BackupDestinationHealth, now: number) {
  const health = displayHealth(d);
  if (health === "failing")
    return (
      <p className={cn("max-w-64 text-xs", severityTextClass("error"))}>
        {d.last_error || "The last test or copy failed"}
      </p>
    );
  if (health === "late")
    return (
      <p className="max-w-64 text-xs text-state-warning-text">
        Last copy {formatAgo(d.last_copy_at, now)}
      </p>
    );
  if (health === "untested")
    return (
      <p className="max-w-64 text-xs text-text-muted">
        {d.oauth && d.missing_secrets.includes("token")
          ? "Not connected"
          : "Not tested yet"}
      </p>
    );
  return null;
}

/** The destinations table (mockup 2): enabled stays off until a test passes (BG1-11). */
export function BackupsDestinations({
  destinations,
  testing,
  onEdit,
  onTest,
  onToggle,
  now = Date.now(),
}: {
  destinations: readonly BackupDestinationHealth[];
  testing: ReadonlySet<string>;
  onEdit: (id: string) => void;
  onTest: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  now?: number;
}) {
  return (
    <>
      <div className="min-w-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH}>Destination</TableHead>
              <TableHead className={TH}>Status</TableHead>
              <TableHead className={TH}>Last checked</TableHead>
              <TableHead className={cn(TH, "text-right")}>Snapshots</TableHead>
              <TableHead className={cn(TH, "text-right")}>Size</TableHead>
              <TableHead className={TH}>Enabled</TableHead>
              <TableHead className={cn(TH, "text-right")}>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {destinations.map((d) => {
              const tested = Boolean(d.repository_initialized_at);
              const busy = testing.has(d.id);
              const toggle = (
                <Switch
                  checked={d.enabled}
                  disabled={!tested}
                  onCheckedChange={(checked) => onToggle(d.id, checked)}
                  aria-label={`${d.name} enabled`}
                />
              );
              return (
                <TableRow
                  key={d.id}
                  className="border-border-quiet-subtle align-top"
                >
                  <TableCell className="py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <KindMark kind={d.kind} className="mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">
                            {d.name}
                          </span>
                          <InfoBadge>{kindBadge(d)}</InfoBadge>
                        </div>
                        <p className="mt-1 max-w-sm truncate font-mono text-label text-text-subtle">
                          {d.location}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal py-3">
                    <div className="space-y-1">
                      <HealthDot health={displayHealth(d)} />
                      {statusNote(d, now)}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-3 font-mono text-sm text-text-secondary">
                    {formatAgo(d.last_checked_at, now)}
                  </TableCell>
                  <TableCell className="py-3 text-right font-mono text-sm text-text-secondary">
                    {d.snapshot_count ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-3 text-right font-mono text-sm text-text-secondary">
                    {d.repository_bytes == null
                      ? "—"
                      : formatBackupBytes(d.repository_bytes)}
                  </TableCell>
                  <TableCell className="py-3">
                    {tested ? (
                      toggle
                    ) : (
                      <TooltipHint content="Test the connection first: the first passing test enables it">
                        <span className="inline-flex" tabIndex={0}>
                          {toggle}
                        </span>
                      </TooltipHint>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || (tested && !d.enabled)}
                        aria-busy={busy || undefined}
                        aria-label={`Test ${d.name}`}
                        onClick={() => onTest(d.id)}
                      >
                        {busy ? "Testing" : "Test"}
                      </Button>
                      <ActionButton
                        label={`Edit ${d.name}`}
                        tooltip="Edit"
                        onClick={() => onEdit(d.id)}
                      >
                        <Pencil
                          data-admin-ux="backups-edit"
                          aria-hidden="true"
                        />
                      </ActionButton>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm text-text-muted">
        Each destination is its own restic repository with a password Crate
        generates. Disabling a destination keeps the repository; Crate only
        stops writing to it. Tests and copies run as worker tasks on the
        maintenance queue.
      </p>
    </>
  );
}
