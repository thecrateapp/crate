import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Plus } from "@crate/ui/icons";
import { toast } from "sonner";

import { CrateCard } from "@/components/CrateCard";
import { CrateEditor } from "@/components/CrateEditor";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import type { CratePlaybackTrack, CrateSummary } from "@/pages/crates-types";

export function Crates() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll, setRepeatMode } = usePlayerActions();
  const {
    data: crates,
    loading,
    error,
    refetch,
  } = useApi<CrateSummary[]>("/api/me/crates");
  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function playCrate(crate: CrateSummary) {
    try {
      const playback = await api<CratePlaybackTrack[]>(
        `/api/crates/${crate.id}/playback`,
      );
      const tracks: Track[] = playback.map((track) =>
        toPlayableTrack(
          {
            id: track.local_track_id ?? track.global_track_uid,
            globalTrackUid: track.global_track_uid,
            globalAlbumUid: track.global_album_uid,
            globalArtistUid: track.global_artist_uid,
            entity_uid: track.local_track_entity_uid,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            libraryTrackId: track.local_track_id,
          },
          {
            cover: albumCoverApiUrl(
              {
                globalAlbumUid: track.global_album_uid,
                albumName: track.album,
                artistName: track.artist,
              },
              { size: 512 },
            ),
          },
        ),
      );
      if (tracks.length === 0) return;
      setRepeatMode(crate.loop_enabled ? "all" : "off");
      playAll(tracks, 0, {
        type: "crate",
        name: crate.name,
        id: crate.id,
        href: `/crate/${crate.id}`,
      });
    } catch {
      toast.error(t("library.crates.playFailed"));
    }
  }

  if (selectedCrateId || creating) {
    return (
      <CrateEditor
        crateId={selectedCrateId}
        onBack={() => {
          setSelectedCrateId(null);
          setCreating(false);
        }}
        onCreated={(crateId) => {
          setCreating(false);
          setSelectedCrateId(crateId);
          refetch();
        }}
        onDeleted={() => {
          setSelectedCrateId(null);
          refetch();
        }}
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="hidden text-lg font-semibold text-text-primary md:block">
          {t("library.crates.title")}
        </h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-accent-action px-4 py-2.5 text-sm font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90"
        >
          <Plus size={17} />
          {t("library.crates.new")}
        </button>
      </div>

      {loading && !crates ? (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-accent-action" />
        </div>
      ) : error ? (
        <p role="alert" className="py-10 text-center text-sm text-state-danger">
          {t("library.crates.loadFailed")}
        </p>
      ) : crates?.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {crates.map((crate) => (
            <CrateCard
              key={crate.id}
              crate={crate}
              onOpen={() => navigate(`/crate/${crate.id}`)}
              onEdit={() => setSelectedCrateId(crate.id)}
              onPlay={() => void playCrate(crate)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border-quiet px-5 py-12 text-center">
          <h3 className="text-base font-semibold text-text-primary">
            {t("library.crates.emptyTitle")}
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">
            {t("library.crates.emptyDescription")}
          </p>
        </div>
      )}
    </section>
  );
}
