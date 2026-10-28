import { useState } from "react";
import { Loader2 } from "@crate/ui/icons";
import { toast } from "sonner";

import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Button } from "@crate/ui/shadcn/button";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { SmartMixActivity } from "@/components/SmartMixActivity";
import {
  SmartMixTracks,
  type SmartMixVersionCount,
} from "@/components/SmartMixTracks";

type SmartMixControlState = "idle" | "running" | "paused";

interface SmartMixAdminStatus {
  profileVersion: number;
  analyzerVersion: string;
  totalTracks: number;
  currentProfiles: number;
  staleProfiles: number;
  outdatedProfiles?: number;
  sourceChangedProfiles?: number;
  missingProfiles: number;
  coveragePercent: number;
  quality: {
    full: number;
    partial: number;
    legacy: number;
    unavailable: number;
  };
  currentQuality?: {
    full: number;
    partial: number;
    legacy: number;
  };
  processing: {
    pending: number;
    active: number;
    failed: number;
    exhausted: number;
    completed: number;
  };
  versions?: SmartMixVersionCount[];
  refreshedAt: string | null;
  controlState: SmartMixControlState;
  activeTask: {
    id: string;
    status: string;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
}

type BackfillAction = "start" | "pause" | "cancel" | "resume";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 border-t border-border-quiet py-3">
      <MonoLabel as="div">{label}</MonoLabel>
      <div className="mt-2 font-mono text-numeral-sm tabular-nums text-text-primary">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

export function SmartMixCoverage() {
  const { data, loading, error, refetch } = useApi<SmartMixAdminStatus>(
    "/api/admin/smart-mix/status",
  );
  const [activeAction, setActiveAction] = useState<BackfillAction | null>(null);

  async function runAction(action: BackfillAction) {
    setActiveAction(action);
    try {
      if (action === "start" || action === "resume") {
        await api(
          `/api/admin/smart-mix/backfill${
            action === "resume" ? "/resume" : ""
          }`,
          "POST",
          { batchSize: 25, maxAttempts: 3 },
        );
      } else {
        await api(`/api/admin/smart-mix/backfill/${action}`, "POST");
      }
      toast.success(
        action === "pause"
          ? "Smart Mix backfill paused"
          : action === "cancel"
            ? "Smart Mix backfill cancelled"
            : "Smart Mix backfill queued",
      );
      await refetch();
    } catch {
      toast.error("The Smart Mix backfill action failed");
    } finally {
      setActiveAction(null);
    }
  }

  if (loading && !data) {
    return <LoadingState label="Loading Smart Mix coverage" />;
  }

  if (error || !data) {
    return (
      <ErrorState
        message="Smart Mix coverage is unavailable."
        onRetry={refetch}
      />
    );
  }

  const percent = Math.max(0, Math.min(data.coveragePercent, 100));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <MonoLabel as="span" tone="accent">
              Smart Mix profiles
            </MonoLabel>
            <InfoBadge>{percent}% coverage</InfoBadge>
            <InfoBadge>{data.analyzerVersion}</InfoBadge>
            <InfoBadge>profile v{data.profileVersion}</InfoBadge>
          </div>
          <div className="text-xs text-text-muted">
            {data.currentProfiles.toLocaleString()} current profiles across{" "}
            {data.totalTracks.toLocaleString()} eligible tracks.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data.controlState === "idle" ? (
            <Button
              size="sm"
              className="gap-2"
              disabled={activeAction !== null}
              onClick={() => void runAction("start")}
            >
              {activeAction === "start" ? (
                <Loader2
                  data-admin-ux="mix-start-loading"
                  className="animate-spin"
                />
              ) : null}
              Start backfill
            </Button>
          ) : null}
          {data.controlState === "paused" ? (
            <Button
              size="sm"
              className="gap-2"
              disabled={activeAction !== null}
              onClick={() => void runAction("resume")}
            >
              {activeAction === "resume" ? (
                <Loader2
                  data-admin-ux="mix-resume-loading"
                  className="animate-spin"
                />
              ) : null}
              Resume backfill
            </Button>
          ) : null}
          {data.controlState === "running" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={activeAction !== null}
                onClick={() => void runAction("pause")}
              >
                {activeAction === "pause" ? (
                  <Loader2
                    data-admin-ux="mix-pause-loading"
                    className="animate-spin"
                  />
                ) : null}
                Pause backfill
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-state-warning-text"
                disabled={activeAction !== null}
                onClick={() => void runAction("cancel")}
              >
                {activeAction === "cancel" ? (
                  <Loader2
                    data-admin-ux="mix-cancel-loading"
                    className="animate-spin"
                  />
                ) : null}
                Cancel backfill
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <ProgressHairline
        label="Smart Mix profile coverage"
        value={percent / 100}
        valueText={`${percent}% of eligible tracks have current profiles`}
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 gap-y-2">
        <Metric
          label="Full"
          value={data.currentQuality?.full ?? data.quality.full}
        />
        <Metric
          label="Partial"
          value={data.currentQuality?.partial ?? data.quality.partial}
        />
        <Metric label="Stale" value={data.staleProfiles} />
        <Metric label="Missing" value={data.missingProfiles} />
        <Metric label="Pending" value={data.processing.pending} />
        <Metric label="Active" value={data.processing.active} />
        <Metric label="Failed" value={data.processing.failed} />
        <Metric label="Exhausted" value={data.processing.exhausted} />
      </div>

      <SmartMixActivity
        live={data.controlState === "running"}
        remaining={data.missingProfiles}
        onRefreshCounts={refetch}
      />

      <SmartMixTracks counts={data} />
    </div>
  );
}
