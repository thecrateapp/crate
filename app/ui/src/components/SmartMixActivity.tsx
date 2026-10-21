import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const ACTIVITY_POLL_MS = 5_000;
export const COUNTS_REFRESH_EVERY = 2;

interface ActivityTrack {
  taskId: string;
  trackId: number | null;
  title: string | null;
  artist: string | null;
}

interface RunningTrack extends ActivityTrack {
  elapsedMs: number | null;
}

interface FinishedTrack extends ActivityTrack {
  outcome: string;
  error: string | null;
  durationMs: number | null;
}

interface SmartMixActivitySnapshot {
  queued: number;
  running: RunningTrack[];
  recent: FinishedTrack[];
  tracksPerMinute: number;
  rateWindowMinutes: number;
}

function seconds(ms: number | null) {
  return ms == null ? "" : `${(ms / 1000).toFixed(1)} s`;
}

export function formatEta(remaining: number, tracksPerMinute: number) {
  if (remaining <= 0 || tracksPerMinute <= 0) return null;
  const minutes = Math.ceil(remaining / tracksPerMinute);
  if (minutes < 60) return `~${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `~${hours} h ${rest} min left` : `~${hours} h left`;
}

function trackLabel(track: ActivityTrack) {
  const title = track.title || `Track ${track.trackId ?? "?"}`;
  return track.artist ? `${title} · ${track.artist}` : title;
}

export function SmartMixActivity({
  live,
  remaining,
  onRefreshCounts,
}: {
  live: boolean;
  remaining: number;
  onRefreshCounts: () => void;
}) {
  const [activity, setActivity] = useState<SmartMixActivitySnapshot | null>(
    null,
  );
  const refreshCounts = useRef(onRefreshCounts);
  refreshCounts.current = onRefreshCounts;

  useEffect(() => {
    let disposed = false;
    let ticks = 0;
    const load = async () => {
      if (document.hidden) return;
      try {
        const next = await api<SmartMixActivitySnapshot>(
          "/api/admin/smart-mix/activity",
        );
        if (!disposed) setActivity(next);
      } catch {
        return;
      }
      ticks += 1;
      if (live && ticks % COUNTS_REFRESH_EVERY === 0) refreshCounts.current();
    };
    void load();
    if (!live) {
      return () => {
        disposed = true;
      };
    }
    const timer = setInterval(() => void load(), ACTIVITY_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [live]);

  if (!activity) return null;
  if (!live && activity.running.length === 0 && activity.recent.length === 0) {
    return null;
  }
  const eta = formatEta(remaining, activity.tracksPerMinute);

  return (
    <div className="space-y-2 rounded-sm border border-white/6 bg-black/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-white/30">
          {activity.running.length > 0 ? "Analyzing now" : "Recent activity"}
        </span>
        <CrateChip className="text-[10px]">
          {activity.tracksPerMinute} tracks/min
        </CrateChip>
        <CrateChip className="text-[10px]">
          {activity.queued.toLocaleString()} queued
        </CrateChip>
        {live && eta ? (
          <CrateChip className="text-[10px]">{eta}</CrateChip>
        ) : null}
      </div>

      {activity.running.map((track) => (
        <div
          key={track.taskId}
          className="flex items-center gap-2 text-sm text-white/85"
        >
          <Loader2 size={13} className="animate-spin text-primary" />
          <span className="truncate">{trackLabel(track)}</span>
          <span className="text-xs text-white/40">
            {seconds(track.elapsedMs)}
          </span>
        </div>
      ))}

      {activity.recent.length > 0 ? (
        <ul className="space-y-1">
          {activity.recent.map((track) => (
            <li
              key={track.taskId}
              className="flex items-center gap-2 text-xs text-white/55"
              title={track.error ?? undefined}
            >
              <CrateChip
                className={cn(
                  "text-[10px]",
                  track.outcome === "failed" && "text-red-200",
                  track.outcome !== "published" &&
                    track.outcome !== "failed" &&
                    "text-amber-200",
                )}
              >
                {track.outcome}
              </CrateChip>
              <span className="truncate">{trackLabel(track)}</span>
              <span className="text-white/35">{seconds(track.durationMs)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
