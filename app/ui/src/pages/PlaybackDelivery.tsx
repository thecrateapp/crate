import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Meter } from "@crate/ui/primitives/Meter";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Button } from "@crate/ui/shadcn/button";
import { useEffect } from "react";

import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { useApi } from "@/hooks/use-api";
import { timeAgo } from "@/lib/utils";

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

interface PlaybackDeliveryVariant {
  id: string;
  track_id: number | null;
  preset: string;
  status: string;
  delivery_format: string;
  delivery_bitrate: number;
  source_format: string | null;
  source_size: number | null;
  bytes: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  updated_at: string | null;
}

export interface PlaybackDeliverySnapshot {
  stats: {
    lossless_tracks: number;
    hires_tracks: number;
    variants: number;
    ready: number;
    pending: number;
    pending_active: number;
    pending_unassigned: number;
    pending_stale: number;
    running: number;
    failed: number;
    missing: number;
    ready_tracks: number;
    cached_bytes: number;
    estimated_saved_bytes: number;
    coverage_percent: number;
    avg_prepare_seconds: number | null;
  };
  runtime: {
    active: number;
    limit: number;
  };
  recent_variants: PlaybackDeliveryVariant[];
}

function variantStatusClass(status: string) {
  if (status === "ready" || status === "running")
    return "border-accent-action/20 bg-accent-action/[0.06] text-accent-action-hi";
  if (status === "failed")
    return "border-state-warning/20 bg-state-warning/[0.08] text-state-warning-text";
  if (status === "pending")
    return "border-state-warning/20 bg-state-warning/[0.06] text-state-warning-text";
  return "border-white/10 bg-white/[0.04] text-white/60";
}

function relativeTime(value: string | null) {
  return value ? timeAgo(value) : "n/a";
}

export function PlaybackDelivery() {
  const {
    data: delivery,
    loading,
    error,
    refetch,
  } = useApi<PlaybackDeliverySnapshot>("/api/admin/playback-delivery?limit=20");

  useEffect(() => {
    const timer = window.setInterval(refetch, 15_000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  return (
    <PlaybackDeliveryContent
      delivery={delivery}
      loading={loading}
      error={error}
      onRefresh={refetch}
    />
  );
}

export function PlaybackDeliveryContent({
  delivery,
  loading,
  error,
  onRefresh,
}: {
  delivery: PlaybackDeliverySnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (loading && !delivery) {
    return (
      <div
        role="status"
        aria-label="Loading playback delivery"
        aria-busy="true"
        className="py-16 text-center text-sm text-text-muted"
      >
        Loading playback delivery...
      </div>
    );
  }

  if (error && !delivery) {
    return (
      <ErrorState
        message="Could not load playback delivery."
        onRetry={onRefresh}
      />
    );
  }

  const stats = delivery?.stats;
  const runtime = delivery?.runtime;
  const runtimeAvailable =
    typeof runtime?.active === "number" && typeof runtime?.limit === "number";

  return (
    <div className="space-y-6">
      {error ? (
        <OpsRefreshNotice
          message="Could not refresh playback delivery. Showing the last successful sample."
          onRetry={onRefresh}
        />
      ) : null}

      <OpsPageHero
        title="Playback Delivery"
        description="Cached audio variants, playback capacity and recent preparation results for Listen."
        actions={
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile
          label="Lossless coverage"
          value={stats ? `${stats.coverage_percent}%` : "—"}
          caption={
            stats
              ? `${stats.ready_tracks.toLocaleString()} / ${stats.lossless_tracks.toLocaleString()} tracks`
              : "Waiting for cache stats"
          }
          tone={stats && stats.coverage_percent > 0 ? "success" : "default"}
        />
        <OpsStatTile
          label="Ready variants"
          value={stats ? stats.ready.toLocaleString() : "—"}
          caption={
            stats
              ? `${stats.variants.toLocaleString()} cached records`
              : undefined
          }
          tone={stats && stats.ready > 0 ? "success" : "default"}
        />
        <OpsStatTile
          label="Cache size"
          value={stats ? formatBytes(stats.cached_bytes) : "—"}
          caption={
            stats
              ? `${formatBytes(stats.estimated_saved_bytes)} avoided vs source`
              : undefined
          }
        />
        <OpsStatTile
          label="Average prepare"
          value={
            stats?.avg_prepare_seconds != null
              ? `${stats.avg_prepare_seconds.toFixed(1)}s`
              : "—"
          }
          caption={
            stats
              ? `${stats.hires_tracks.toLocaleString()} hi-res sources`
              : undefined
          }
        />
      </div>

      <OpsPanel
        title="Playback capacity"
        description="Active transcode slots and variants waiting for preparation."
      >
        <div className="space-y-4">
          <Meter
            label="Transcode slots"
            value={runtimeAvailable ? runtime.active : null}
            max={runtime?.limit ?? 0}
            valueText={
              runtimeAvailable ? `${runtime.active}/${runtime.limit}` : "n/a"
            }
            over={runtimeAvailable && runtime.active > runtime.limit}
          />
          <div className="flex flex-wrap gap-2">
            <InfoBadge>{stats?.running ?? "—"} running</InfoBadge>
            <InfoBadge>{stats?.pending_active ?? "—"} active pending</InfoBadge>
            <InfoBadge>{stats?.pending_unassigned ?? "—"} unassigned</InfoBadge>
            {stats && stats.pending_stale > 0 ? (
              <InfoBadge tone="warning">{stats.pending_stale} stale</InfoBadge>
            ) : null}
            {stats && stats.failed > 0 ? (
              <InfoBadge tone="warning">{stats.failed} failed</InfoBadge>
            ) : null}
          </div>
        </div>
      </OpsPanel>

      <OpsPanel
        title="Recent variants"
        description="Latest playback cache writes and retries."
      >
        <div className="overflow-hidden rounded-md border border-border-quiet">
          {(delivery?.recent_variants ?? []).length > 0 ? (
            delivery?.recent_variants.map((variant) => {
              const track =
                [variant.artist, variant.title].filter(Boolean).join(" · ") ||
                `Track ${variant.track_id ?? "unknown"}`;
              const reduction =
                variant.source_size && variant.bytes
                  ? `${Math.max(0, Math.round((1 - variant.bytes / variant.source_size) * 100))}% smaller`
                  : null;
              return (
                <div
                  key={variant.id}
                  className="grid gap-3 border-b border-border-quiet px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_110px_140px_90px] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {track}
                    </div>
                    <div className="mt-1 truncate text-xs text-text-muted">
                      {variant.album || "No album"} · {variant.preset} ·{" "}
                      {variant.source_format || "source"} →{" "}
                      {variant.delivery_format} {variant.delivery_bitrate}k
                    </div>
                  </div>
                  <InfoBadge className={variantStatusClass(variant.status)}>
                    {variant.status}
                  </InfoBadge>
                  <div className="font-mono text-label tabular-nums text-text-muted">
                    {formatBytes(variant.bytes)}
                    {reduction ? ` · ${reduction}` : ""}
                  </div>
                  <div className="font-mono text-label text-text-subtle">
                    {relativeTime(variant.updated_at)}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-6 text-sm text-text-muted">
              No playback variants prepared yet.
            </div>
          )}
        </div>
      </OpsPanel>
    </div>
  );
}
