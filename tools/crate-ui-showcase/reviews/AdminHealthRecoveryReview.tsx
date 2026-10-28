import { useState } from "react";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  OpsPageHero,
  OpsRefreshNotice,
  OpsSnapshotStatus,
  OpsSurface,
} from "../../../app/ui/src/components/admin/ops-surfaces";

export function AdminHealthRecoveryReview() {
  const [recovered, setRecovered] = useState(false);

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl content-start gap-6 p-6">
      <OpsPageHero
        title="Library Health"
        description="Snapshot freshness and live issue updates stay visible while a refresh recovers."
      >
        <OpsSnapshotStatus
          snapshot={{ stale: true, built_at: "2026-10-22T08:30:00Z" }}
          streamStatus="reconnecting"
        />
      </OpsPageHero>
      <OpsSurface
        role="region"
        aria-labelledby="health-last-known-title"
        className="grid gap-4 p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <MonoLabel as="div" accent="31">
              Last known results
            </MonoLabel>
            <h2
              id="health-last-known-title"
              className="mt-2 font-display text-2xl font-bold text-text-primary"
            >
              4 recorded issues
            </h2>
          </div>
          <OpsSnapshotStatus
            snapshot={{ stale: true, built_at: "2026-10-22T08:30:00Z" }}
            streamStatus="reconnecting"
          />
        </div>
        <p className="text-sm text-text-muted">
          Existing results remain available while the health snapshot and live
          connection recover.
        </p>
        {!recovered ? (
          <OpsRefreshNotice
            message="Could not refresh library health. Showing the last successful snapshot."
            onRetry={() => setRecovered(true)}
          />
        ) : (
          <p role="status">
            <InfoBadge tone="success">Snapshot refreshed</InfoBadge>
          </p>
        )}
      </OpsSurface>
      <OpsSurface
        role="region"
        aria-label="Current snapshot sample"
        className="p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonoLabel as="div" accent="31">
            Current state
          </MonoLabel>
          <OpsSnapshotStatus
            snapshot={{ stale: false, built_at: "2026-10-22T09:30:00Z" }}
            streamStatus="live"
          />
        </div>
        <p className="mt-3 text-sm text-text-muted">
          A cold load still offers a full retry if no snapshot has been
          received.
        </p>
      </OpsSurface>
    </main>
  );
}
