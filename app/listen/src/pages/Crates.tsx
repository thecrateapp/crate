import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Loader2, Plus } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { EmptyState } from "@crate/ui/domain/states";
import { notify } from "@crate/ui/lib/notify";

import { CrateCard } from "@/components/CrateCard";
import { CrateCreateModal } from "@/components/CrateCreateModal";
import { CrateEditor } from "@/components/CrateEditor";
import { useCrateDownload } from "@/components/crates/crate-download";
import { cratePagePath } from "@/components/crates/crate-model";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useOffline } from "@/contexts/OfflineContext";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { startShapedRadio } from "@/lib/radio";
import { getOfflineActionLabelKey, isOfflineBusy } from "@/lib/offline";
import { shuffleArray } from "@/lib/utils";
import { toPlayableTrack } from "@/lib/playable-track";
import type { CratePlaybackTrack, CrateSummary } from "@/pages/crates-types";

interface CratesProps {
  onCrateChange?: () => void | Promise<void>;
}

export function Crates({ onCrateChange }: CratesProps) {
  const { t } = useTranslation();
  const { playAll, setRepeatMode } = usePlayerActions();
  const {
    supported: offlineSupported,
    getCrateState,
    toggleCrateOffline: toggleCrateOfflineState,
  } = useOffline();
  const {
    data: crates,
    loading,
    error,
    refetch,
  } = useApi<CrateSummary[]>("/api/me/crates");
  const { data: followedCrates, loading: followedLoading } = useApi<
    CrateSummary[]
  >("/api/me/crates/followed");
  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const downloadCrate = useCrateDownload();

  async function loadCrateTracks(crate: CrateSummary): Promise<Track[]> {
    const playback = await api<CratePlaybackTrack[]>(
      `/api/crates/${crate.id}/playback`,
    );
    return playback.map((track) =>
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
  }

  function startCratePlayback(crate: CrateSummary, tracks: Track[]) {
    if (tracks.length === 0) return;
    setRepeatMode(crate.loop_enabled ? "all" : "off");
    playAll(tracks, 0, {
      type: "crate",
      name: crate.name,
      id: crate.id,
      href: cratePagePath(crate),
    });
  }

  async function playCrate(crate: CrateSummary, shuffle = false) {
    try {
      const tracks = await loadCrateTracks(crate);
      startCratePlayback(crate, shuffle ? shuffleArray(tracks) : tracks);
    } catch {
      notify.error(t("library.crates.playFailed"));
    }
  }

  async function startCrateRadio(crate: CrateSummary) {
    try {
      const radio = await startShapedRadio("seeded", "crate", crate.id);
      if (!radio?.tracks.length) {
        notify.info(t("actions.crate.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      notify.error(t("actions.crate.toasts.radioFailed"));
    }
  }

  async function toggleCrateOffline(crate: CrateSummary) {
    try {
      const result = await toggleCrateOfflineState({
        crateId: crate.id,
        title: crate.name,
      });
      notify.success(
        result === "removed"
          ? t("actions.offline.toasts.removed")
          : t("actions.crate.toasts.offlineReady"),
      );
    } catch (error) {
      notify.error(
        error instanceof Error
          ? error.message
          : t("actions.offline.toasts.updateFailed"),
      );
    }
  }

  function renderCrateCard(crate: CrateSummary, editable: boolean) {
    const offlineState = getCrateState(crate.id);
    return (
      <CrateCard
        key={crate.id}
        crate={crate}
        layout="grid"
        onEdit={editable ? () => setSelectedCrateId(crate.id) : undefined}
        onPlay={() => void playCrate(crate)}
        onShuffle={() => void playCrate(crate, true)}
        onStartRadio={() => void startCrateRadio(crate)}
        onMakeAvailableOffline={
          offlineSupported ? () => void toggleCrateOffline(crate) : undefined
        }
        onDownload={() => void downloadCrate(crate)}
        offlineActionLabel={t(getOfflineActionLabelKey(offlineState))}
        offlineActionDisabled={isOfflineBusy(offlineState)}
        offlineActionActive={offlineState === "ready"}
      />
    );
  }

  return (
    <>
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="hidden text-lg font-semibold text-text-primary md:block">
            {t("library.crates.title")}
          </h2>
          <Button
            type="button"
            size="lg"
            onClick={() => setCreating(true)}
            className="shrink-0"
          >
            <Plus size={CRATE_ICON_SIZE.md} />
            {t("library.crates.new")}
          </Button>
        </div>

        {loading && !crates ? (
          <div className="flex justify-center py-12">
            <Loader2
              size={CRATE_ICON_SIZE.xl}
              className="animate-spin text-accent-action"
            />
          </div>
        ) : error ? (
          <p
            role="alert"
            className="py-10 text-center text-sm text-state-danger"
          >
            {t("library.crates.loadFailed")}
          </p>
        ) : crates?.length ? (
          <div
            data-testid="crate-grid"
            className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6"
          >
            {crates.map((crate) => renderCrateCard(crate, true))}
          </div>
        ) : (
          <EmptyState
            variant="dashed"
            title={t("library.crates.emptyTitle")}
            description={t("library.crates.emptyDescription")}
          />
        )}
      </section>
      <section
        aria-labelledby="followed-crates-title"
        className="mt-10 space-y-4"
      >
        <h2
          id="followed-crates-title"
          className="text-lg font-semibold text-text-primary"
        >
          {t("library.crates.followedTitle")}
        </h2>
        {followedLoading && !followedCrates ? (
          <div className="flex justify-center py-8">
            <Loader2
              size={CRATE_ICON_SIZE.lg}
              className="animate-spin text-accent-action"
            />
          </div>
        ) : followedCrates?.length ? (
          <div
            data-testid="followed-crate-grid"
            className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6"
          >
            {followedCrates.map((crate) => renderCrateCard(crate, false))}
          </div>
        ) : (
          <EmptyState
            variant="dashed"
            message={t("library.crates.followedEmpty")}
          />
        )}
      </section>
      <CrateCreateModal
        key={creating ? "open" : "closed"}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          setSelectedCrateId(created.id);
          refetch();
          void onCrateChange?.();
        }}
      />
      {selectedCrateId ? (
        <CrateEditor
          crateId={selectedCrateId}
          onBack={() => setSelectedCrateId(null)}
          onDeleted={() => {
            setSelectedCrateId(null);
            refetch();
            void onCrateChange?.();
          }}
        />
      ) : null}
    </>
  );
}
