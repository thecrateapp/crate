import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  RefreshCw as HeaderRefreshCw,
  Fingerprint as HeaderFingerprint,
  TrendingUp as HeaderTrendingUp,
  Orbit as HeaderOrbit,
  AudioLines as HeaderAudioLines,
  Loader2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  OpsPageHero,
  OpsPanel,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { Button } from "@crate/ui/shadcn/button";
import {
  useOpsSnapshot,
  type AnalysisStatusSnapshot,
} from "@/contexts/OpsSnapshotContext";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type ActionKey =
  | "analysis"
  | "bliss"
  | "popularity"
  | "fingerprints"
  | "lyrics"
  | "portable"
  | "rehydrate"
  | "richExport"
  | null;

const EMPTY_TRACK = {};

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeStatus(
  status: AnalysisStatusSnapshot,
): AnalysisStatusSnapshot {
  return {
    total: numberOrZero(status.total),
    analysis_done: numberOrZero(status.analysis_done),
    analysis_pending: numberOrZero(status.analysis_pending),
    analysis_active: numberOrZero(status.analysis_active),
    analysis_failed: numberOrZero(status.analysis_failed),
    bliss_done: numberOrZero(status.bliss_done),
    bliss_pending: numberOrZero(status.bliss_pending),
    bliss_active: numberOrZero(status.bliss_active),
    bliss_failed: numberOrZero(status.bliss_failed),
    fingerprint_done: numberOrZero(status.fingerprint_done),
    fingerprint_pending: numberOrZero(status.fingerprint_pending),
    fingerprint_chromaprint: numberOrZero(status.fingerprint_chromaprint),
    fingerprint_pcm: numberOrZero(status.fingerprint_pcm),
    chromaprint_available: Boolean(status.chromaprint_available),
    fingerprint_strategy: status.fingerprint_strategy || "unavailable",
    total_albums: numberOrZero(status.total_albums),
    lyrics_cached: numberOrZero(status.lyrics_cached),
    lyrics_found: numberOrZero(status.lyrics_found),
    lyrics_missing: numberOrZero(status.lyrics_missing),
    portable_sidecar_albums: numberOrZero(status.portable_sidecar_albums),
    portable_audio_tag_albums: numberOrZero(status.portable_audio_tag_albums),
    portable_audio_tag_tracks: numberOrZero(status.portable_audio_tag_tracks),
    portable_tag_errors: numberOrZero(status.portable_tag_errors),
    rich_export_albums: numberOrZero(status.rich_export_albums),
    rich_export_tracks: numberOrZero(status.rich_export_tracks),
    last_analyzed: status.last_analyzed || EMPTY_TRACK,
    last_bliss: status.last_bliss || EMPTY_TRACK,
    last_fingerprinted: status.last_fingerprinted || EMPTY_TRACK,
  };
}

function formatPercent(done: number, total: number) {
  if (total <= 0) return 0;
  if (done >= total) return 100;
  const raw = (done / total) * 100;
  if (raw > 0 && raw < 0.1) return 0.1;
  return Number(Math.min(raw, 99.9).toFixed(1));
}

function formatTimestamp(value?: string | null) {
  if (!value) return "No recent activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent activity";
  return date.toLocaleString();
}

function PipelineCoverage({
  title,
  done,
  pending,
  active,
  failed,
  total,
  accentClassName,
  emptyLabel,
}: {
  title: string;
  done: number;
  pending: number;
  active: number;
  failed: number;
  total: number;
  accentClassName: string;
  emptyLabel: string;
}) {
  const percent = formatPercent(done, total);
  const blocked = failed > 0;

  return (
    <div className="@container rounded-md border border-white/8 bg-black/20 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="space-y-1">
            <h3 className="font-display text-xl font-bold tracking-tight text-text-primary">
              {title}
            </h3>
            <div className="text-xs text-white/40">
              {total > 0
                ? `${done.toLocaleString()} of ${total.toLocaleString()} tracks processed`
                : emptyLabel}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InfoBadge>{percent}% coverage</InfoBadge>
          {active > 0 ? <InfoBadge active>{active} active</InfoBadge> : null}
          {failed > 0 ? (
            <InfoBadge tone="warning">{failed} failed</InfoBadge>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <div className="h-2 overflow-hidden rounded-sm bg-white/[0.06]">
          <div
            className={cn(
              "h-full rounded-sm transition-[width,background-color] duration-500",
              blocked
                ? "bg-gradient-to-r from-state-warning/60 to-state-warning/70"
                : accentClassName.replace("text-", "bg-").replace("/80", ""),
            )}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
          <MiniMetric label="Done" value={done.toLocaleString()} />
          <MiniMetric label="Pending" value={pending.toLocaleString()} />
          <MiniMetric label="Active" value={active.toLocaleString()} />
          <MiniMetric
            label="Failed"
            value={failed.toLocaleString()}
            tone={failed > 0 ? "danger" : "muted"}
          />
        </div>
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "danger";
}) {
  return (
    <div className="crate-form-field rounded-sm border border-white/6 bg-black/20 px-3 py-2">
      <MonoLabel as="div">{label}</MonoLabel>
      <div
        className={cn(
          "font-display text-base font-bold leading-tight tabular-nums",
          tone === "danger"
            ? "text-state-warning-text"
            : tone === "muted"
              ? "text-white/55"
              : "text-white/85",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RecentTrackCard({
  kind,
  title,
  track,
}: {
  kind: "analysis" | "bliss" | "fingerprint";
  title: string;
  track:
    | AnalysisStatusSnapshot["last_analyzed"]
    | AnalysisStatusSnapshot["last_bliss"]
    | NonNullable<AnalysisStatusSnapshot["last_fingerprinted"]>;
}) {
  return (
    <article
      aria-label={title}
      className="@container rounded-md border border-white/8 bg-black/20 p-4"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="space-y-1">
          <MonoLabel as="h3">{title}</MonoLabel>
          <div className="font-mono text-label font-normal tabular-nums text-text-subtle">
            {formatTimestamp(track.updated_at)}
          </div>
        </div>
      </div>

      {track.title || (kind === "fingerprint" && track.updated_at) ? (
        <div className="space-y-3">
          <div>
            <div className="font-display text-xl font-bold tracking-tight text-text-primary">
              {track.title || "Untitled track"}
            </div>
            <div className="text-sm text-white/45">
              {track.artist || "Unknown artist"}
              {track.album ? ` · ${track.album}` : ""}
            </div>
          </div>

          {kind === "analysis" && "bpm" in track ? (
            <div className="flex flex-wrap gap-2">
              {track.bpm != null ? (
                <InfoBadge>{Math.round(track.bpm)} BPM</InfoBadge>
              ) : null}
              {"audio_key" in track && track.audio_key ? (
                <InfoBadge>{track.audio_key}</InfoBadge>
              ) : null}
              {"energy" in track && track.energy != null ? (
                <InfoBadge>{Math.round(track.energy * 100)}% energy</InfoBadge>
              ) : null}
              {"danceability" in track && track.danceability != null ? (
                <InfoBadge>
                  {Math.round(track.danceability * 100)}% dance
                </InfoBadge>
              ) : null}
              {"has_mood" in track ? (
                <InfoBadge
                  className={
                    track.has_mood
                      ? "border-accent-action/25 bg-accent-action/10 text-accent-action-hi"
                      : "border-border-quiet bg-surface-card text-text-subtle"
                  }
                >
                  {track.has_mood ? "Mood extracted" : "Mood missing"}
                </InfoBadge>
              ) : null}
            </div>
          ) : kind === "bliss" ? (
            <div className="text-sm text-white/45">
              Similarity vectors refreshed and ready for related-track features.
            </div>
          ) : kind === "fingerprint" ? (
            <InfoBadge>
              {"source" in track && track.source === "chromaprint-v1"
                ? "Chromaprint"
                : "source" in track && track.source === "pcm16-md5-v1"
                  ? "PCM fallback"
                  : ("source" in track && track.source) || "Source unavailable"}
            </InfoBadge>
          ) : null}
        </div>
      ) : (
        <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-6 text-sm text-white/35">
          No recent output recorded yet.
        </div>
      )}
    </article>
  );
}

export function Analysis() {
  const { data: opsSnapshot, loading, error, refresh } = useOpsSnapshot();
  const rawStatus = opsSnapshot?.analysis ?? null;
  const status = useMemo(
    () => (rawStatus ? normalizeStatus(rawStatus) : null),
    [rawStatus],
  );
  const [activeAction, setActiveAction] = useState<ActionKey>(null);

  async function queueAction(
    path: string,
    action: Exclude<ActionKey, null>,
    success: string,
    body?: Record<string, unknown>,
  ) {
    setActiveAction(action);
    try {
      await api(path, "POST", body);
      toast.success(success);
      setTimeout(() => void refresh(true), 800);
    } catch {
      toast.error("The analysis task could not be queued");
    } finally {
      setActiveAction(null);
    }
  }

  const metrics = useMemo(() => {
    if (!status) {
      return {
        analysisPercent: 0,
        blissPercent: 0,
        fingerprintPercent: 0,
        lyricsPercent: 0,
        portableSidecarPercent: 0,
        portableTagPercent: 0,
        activeJobs: 0,
        failedJobs: 0,
      };
    }

    return {
      analysisPercent: formatPercent(status.analysis_done, status.total),
      blissPercent: formatPercent(status.bliss_done, status.total),
      fingerprintPercent: formatPercent(status.fingerprint_done, status.total),
      lyricsPercent: formatPercent(status.lyrics_cached, status.total),
      portableSidecarPercent: formatPercent(
        status.portable_sidecar_albums,
        status.total_albums,
      ),
      portableTagPercent: formatPercent(
        status.portable_audio_tag_tracks,
        status.total,
      ),
      activeJobs: status.analysis_active + status.bliss_active,
      failedJobs: status.analysis_failed + status.bliss_failed,
    };
  }, [status]);

  if (loading && !status) {
    return (
      <div
        role="status"
        aria-label="Loading analysis status"
        aria-busy="true"
        className="flex justify-center py-16 text-white/45"
      >
        <Loader2
          aria-hidden="true"
          data-admin-ux="analysis-loading"
          className="h-5 w-5 animate-spin text-primary"
        />
      </div>
    );
  }

  if (error && !status) {
    return <ErrorState message={error} onRetry={() => void refresh(true)} />;
  }

  if (!status) {
    return (
      <ErrorState
        message="No analysis status available"
        onRetry={() => void refresh(true)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Analysis"
        description="Audio features, similarity vectors and background processing coverage across the whole library."
        compactActions
        actions={
          <PageHeaderActions>
            <>
              <PageHeaderAction
                label="Refresh"
                onClick={() => void refresh(true)}
              >
                <HeaderRefreshCw
                  data-admin-ux="header-refresh"
                  aria-hidden="true"
                />
              </PageHeaderAction>
              <PageHeaderAction
                label="Backfill fingerprints"
                onClick={() =>
                  queueAction(
                    "/api/tasks/backfill-track-fingerprints",
                    "fingerprints",
                    "Audio fingerprint backfill queued",
                  )
                }
                disabled={activeAction !== null}
                aria-busy={activeAction === "fingerprints" || undefined}
              >
                {activeAction === "fingerprints" ? (
                  <Loader2
                    size={14}
                    aria-hidden="true"
                    data-admin-ux="analysis-action-fingerprints"
                    className="animate-spin"
                  />
                ) : null}
                {!(activeAction === "fingerprints") ? (
                  <HeaderFingerprint
                    data-admin-ux="header-backfill-fingerprints"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
              <PageHeaderAction
                label="Recompute popularity"
                onClick={() =>
                  queueAction(
                    "/api/manage/compute-popularity",
                    "popularity",
                    "Popularity recomputation queued",
                  )
                }
                disabled={activeAction !== null}
                aria-busy={activeAction === "popularity" || undefined}
              >
                {activeAction === "popularity" ? (
                  <Loader2
                    size={14}
                    aria-hidden="true"
                    data-admin-ux="analysis-action-popularity"
                    className="animate-spin"
                  />
                ) : null}
                {!(activeAction === "popularity") ? (
                  <HeaderTrendingUp
                    data-admin-ux="header-recompute-popularity"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
              <PageHeaderAction
                label="Recompute bliss"
                onClick={() =>
                  queueAction(
                    "/api/manage/compute-bliss",
                    "bliss",
                    "Bliss recomputation queued",
                  )
                }
                disabled={activeAction !== null}
                aria-busy={activeAction === "bliss" || undefined}
              >
                {activeAction === "bliss" ? (
                  <Loader2
                    size={14}
                    aria-hidden="true"
                    data-admin-ux="analysis-action-bliss"
                    className="animate-spin"
                  />
                ) : null}
                {!(activeAction === "bliss") ? (
                  <HeaderOrbit
                    data-admin-ux="header-recompute-bliss"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
              <PageHeaderAction
                label="Re-analyze all"
                onClick={() =>
                  queueAction(
                    "/api/manage/analyze-all",
                    "analysis",
                    "Full audio re-analysis queued",
                  )
                }
                disabled={activeAction !== null}
                aria-busy={activeAction === "analysis" || undefined}
              >
                {activeAction === "analysis" ? (
                  <Loader2
                    size={14}
                    aria-hidden="true"
                    data-admin-ux="analysis-action-analysis"
                    className="animate-spin"
                  />
                ) : null}
                {!(activeAction === "analysis") ? (
                  <HeaderAudioLines
                    data-admin-ux="header-re-analyze-all"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
            </>
          </PageHeaderActions>
        }
      >
        <InfoBadge active>{status.total.toLocaleString()} tracks</InfoBadge>
        <InfoBadge>{metrics.analysisPercent}% audio covered</InfoBadge>
        <InfoBadge>{metrics.blissPercent}% bliss covered</InfoBadge>
        <InfoBadge>{metrics.fingerprintPercent}% fingerprinted</InfoBadge>
        <InfoBadge>{metrics.lyricsPercent}% lyrics cached</InfoBadge>
        <InfoBadge>{metrics.portableSidecarPercent}% portable albums</InfoBadge>
        <InfoBadge tone={status.chromaprint_available ? "accent" : "warning"}>
          {status.chromaprint_available ? "Chromaprint ready" : "PCM fallback"}
        </InfoBadge>
        {metrics.activeJobs > 0 ? (
          <InfoBadge>{metrics.activeJobs} active</InfoBadge>
        ) : null}
        {metrics.failedJobs > 0 ? (
          <InfoBadge tone="warning">{metrics.failedJobs} failed</InfoBadge>
        ) : null}
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <OpsStatTile
          label="Audio Coverage"
          value={`${metrics.analysisPercent}%`}
          caption={`${status.analysis_done.toLocaleString()} analyzed`}
          tone="primary"
        />
        <OpsStatTile
          label="Bliss Coverage"
          value={`${metrics.blissPercent}%`}
          caption={`${status.bliss_done.toLocaleString()} vectors`}
        />
        <OpsStatTile
          label="Fingerprint Coverage"
          value={`${metrics.fingerprintPercent}%`}
          caption={`${status.fingerprint_done.toLocaleString()} tracks fingerprinted`}
          tone={status.chromaprint_available ? "success" : "warning"}
        />
        <OpsStatTile
          label="Lyrics Cache"
          value={`${metrics.lyricsPercent}%`}
          caption={`${status.lyrics_found.toLocaleString()} tracks with lyrics`}
          tone="success"
        />
        <OpsStatTile
          label="Portable Metadata"
          value={`${metrics.portableSidecarPercent}%`}
          caption={`${status.portable_audio_tag_tracks.toLocaleString()} tracks tagged`}
          tone={status.portable_tag_errors > 0 ? "warning" : "default"}
        />
      </div>

      <OpsPanel
        title="Pipeline coverage"
        description="Track how far each background pipeline has progressed and spot failures before they rot."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <PipelineCoverage
            title="Audio features"
            done={status.analysis_done}
            pending={status.analysis_pending}
            active={status.analysis_active}
            failed={status.analysis_failed}
            total={status.total}
            accentClassName="text-primary"
            emptyLabel="Waiting for tracks"
          />
          <PipelineCoverage
            title="Bliss vectors"
            done={status.bliss_done}
            pending={status.bliss_pending}
            active={status.bliss_active}
            failed={status.bliss_failed}
            total={status.total}
            accentClassName="text-accent-action-hi"
            emptyLabel="Waiting for tracks"
          />
          <div className="@container rounded-md border border-white/8 bg-black/20 p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="space-y-1">
                  <h3 className="font-display text-xl font-bold tracking-tight text-text-primary">
                    Audio fingerprints
                  </h3>
                  <div className="text-xs text-white/40">
                    {status.total > 0
                      ? `${status.fingerprint_done.toLocaleString()} of ${status.total.toLocaleString()} tracks fingerprinted`
                      : "Waiting for tracks"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <InfoBadge>{metrics.fingerprintPercent}% coverage</InfoBadge>
                <InfoBadge
                  className={
                    status.chromaprint_available
                      ? "border-accent-action/25 bg-accent-action/10 text-accent-action-hi"
                      : "border-border-quiet bg-surface-card text-text-subtle"
                  }
                >
                  {status.chromaprint_available
                    ? "Chromaprint active"
                    : "PCM fallback"}
                </InfoBadge>
              </div>
            </div>

            <div className="space-y-3">
              <div className="h-2 overflow-hidden rounded-sm bg-white/[0.06]">
                <div
                  className="h-full rounded-sm bg-accent-action/80 transition-[width,background-color] duration-500"
                  style={{
                    width: `${Math.min(metrics.fingerprintPercent, 100)}%`,
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
                <MiniMetric
                  label="Done"
                  value={status.fingerprint_done.toLocaleString()}
                />
                <MiniMetric
                  label="Pending"
                  value={status.fingerprint_pending.toLocaleString()}
                />
                <MiniMetric
                  label="Chromaprint"
                  value={status.fingerprint_chromaprint.toLocaleString()}
                />
                <MiniMetric
                  label="PCM Fallback"
                  value={status.fingerprint_pcm.toLocaleString()}
                  tone={status.fingerprint_pcm > 0 ? "muted" : "default"}
                />
              </div>
            </div>
          </div>
        </div>
      </OpsPanel>

      <OpsPanel
        title="Portable library state"
        description="Lyrics cache, portable sidecars, identity tags and export coverage."
        action={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                queueAction(
                  "/api/manage/sync-lyrics",
                  "lyrics",
                  "Lyrics sync queued",
                  { limit: 1000 },
                )
              }
              disabled={activeAction !== null}
              aria-busy={activeAction === "lyrics" || undefined}
              className="min-h-11 gap-2"
            >
              {activeAction === "lyrics" ? (
                <Loader2
                  size={14}
                  aria-hidden="true"
                  data-admin-ux="analysis-action-lyrics"
                  className="animate-spin"
                />
              ) : null}
              Sync lyrics
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                queueAction(
                  "/api/manage/portable-metadata",
                  "portable",
                  "Portable metadata write queued",
                  { write_audio_tags: true, write_sidecars: true },
                )
              }
              disabled={activeAction !== null}
              aria-busy={activeAction === "portable" || undefined}
              className="min-h-11 gap-2"
            >
              {activeAction === "portable" ? (
                <Loader2
                  size={14}
                  aria-hidden="true"
                  data-admin-ux="analysis-action-portable"
                  className="animate-spin"
                />
              ) : null}
              Write metadata
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                queueAction(
                  "/api/manage/portable-metadata/rehydrate",
                  "rehydrate",
                  "Portable metadata rehydrate queued",
                )
              }
              disabled={activeAction !== null}
              aria-busy={activeAction === "rehydrate" || undefined}
              className="min-h-11 gap-2"
            >
              {activeAction === "rehydrate" ? (
                <Loader2
                  size={14}
                  aria-hidden="true"
                  data-admin-ux="analysis-action-rehydrate"
                  className="animate-spin"
                />
              ) : null}
              Rehydrate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                queueAction(
                  "/api/manage/portable-metadata/export-rich",
                  "richExport",
                  "Rich metadata export queued",
                  { include_audio: false, write_rich_tags: false },
                )
              }
              disabled={activeAction !== null}
              aria-busy={activeAction === "richExport" || undefined}
              className="min-h-11 gap-2"
            >
              {activeAction === "richExport" ? (
                <Loader2
                  size={14}
                  aria-hidden="true"
                  data-admin-ux="analysis-action-richExport"
                  className="animate-spin"
                />
              ) : null}
              Export index
            </Button>
          </>
        }
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="@container rounded-md border border-white/8 bg-black/20 p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="space-y-1">
                  <h3 className="font-display text-xl font-bold tracking-tight text-text-primary">
                    Lyrics
                  </h3>
                  <div className="text-xs text-white/40">
                    {status.lyrics_cached.toLocaleString()} cached lookups
                    across {status.total.toLocaleString()} tracks
                  </div>
                </div>
              </div>
              <InfoBadge>{metrics.lyricsPercent}% cache</InfoBadge>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniMetric
                label="Cached"
                value={status.lyrics_cached.toLocaleString()}
              />
              <MiniMetric
                label="Found"
                value={status.lyrics_found.toLocaleString()}
              />
              <MiniMetric
                label="Missing"
                value={status.lyrics_missing.toLocaleString()}
                tone={status.lyrics_missing > 0 ? "muted" : "default"}
              />
            </div>
          </div>

          <div className="@container rounded-md border border-white/8 bg-black/20 p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="space-y-1">
                  <h3 className="font-display text-xl font-bold tracking-tight text-text-primary">
                    Portable metadata
                  </h3>
                  <div className="text-xs text-white/40">
                    {status.portable_sidecar_albums.toLocaleString()} sidecars
                    across {status.total_albums.toLocaleString()} albums
                  </div>
                </div>
              </div>
              <InfoBadge>{metrics.portableSidecarPercent}% albums</InfoBadge>
            </div>
            <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
              <MiniMetric
                label="Sidecars"
                value={status.portable_sidecar_albums.toLocaleString()}
              />
              <MiniMetric
                label="Tag albums"
                value={status.portable_audio_tag_albums.toLocaleString()}
              />
              <MiniMetric
                label="Tag tracks"
                value={status.portable_audio_tag_tracks.toLocaleString()}
              />
              <MiniMetric
                label="Errors"
                value={status.portable_tag_errors.toLocaleString()}
                tone={status.portable_tag_errors > 0 ? "danger" : "default"}
              />
            </div>
          </div>

          <div className="@container rounded-md border border-white/8 bg-black/20 p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="space-y-1">
                  <h3 className="font-display text-xl font-bold tracking-tight text-text-primary">
                    Rich exports
                  </h3>
                  <div className="text-xs text-white/40">
                    {status.rich_export_albums.toLocaleString()} albums exported
                    as portable packages
                  </div>
                </div>
              </div>
              <InfoBadge>
                {status.rich_export_tracks.toLocaleString()} tracks
              </InfoBadge>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniMetric
                label="Albums"
                value={status.rich_export_albums.toLocaleString()}
              />
              <MiniMetric
                label="Tracks"
                value={status.rich_export_tracks.toLocaleString()}
              />
              <MiniMetric
                label="Tag coverage"
                value={`${metrics.portableTagPercent}%`}
              />
            </div>
          </div>
        </div>
      </OpsPanel>

      <OpsPanel
        title="Recent outputs"
        description="The freshest material that made it through each pipeline, useful when you want to sanity-check the daemon."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <RecentTrackCard
            kind="analysis"
            title="Last analyzed track"
            track={status.last_analyzed}
          />
          <RecentTrackCard
            kind="bliss"
            title="Last bliss computation"
            track={status.last_bliss}
          />
          <RecentTrackCard
            kind="fingerprint"
            title="Last audio fingerprint"
            track={status.last_fingerprinted ?? EMPTY_TRACK}
          />
        </div>
      </OpsPanel>
    </div>
  );
}
