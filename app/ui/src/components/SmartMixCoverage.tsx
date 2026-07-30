import { useState } from "react";
import {
  AudioLines,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { Button } from "@crate/ui/shadcn/button";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";

type SmartMixControlState = "idle" | "running" | "paused";

interface SmartMixAdminStatus {
  profileVersion: number;
  analyzerVersion: string;
  totalTracks: number;
  currentProfiles: number;
  missingProfiles: number;
  coveragePercent: number;
  quality: {
    full: number;
    partial: number;
    legacy: number;
    unavailable: number;
  };
  processing: {
    pending: number;
    active: number;
    failed: number;
    completed: number;
  };
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
    <div className="rounded-sm border border-white/6 bg-black/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-white/85">
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
    return (
      <div className="flex min-h-40 items-center justify-center text-white/45">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-red-500/20 bg-red-500/8 p-4 text-sm text-red-100">
        Smart Mix coverage is unavailable.
      </div>
    );
  }

  const percent = Math.max(0, Math.min(data.coveragePercent, 100));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/10 text-primary">
            <AudioLines size={17} />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-white">
                Smart Mix profiles
              </span>
              <CrateChip>{percent}% coverage</CrateChip>
              <CrateChip className="text-[10px]">
                {data.analyzerVersion}
              </CrateChip>
              <CrateChip className="text-[10px]">
                profile v{data.profileVersion}
              </CrateChip>
            </div>
            <div className="text-xs text-white/40">
              {data.currentProfiles.toLocaleString()} current profiles across{" "}
              {data.totalTracks.toLocaleString()} eligible tracks.
            </div>
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
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
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
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCcw size={14} />
              )}
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
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Pause size={14} />
                )}
                Pause backfill
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-red-200"
                disabled={activeAction !== null}
                onClick={() => void runAction("cancel")}
              >
                {activeAction === "cancel" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Square size={14} />
                )}
                Cancel backfill
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="h-2 overflow-hidden rounded-sm bg-white/[0.06]">
        <div
          className="h-full rounded-sm bg-primary transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Full" value={data.quality.full} />
        <Metric label="Partial" value={data.quality.partial} />
        <Metric label="Missing" value={data.missingProfiles} />
        <Metric label="Pending" value={data.processing.pending} />
        <Metric label="Active" value={data.processing.active} />
        <Metric label="Failed" value={data.processing.failed} />
      </div>
    </div>
  );
}
