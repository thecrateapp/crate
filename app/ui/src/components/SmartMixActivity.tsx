import { useEffect, useRef, useState } from "react";
import { Loader2 } from "@crate/ui/icons";

import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { api } from "@/lib/api";

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
    <div className="space-y-3 border-t border-border-quiet py-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonoLabel as="span" tone="accent">
          {activity.running.length > 0 ? "Analyzing now" : "Recent activity"}
        </MonoLabel>
        <InfoBadge>{activity.tracksPerMinute} tracks/min</InfoBadge>
        <InfoBadge>{activity.queued.toLocaleString()} queued</InfoBadge>
        {live && eta ? <InfoBadge>{eta}</InfoBadge> : null}
      </div>

      {activity.running.map((track) => (
        <div
          key={track.taskId}
          className="flex items-center gap-2 text-sm text-text-accent-action-hi"
        >
          <Loader2
            data-admin-ux="mix-activity-loading"
            size={13}
            className="animate-spin text-accent-action-hi"
          />
          <TooltipHint content={trackLabel(track)}>
            <span className="min-w-0 truncate" tabIndex={0}>
              {trackLabel(track)}
            </span>
          </TooltipHint>
          <span className="text-xs text-text-muted">
            {seconds(track.elapsedMs)}
          </span>
        </div>
      ))}

      {activity.recent.length > 0 ? (
        <ul className="space-y-1">
          {activity.recent.map((track) => (
            <li
              key={track.taskId}
              className="space-y-1 text-xs text-text-secondary"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <InfoBadge
                  tone={track.outcome === "published" ? "neutral" : "warning"}
                >
                  {track.outcome}
                </InfoBadge>
                <TooltipHint content={trackLabel(track)}>
                  <span className="min-w-0 truncate" tabIndex={0}>
                    {trackLabel(track)}
                  </span>
                </TooltipHint>
                <span className="text-text-subtle">
                  {seconds(track.durationMs)}
                </span>
              </div>
              {track.error ? (
                <p className="whitespace-normal wrap-anywhere text-state-warning-text">
                  {track.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
