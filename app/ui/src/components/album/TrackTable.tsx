import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { useLibrarySearch } from "@/hooks/use-library-search";
import {
  formatTrackAnalysis,
  formatTrackQuality,
} from "@crate/ui/lib/track-meta";
import { useState } from "react";
import { BarChart3, Download, AlignLeft, Loader2 } from "@crate/ui/icons";

import { SimilarTracksPanel } from "@/components/track/SimilarTracksPanel";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";

import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@crate/ui/shadcn/table";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@crate/ui/shadcn/tooltip";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import {
  trackDownloadApiPath,
  trackManagementApiPath,
} from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { formatDuration, formatBitrate } from "@/lib/utils";
import { toast } from "sonner";

interface Track {
  id?: number;
  entity_uid?: string;
  filename: string;
  format: string;
  size_mb: number;
  bitrate: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  length_sec: number;
  popularity?: number | null;
  popularity_score?: number | null;
  popularity_confidence?: number | null;
  lyrics?: TrackLyricsStatus;
  stream_variants?: TrackStreamVariant[];
  tags: Record<string, string>;
  path?: string;
}

function getTrackLyricsSyncKey(track: Track): string {
  if (track.id != null) return `id:${track.id}`;
  if (track.entity_uid) return `uid:${track.entity_uid}`;
  if (track.path) return `path:${track.path}`;
  return `file:${track.filename}`;
}

export interface TrackLyricsStatus {
  status?: string;
  found?: boolean;
  has_plain?: boolean;
  has_synced?: boolean;
  provider?: string;
  updated_at?: string | null;
}

interface TrackStreamVariant {
  id: string;
  preset: string;
  status: string;
  delivery_format: string;
  delivery_codec: string;
  delivery_bitrate: number;
  delivery_sample_rate?: number | null;
  bytes?: number | null;
  error?: string | null;
  task_id?: string | null;
  task_status?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
}

interface AlbumSearchResult {
  id?: number;
  entity_uid?: string;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  name: string;
  year?: string | number | null;
  has_cover?: boolean;
}

export type { AudioAnalysisTrack } from "./audio-analysis";
import { analysisForTrack, type AudioAnalysisTrack } from "./audio-analysis";
import { AudioProfileCard } from "./AudioProfileCard";
import { InfoBadge, type InfoBadgeTone } from "@crate/ui/primitives/InfoBadge";
import { ActionButton, ActionLink } from "@crate/ui/primitives/ActionGroup";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

interface TrackTableProps {
  tracks: Track[];
  artist?: string;
  artistId?: number;
  artistSlug?: string;
  album?: string;
  albumId?: number;
  albumSlug?: string;
  albumCover?: string;
  analysisData?: Record<string, AudioAnalysisTrack>;
  syncingLyricsTrackKey?: string | null;
  onSyncTrackLyrics?: (track: Track) => void | Promise<void>;
  onTrackQuarantined?: () => void | Promise<void>;
}

function EnergyBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-px w-14 overflow-hidden rounded-full bg-primary/10">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct * 100}%`, opacity: 0.4 + pct * 0.6 }}
        />
      </div>
      <span className="w-7 text-right font-mono text-xs text-muted-foreground">
        {Math.round(pct * 100)}
      </span>
    </div>
  );
}

function PopularityBar({
  score,
  confidence,
}: {
  score: number | null | undefined;
  confidence: number | null | undefined;
}) {
  if (score == null || score <= 0) return null;
  const pct = Math.max(0, Math.min(1, score));
  const confidencePct = Math.max(0, Math.min(1, confidence ?? 0));

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex min-w-[104px] items-center gap-2">
            <div className="h-px w-14 overflow-hidden rounded-full bg-primary/10">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${pct * 100}%`,
                  opacity: 0.45 + confidencePct * 0.45,
                }}
              />
            </div>
            <span className="w-8 text-right font-mono text-xs text-muted-foreground">
              {Math.round(pct * 100)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="space-y-1 text-xs">
            <div>Popularity {Math.round(pct * 100)}%</div>
            {confidence != null ? (
              <div className="text-text-secondary">
                Confidence {Math.round(confidencePct * 100)}%
              </div>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const size = value / Math.pow(1024, index);
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${
    units[index]
  }`;
}

function variantTone(status: string): InfoBadgeTone {
  if (status === "ready" || status === "running") return "success";
  if (status === "failed") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

function variantLabel(variant: TrackStreamVariant) {
  const codec = (
    variant.delivery_codec ||
    variant.delivery_format ||
    ""
  ).toUpperCase();
  return `${codec} ${variant.delivery_bitrate}k`;
}

function TrackVariantBadges({
  variants,
}: {
  variants: TrackStreamVariant[] | undefined;
}) {
  if (!variants?.length) {
    return <span className="text-xs text-text-subtle">None</span>;
  }

  const visible = variants.slice(0, 2);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex min-w-[112px] flex-wrap gap-1">
            {visible.map((variant) => (
              <InfoBadge key={variant.id} tone={variantTone(variant.status)}>
                {variantLabel(variant)}
              </InfoBadge>
            ))}
            {variants.length > visible.length ? (
              <InfoBadge variant="counter">
                +{variants.length - visible.length}
              </InfoBadge>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="w-72">
          <div className="space-y-2 text-xs">
            <div className="font-semibold text-text-primary">
              Playback variants
            </div>
            {variants.map((variant) => (
              <div
                key={variant.id}
                className="rounded-md border border-border-quiet bg-surface-object px-2 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-text-primary">
                    {variant.preset}
                  </span>
                  <InfoBadge tone={variantTone(variant.status)}>
                    {variant.status}
                  </InfoBadge>
                </div>
                <div className="mt-1 text-text-muted">
                  {variantLabel(variant)}
                  {variant.delivery_sample_rate
                    ? ` / ${Math.round(variant.delivery_sample_rate / 1000)}kHz`
                    : ""}
                  {" - "}
                  {formatBytes(variant.bytes)}
                </div>
                {variant.task_status ? (
                  <div className="mt-1 text-text-subtle">
                    Task {variant.task_status}
                  </div>
                ) : null}
                {variant.error ? (
                  <div className="mt-1 line-clamp-2 text-state-warning-text/70">
                    {variant.error}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function normalizeLyricsStatus(lyrics: TrackLyricsStatus | undefined) {
  if (lyrics?.has_synced || lyrics?.status === "synced") return "synced";
  if (
    lyrics?.has_plain ||
    lyrics?.status === "txt" ||
    lyrics?.status === "plain"
  )
    return "txt";
  return "none";
}

function LyricsBadge({
  lyrics,
  busy = false,
  onClick,
}: {
  lyrics?: TrackLyricsStatus;
  busy?: boolean;
  onClick?: () => void;
}) {
  const status = normalizeLyricsStatus(lyrics);
  const label =
    status === "synced" ? "SYNCED" : status === "txt" ? "TXT" : "NONE";
  return (
    <div className="flex items-center gap-2">
      <InfoBadge tone={status === "none" ? "neutral" : "accent"}>
        {label}
      </InfoBadge>
      {onClick ? (
        <ActionButton
          label={busy ? "Syncing lyrics..." : "Sync lyrics for this track"}
          loading={busy}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
        >
          <AlignLeft data-admin-ux="track-sync-lyrics" aria-hidden="true" />
        </ActionButton>
      ) : null}
    </div>
  );
}

function MoveTrackDialog({
  open,
  track,
  currentAlbumId,
  defaultQuery,
  busy,
  onOpenChange,
  onMove,
}: {
  open: boolean;
  track: Track | null;
  currentAlbumId?: number;
  defaultQuery: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (targetAlbum: AlbumSearchResult) => void;
}) {
  const {
    query,
    setQuery,
    results,
    searching,
    error: searchError,
    retry: retrySearch,
  } = useLibrarySearch<AlbumSearchResult>(open, defaultQuery, "albums");

  const title = track?.tags.title || track?.filename || "this track";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            Move Track to Album
          </DialogTitle>
          <DialogDescription>
            Queue a worker task to move "{title}" into another album directory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="crate-form-field">
            <label htmlFor="move-track-target" data-slot="form-field-label">
              Target album
            </label>
            <SearchInput
              id="move-track-target"
              label="Target album"
              value={query}
              onValueChange={setQuery}
              placeholder="Search albums by title or artist"
              autoFocus
            />
          </div>

          <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border-quiet">
            {searchError ? (
              <ErrorState message={searchError} onRetry={retrySearch} />
            ) : searching ? (
              <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
                <Loader2
                  data-admin-ux="track-move-search-loading"
                  size={15}
                  className="animate-spin"
                />
                Searching albums...
              </div>
            ) : results.length ? (
              <div className="divide-y divide-border-quiet">
                {results.map((album) => {
                  const isCurrentAlbum =
                    currentAlbumId != null && album.id === currentAlbumId;
                  return (
                    <button
                      key={`${album.entity_uid || album.id}-${album.artist}-${
                        album.name
                      }`}
                      type="button"
                      disabled={busy || isCurrentAlbum || album.id == null}
                      onClick={() => onMove(album)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors  disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <MediaCover alt={album.name} size={48} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {album.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {album.artist}
                          {album.year ? ` - ${album.year}` : ""}
                        </div>
                      </div>
                      {isCurrentAlbum ? (
                        <Badge variant="secondary">Current</Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : query.trim().length >= 2 ? (
              <div className="px-4 py-5 text-sm text-muted-foreground">
                No matching albums found.
              </div>
            ) : (
              <div className="px-4 py-5 text-sm text-muted-foreground">
                Type at least 2 characters to search.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrackAudioInfo({
  track,
  title,
}: {
  track: AudioAnalysisTrack;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton label="Show audio profile" onClick={() => setOpen(true)}>
        <BarChart3 data-admin-ux="track-audio-profile" aria-hidden="true" />
      </ActionButton>
      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        title={<span className="wrap-anywhere">{title} · Audio profile</span>}
        description="Measured audio features, Smart Mix readiness and similarity references for this track."
        closeLabel="Close audio profile"
        size="3xl"
        panelClassName="max-h-[calc(100dvh-2rem)] min-w-0"
        headerClassName="shrink-0"
      >
        <ModalBody
          className="min-w-0 px-5 py-5"
          data-slot="audio-profile-scroll"
        >
          <AudioProfileCard
            analysisData={{ track }}
            totalTracks={1}
            presentation="track-dialog"
          />
        </ModalBody>
      </AppModal>
    </>
  );
}

export function TrackTable({
  tracks,
  artist,
  artistId,
  artistSlug,
  album,
  albumId,
  albumSlug,
  albumCover,
  analysisData,
  syncingLyricsTrackKey,
  onSyncTrackLyrics,
  onTrackQuarantined,
}: TrackTableProps) {
  const { hasCapability } = useAuth();
  const [similarTrack, setSimilarTrack] = useState<{
    path: string;
    title: string;
    artist: string;
  } | null>(null);
  const [pendingQuarantineTrack, setPendingQuarantineTrack] =
    useState<Track | null>(null);
  const [pendingMoveTrack, setPendingMoveTrack] = useState<Track | null>(null);
  const [quarantiningTrackKey, setQuarantiningTrackKey] = useState<
    string | null
  >(null);
  const [movingTrackKey, setMovingTrackKey] = useState<string | null>(null);
  const canQuarantineTracks = hasCapability("library.track.remove");

  function getTrackId(track: Track): string {
    if (track.id != null) return String(track.id);
    return track.path ?? `${artist}/${track.filename}`;
  }

  async function quarantineTrack(track: Track) {
    const endpoint = trackManagementApiPath(
      { id: track.id, trackEntityUid: track.entity_uid },
      "quarantine",
    );
    if (!endpoint) {
      toast.error("Track reference missing");
      return;
    }

    const trackKey = getTrackId(track);
    setQuarantiningTrackKey(trackKey);
    try {
      const { task_id } = await api<{ task_id: string }>(endpoint, "POST", {
        reason: "Manual quarantine from album view",
      });
      toast.success("Track quarantine queued");
      const task = await waitForTask(task_id, 120000);
      if (task.status === "completed") {
        toast.success("Track moved to quarantine");
        await onTrackQuarantined?.();
      } else {
        throw new Error(task.error || "Track quarantine failed");
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to quarantine track",
      );
      throw error;
    } finally {
      setQuarantiningTrackKey(null);
    }
  }

  async function moveTrack(track: Track, targetAlbum: AlbumSearchResult) {
    if (targetAlbum.id == null) {
      toast.error("Target album reference missing");
      return;
    }
    const endpoint = trackManagementApiPath(
      { id: track.id, trackEntityUid: track.entity_uid },
      "move",
    );
    if (!endpoint) {
      toast.error("Track reference missing");
      return;
    }

    const trackKey = getTrackId(track);
    setMovingTrackKey(trackKey);
    try {
      const { task_id } = await api<{ task_id: string }>(endpoint, "POST", {
        target_album_id: targetAlbum.id,
        reason: "Manual track move from album view",
      });
      toast.success("Track move queued");
      const task = await waitForTask(task_id, 120000);
      if (task.status === "completed") {
        toast.success("Track moved to target album");
        setPendingMoveTrack(null);
        await onTrackQuarantined?.();
      } else {
        toast.error(task.error || "Track move failed");
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to move track",
      );
    } finally {
      setMovingTrackKey(null);
    }
  }

  const hasAnalysis =
    analysisData &&
    tracks.some((track) => {
      return analysisForTrack(analysisData, track) != null;
    });

  return (
    <>
      <div className="crate-track-table-frame">
        <Table className="crate-track-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-right">#</TableHead>
              <TableHead>Track</TableHead>
              <TableHead className="crate-table-secondary">Format</TableHead>
              <TableHead className="crate-table-detail crate-table-number">
                Bitrate
              </TableHead>
              <TableHead className="crate-table-detail">Variants</TableHead>
              <TableHead className="crate-table-number">Duration</TableHead>
              <TableHead className="crate-table-detail">Popularity</TableHead>
              <TableHead className="crate-table-detail crate-table-number">
                Size
              </TableHead>
              {hasAnalysis ? (
                <TableHead className="crate-table-secondary crate-table-number">
                  BPM · Key
                </TableHead>
              ) : null}

              {hasAnalysis ? (
                <TableHead className="crate-table-detail">Energy</TableHead>
              ) : null}
              <TableHead className="w-[86px]">Lyrics</TableHead>
              {hasAnalysis ? <TableHead className="w-10" /> : null}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tracks.map((track, index) => {
              const trackId = getTrackId(track);
              const lyricsSyncKey = getTrackLyricsSyncKey(track);
              const analyzedTrack = analysisForTrack(analysisData, track);

              return (
                <MusicContextMenu
                  key={track.filename}
                  type="track"
                  artist={artist || track.tags.artist || ""}
                  artistId={artistId}
                  artistSlug={artistSlug}
                  album={album || track.tags.album || ""}
                  albumId={albumId}
                  albumSlug={albumSlug}
                  trackId={trackId}
                  trackTitle={track.tags.title || track.filename}
                  albumCover={albumCover}
                  onFindSimilar={
                    track.path
                      ? () =>
                          setSimilarTrack({
                            path: track.path!,
                            title: track.tags.title || track.filename,
                            artist: artist || track.tags.artist || "",
                          })
                      : undefined
                  }
                  onMoveTrack={
                    canQuarantineTracks &&
                    (track.id != null || track.entity_uid)
                      ? () => setPendingMoveTrack(track)
                      : undefined
                  }
                  onQuarantineTrack={
                    canQuarantineTracks &&
                    (track.id != null || track.entity_uid)
                      ? () => setPendingQuarantineTrack(track)
                      : undefined
                  }
                >
                  <TableRow
                    aria-busy={
                      quarantiningTrackKey === trackId ||
                      movingTrackKey === trackId
                        ? "true"
                        : undefined
                    }
                    className={
                      quarantiningTrackKey === trackId ||
                      movingTrackKey === trackId
                        ? "opacity-55"
                        : undefined
                    }
                  >
                    <TableCell className="text-right font-mono text-xs tabular-nums text-text-subtle">
                      {track.tags.tracknumber || index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text-primary">
                          {track.tags.title || track.filename}
                        </div>
                        {track.tags.artist && artist !== track.tags.artist ? (
                          <div className="truncate text-xs text-text-muted">
                            {track.tags.artist}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="crate-table-secondary">
                      <span className="crate-track-quality">
                        {formatTrackQuality(
                          track.format,
                          track.bit_depth,
                          track.sample_rate,
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="crate-table-detail font-mono text-xs tabular-nums text-text-muted">
                      {formatBitrate(track.bitrate)}
                    </TableCell>
                    <TableCell className="crate-table-detail">
                      <TrackVariantBadges variants={track.stream_variants} />
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-text-muted">
                      {formatDuration(track.length_sec)}
                    </TableCell>
                    <TableCell className="crate-table-detail">
                      <PopularityBar
                        score={
                          track.popularity_score ??
                          ((track.popularity ?? 0) > 0
                            ? (track.popularity ?? 0) / 100
                            : null)
                        }
                        confidence={track.popularity_confidence}
                      />
                    </TableCell>
                    <TableCell className="crate-table-detail font-mono text-xs tabular-nums text-text-muted">
                      {track.size_mb} MB
                    </TableCell>
                    {hasAnalysis ? (
                      <TableCell className="crate-table-secondary crate-table-number">
                        <span className="crate-track-analysis">
                          {formatTrackAnalysis(
                            analyzedTrack?.smart_mix?.bpm ??
                              analyzedTrack?.tempo,
                            analyzedTrack?.smart_mix?.key ?? analyzedTrack?.key,
                            analyzedTrack?.smart_mix?.scale ??
                              analyzedTrack?.scale,
                          ) ?? "—"}
                        </span>
                      </TableCell>
                    ) : null}
                    {hasAnalysis ? (
                      <TableCell className="crate-table-detail">
                        {analyzedTrack?.energy != null ? (
                          <EnergyBar value={analyzedTrack.energy} />
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <LyricsBadge
                        lyrics={track.lyrics}
                        busy={syncingLyricsTrackKey === lyricsSyncKey}
                        onClick={
                          onSyncTrackLyrics
                            ? () => void onSyncTrackLyrics(track)
                            : undefined
                        }
                      />
                    </TableCell>
                    {hasAnalysis ? (
                      <TableCell>
                        {analyzedTrack ? (
                          <TrackAudioInfo
                            track={analyzedTrack}
                            title={track.tags.title || track.filename}
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      {track.entity_uid || track.id || track.path ? (
                        <ActionLink
                          label="Download track"
                          href={
                            trackDownloadApiPath({
                              entityUid: track.entity_uid,
                              id: track.id,
                              path: track.path,
                            }) || undefined
                          }
                          download
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Download
                            data-admin-ux="track-download"
                            aria-hidden="true"
                          />
                        </ActionLink>
                      ) : null}
                    </TableCell>
                  </TableRow>
                </MusicContextMenu>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {similarTrack ? (
        <SimilarTracksPanel
          trackPath={similarTrack.path}
          trackTitle={similarTrack.title}
          artist={similarTrack.artist}
          open={!!similarTrack}
          onClose={() => setSimilarTrack(null)}
        />
      ) : null}

      <ConfirmDialog
        open={pendingQuarantineTrack !== null}
        onOpenChange={(open) => !open && setPendingQuarantineTrack(null)}
        title="Quarantine Track"
        description={`Move "${
          pendingQuarantineTrack?.tags.title ||
          pendingQuarantineTrack?.filename ||
          "this track"
        }" to .crate-trash and remove it from this album? This is reversible from the filesystem.`}
        confirmLabel="Quarantine Track"
        variant="destructive"
        onConfirm={async () => {
          if (pendingQuarantineTrack)
            await quarantineTrack(pendingQuarantineTrack);
        }}
        onError={() => {}}
        eyebrow="Confirm action"
        consequence={`1 track · ${
          pendingQuarantineTrack?.size_mb ?? "—"
        } MB · moves to .crate-trash`}
      />

      <MoveTrackDialog
        open={pendingMoveTrack !== null}
        track={pendingMoveTrack}
        currentAlbumId={albumId}
        defaultQuery={album || ""}
        busy={movingTrackKey !== null}
        onOpenChange={(open) => !open && setPendingMoveTrack(null)}
        onMove={(targetAlbum) =>
          pendingMoveTrack && void moveTrack(pendingMoveTrack, targetAlbum)
        }
      />
    </>
  );
}
