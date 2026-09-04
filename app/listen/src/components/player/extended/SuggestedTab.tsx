import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Star } from "@crate/ui/icons";
import { toast } from "sonner";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import {
  hasPlayableTrackReference,
  toPlayableTrack,
} from "@/lib/playable-track";
import { fetchTrackRadio } from "@/lib/radio";
import { formatDuration } from "@/lib/utils";

interface SimilarTrack {
  path: string;
  track_entity_uid?: string;
  track_id?: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  score: number;
}

export function SuggestedTab() {
  const { t } = useTranslation();
  const { currentTrack, play, playAll } = usePlayerActions();
  const [tracks, setTracks] = useState<SimilarTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingRadio, setStartingRadio] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "15" });
    setLoading(true);
    setTracks([]);

    if (currentTrack.libraryTrackId != null) {
      params.set("track_id", String(currentTrack.libraryTrackId));
    } else if (currentTrack.path) {
      params.set("path", currentTrack.path);
    } else {
      setTracks([]);
      setLoading(false);
      return;
    }

    api<{ tracks: SimilarTrack[] }>(
      `/api/similar-tracks?${params.toString()}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((data) => setTracks(data.tracks || []))
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === "AbortError")
          return;
        setTracks([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [currentTrack?.id, currentTrack?.libraryTrackId, currentTrack?.path]);

  async function handleStartTrackRadio() {
    if (!currentTrack) return;
    try {
      setStartingRadio(true);
      const radio = await fetchTrackRadio({
        libraryTrackId: currentTrack.libraryTrackId ?? null,
        entityUid: currentTrack.entityUid ?? null,
        path: currentTrack.path ?? null,
        title: currentTrack.title,
      });
      if (!radio.tracks.length) {
        toast.info(t("actions.track.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("actions.track.toasts.radioFailed"));
    } finally {
      setStartingRadio(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-accent-action" />
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-primary/20">
        {t("player.suggested.empty")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      <div className="mb-3 px-1">
        <button
          onClick={handleStartTrackRadio}
          disabled={
            startingRadio ||
            !currentTrack ||
            !hasPlayableTrackReference(currentTrack)
          }
          className="inline-flex items-center gap-2 rounded-full border border-border-quiet bg-text-primary/5 px-3 py-1.5 text-[11px] font-medium text-text-primary/80 transition hover:bg-text-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {startingRadio ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Star size={12} />
          )}
          {t("actions.track.radio")}
        </button>
      </div>
      {tracks.map((track, index) => (
        <button
          key={`${track.path}-${index}`}
          onClick={() =>
            play(
              toPlayableTrack({
                ...track,
                id: track.track_id ?? track.path,
                library_track_id: track.track_id,
              }),
              {
                type: "radio",
                name: t("player.suggested.playSource", {
                  title: currentTrack?.title ?? "",
                }),
              },
            )
          }
          className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-text-primary/5"
        >
          <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-text-primary/20">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-text-primary/80">
              {track.title}
            </p>
            <p className="truncate text-[10px] text-text-primary/40">
              {track.artist} — {track.album}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] tabular-nums text-text-primary/40">
              {formatDuration(track.duration)}
            </span>
            <div className="h-1 w-12 overflow-hidden rounded-full bg-text-primary/5">
              <div
                className="h-full rounded-full bg-accent-action/60"
                style={{ width: `${Math.min(track.score * 100, 100)}%` }}
              />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
