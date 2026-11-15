import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";

import { useApi } from "@/hooks/use-api";
import {
  BACKUPS_API,
  formatAgo,
  formatStamp,
  type BackupDestination,
  type BackupSnapshotList,
} from "@/lib/backups";

const TH = "font-mono text-label uppercase tracking-caps";
const CELL_MONO = "font-mono text-sm text-text-secondary";

/**
 * The destination's snapshots as the worker last listed them (BG1-13): the API
 * cannot run restic, so tests, copies and verifications refresh this cache.
 */
export function SnapshotsTab({
  destination,
}: {
  destination: BackupDestination;
}) {
  const { data, loading, error, refetch } = useApi<BackupSnapshotList>(
    `${BACKUPS_API}/destinations/${encodeURIComponent(destination.id)}/snapshots`,
  );
  if (loading && !data) return <LoadingState variant="section" />;
  if (!data)
    return (
      <ErrorState
        title="Snapshots unavailable"
        message={error ?? "The snapshot listing could not be loaded."}
        onRetry={refetch}
      />
    );
  if (!data.snapshots.length)
    return (
      <EmptyState
        title="No snapshots listed yet"
        description="A connection test, copy or verification lists the repository's snapshots."
      />
    );
  return (
    <div className="space-y-3">
      <p className="font-mono text-label text-text-subtle">
        {data.snapshot_count ?? data.snapshots.length} snapshots · listed{" "}
        {formatAgo(data.listed_at)}
      </p>
      <div className="min-w-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH}>Snapshot</TableHead>
              <TableHead className={TH}>Taken</TableHead>
              <TableHead className={TH}>Tiers</TableHead>
              <TableHead className={TH}>Host</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.snapshots.map((snapshot) => (
              <TableRow key={snapshot.id}>
                <TableCell>
                  <span className="font-mono text-sm text-text-primary">
                    {snapshot.id.slice(0, 8)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={CELL_MONO}>
                    {formatStamp(snapshot.time)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {snapshot.tags.length
                      ? snapshot.tags.map((tag) => (
                          <InfoBadge key={tag}>{tag}</InfoBadge>
                        ))
                      : "—"}
                  </div>
                </TableCell>
                <TableCell>
                  <span className={CELL_MONO}>{snapshot.host ?? "—"}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
