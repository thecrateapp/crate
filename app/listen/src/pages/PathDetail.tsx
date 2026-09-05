import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Play,
  RefreshCw,
  Trash2,
} from "@crate/ui/icons";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { CrateImage } from "@/components/artwork/CrateImage";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

interface PathEndpoint {
  type: string;
  value: string;
  label: string;
}

interface PathTrack {
  step: number;
  progress: number;
  track_id: number;
  entity_uid?: string;
  title: string;
  artist: string;
  artist_entity_uid?: string;
  album?: string;
  album_id?: number;
  album_entity_uid?: string;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  distance: number;
}

interface PathData {
  id: number;
  name: string;
  origin: PathEndpoint;
  destination: PathEndpoint;
  waypoints: PathEndpoint[];
  step_count: number;
  tracks: PathTrack[];
  created_at: string;
}

function mapToPlayerTrack(t: PathTrack): Track {
  return toPlayableTrack(t, {
    cover:
      t.album_id || t.album_entity_uid
        ? albumCoverApiUrl(
            {
              albumId: t.album_id,
              albumEntityUid: t.album_entity_uid,
              artistEntityUid: t.artist_entity_uid,
            },
            { size: 512 },
          )
        : undefined,
  });
}

export function PathDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: path, loading, refetch } = useApi<PathData>(`/api/paths/${id}`);
  const { playAll, currentTrack } = usePlayerActions();
  const [regenerating, setRegenerating] = useState(false);
  const [animate, setAnimate] = useState(true);
  const activeTrackRef = useRef<HTMLDivElement>(null);

  const activeStep =
    path?.tracks.findIndex(
      (t) => currentTrack?.libraryTrackId === t.track_id,
    ) ?? -1;

  const playFromStep = useCallback(
    (startIndex: number) => {
      if (!path) return;
      playAll(path.tracks.map(mapToPlayerTrack), startIndex, {
        type: "playlist",
        name: path.name,
        id: path.id,
      });
    },
    [path, playAll],
  );

  const regenerate = async () => {
    if (!path || regenerating) return;
    setRegenerating(true);
    try {
      await api(`/api/paths/${path.id}/regenerate`, "POST");
      toast.success(t("paths.toasts.regenerated"));
      refetch();
    } catch {
      toast.error(t("paths.toasts.regenerateFailed"));
    } finally {
      setRegenerating(false);
    }
  };

  useEffect(() => {
    activeTrackRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [activeStep]);

  useEffect(() => {
    setAnimate(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
  }, []);

  if (loading || !path) {
    return <CrateLoader label={t("paths.loadingDetail")} />;
  }

  const nodeCount = path.tracks.length;
  const travelerPos = activeStep >= 0 ? activeStep : 0;

  return (
    <div className="animate-page-in px-4 py-6 sm:px-6">
      <button
        onClick={() => navigate("/paths")}
        className="mb-5 flex items-center gap-1.5 text-sm text-text-primary/40 transition hover:text-text-primary"
      >
        <ArrowLeft size={14} /> {t("paths.back")}
      </button>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{path.name}</h1>
          <div className="mt-1.5 flex items-center gap-2 text-[12px] text-text-primary/40">
            <span className="font-medium text-accent-action/70">
              {path.origin.label}
            </span>
            <span className="text-text-primary/15">→</span>
            <span className="font-medium text-accent-action/70">
              {path.destination.label}
            </span>
            <span className="text-text-primary/15">·</span>
            <span>
              {t("common.trackCountLabel", { count: path.tracks.length })}
            </span>
          </div>
        </div>
        <button
          onClick={() => playFromStep(0)}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-accent-action text-accent-action-foreground shadow-accent-action-strong transition hover:bg-accent-action/90"
        >
          <Play size={18} className="ml-0.5 fill-current" />
        </button>
      </div>

      {/* Route visualization */}
      <div className="mb-6 rounded-xl border border-text-primary/8 bg-surface-canvas/20 p-4">
        <div className="mb-2 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.14em]">
          <span className="flex items-center gap-1 text-accent-action/60">
            <MapPin size={9} /> {path.origin.label}
          </span>
          <span className="flex items-center gap-1 text-accent-action/60">
            {path.destination.label} <MapPin size={9} />
          </span>
        </div>

        <div className="relative py-5">
          <div className="relative mx-3">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-text-primary/8" />
            <div
              className={`path-progress-fill absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full ${
                animate ? "transition-[width] duration-[1200ms] ease-out" : ""
              }`}
              style={{
                width: `${(travelerPos / Math.max(1, nodeCount - 1)) * 100}%`,
              }}
            />
            <div className="relative flex items-center justify-between">
              {path.tracks.map((t, i) => {
                const isPast = i <= travelerPos;
                const isActive = i === activeStep;
                return (
                  <button
                    key={t.step}
                    onClick={() => playFromStep(i)}
                    title={`${t.title} — ${t.artist}`}
                    className="group relative flex h-4 w-4 flex-shrink-0 items-center justify-center"
                  >
                    <div
                      className={`rounded-full transition-all duration-300 ${
                        isActive
                          ? "path-node-active h-3 w-3 bg-accent-action"
                          : isPast
                            ? "h-1.5 w-1.5 bg-accent-action/60"
                            : "h-1.5 w-1.5 bg-text-primary/20 group-hover:bg-text-primary/40"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            <div
              className={`pointer-events-none absolute top-1/2 ${
                animate ? "transition-[left] duration-[1200ms] ease-out" : ""
              }`}
              style={{
                left: `${(travelerPos / Math.max(1, nodeCount - 1)) * 100}%`,
              }}
            >
              <div className="absolute -inset-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action/20 blur-md" />
              <div className="path-traveler-node h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action" />
            </div>
          </div>
        </div>

        {/* Now playing card */}
        {activeStep >= 0 && path.tracks[activeStep] && (
          <div className="rounded-xl border border-accent-action/20 bg-accent-action/5 p-3">
            <div className="flex items-center gap-3">
              {path.tracks[activeStep]!.album_id && (
                <CrateImage
                  src={albumCoverApiUrl(
                    {
                      albumId: path.tracks[activeStep]!.album_id!,
                      albumEntityUid: path.tracks[activeStep]!.album_entity_uid,
                      artistEntityUid:
                        path.tracks[activeStep]!.artist_entity_uid,
                    },
                    { size: 80 },
                  )}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded-lg bg-text-primary/5 object-cover shadow-md"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary">
                  {path.tracks[activeStep]!.title}
                </div>
                <div className="truncate text-[11px] text-text-primary/50">
                  {path.tracks[activeStep]!.artist}
                  {path.tracks[activeStep]!.album && (
                    <> · {path.tracks[activeStep]!.album}</>
                  )}
                </div>
              </div>
              <span className="font-mono text-[10px] tabular-nums text-accent-action/70">
                {activeStep + 1}/{nodeCount}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={regenerate}
          disabled={regenerating}
          className="flex items-center gap-1.5 rounded-full border border-border-quiet bg-text-primary/5 px-3 py-1.5 text-[11px] font-medium text-text-primary/60 transition hover:border-text-primary/20 hover:text-text-primary disabled:opacity-30"
        >
          {regenerating ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          {t("paths.regenerate")}
        </button>
        <button
          onClick={async () => {
            await api(`/api/paths/${path.id}`, "DELETE");
            toast.success(t("paths.toasts.deleted"));
            navigate("/paths");
          }}
          className="flex items-center gap-1.5 rounded-full border border-border-quiet bg-text-primary/5 px-3 py-1.5 text-[11px] font-medium text-text-primary/60 transition hover:border-state-danger/30 hover:text-state-danger-text"
        >
          <Trash2 size={11} /> {t("common.delete")}
        </button>
      </div>

      {/* Track list with covers */}
      <div className="space-y-1">
        {path.tracks.map((t, i) => {
          const isActive = i === activeStep;
          return (
            <div
              key={t.step}
              ref={isActive ? activeTrackRef : null}
              role="button"
              tabIndex={0}
              onClick={() => playFromStep(i)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  playFromStep(i);
                }
              }}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                isActive
                  ? "border-accent-action/30 bg-accent-action/10"
                  : "border-transparent hover:bg-text-primary/[0.03]"
              }`}
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center">
                {isActive ? (
                  <div className="path-node-active h-2.5 w-2.5 rounded-full bg-accent-action" />
                ) : (
                  <span className="font-mono text-[10px] tabular-nums text-text-primary/20">
                    {i + 1}
                  </span>
                )}
              </div>

              {t.album_id ? (
                <CrateImage
                  src={albumCoverApiUrl(
                    {
                      albumId: t.album_id,
                      albumEntityUid: t.album_entity_uid,
                      artistEntityUid: t.artist_entity_uid,
                    },
                    { size: 80 },
                  )}
                  alt=""
                  className="h-10 w-10 flex-shrink-0 rounded-md bg-text-primary/5 object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-text-primary/5">
                  <MapPin size={14} className="text-text-primary/15" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm ${
                    isActive
                      ? "font-semibold text-accent-action"
                      : "text-text-primary"
                  }`}
                >
                  {t.title}
                </div>
                <div className="truncate text-[11px] text-text-primary/40">
                  {t.artist}
                  {t.album && <> · {t.album}</>}
                </div>
              </div>

              <span className="flex-shrink-0 rounded-full border border-text-primary/6 bg-text-primary/[0.02] px-2 py-0.5 font-mono text-[9px] tabular-nums text-text-primary/25">
                {t.distance.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
