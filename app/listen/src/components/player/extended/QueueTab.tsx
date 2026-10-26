import { memo } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { JamQueueLockedNotice } from "@/components/player/JamQueueLockedNotice";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { getPlaySourceLabel } from "@/components/player/player-source";

import { QueueTabCurrentTrack } from "./QueueTabCurrentTrack";
import { QueueTabPastTracks } from "./QueueTabPastTracks";
import { QueueTabUpcoming } from "./QueueTabUpcoming";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";

export const QueueTab = memo(function QueueTab() {
  const { t } = useTranslation();
  const {
    queue,
    currentIndex,
    playSource,
    currentTrack,
    jumpTo,
    removeFromQueue,
    jamQueueLocked,
  } = usePlayerActions();

  const history = queue.slice(0, currentIndex).reverse();
  const upcoming = queue.slice(currentIndex + 1);

  async function handleSaveAsPlaylist() {
    const validTracks = queue.filter(
      (track) => track.path && track.path.includes("/"),
    );
    if (!validTracks.length) {
      notify.error(t("player.queue.toasts.noLocalTracks"));
      return;
    }
    try {
      await api("/api/playlists", "POST", {
        name: getPlaySourceLabel(playSource) || t("player.queue"),
        tracks: validTracks.map((track) => ({
          path: track.path,
          title: track.title,
          artist: track.artist,
          album: track.album || "",
        })),
      });
      notify.success(
        t("player.queue.toasts.saved", { count: validTracks.length }),
      );
    } catch {
      notify.error(t("player.queue.toasts.saveFailed"));
    }
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain pr-1">
      {jamQueueLocked ? <JamQueueLockedNotice /> : null}
      {currentTrack ? (
        <QueueTabCurrentTrack
          currentTrack={currentTrack}
          currentIndex={currentIndex}
          onJump={jumpTo}
          locked={jamQueueLocked}
          onSave={() => void handleSaveAsPlaylist()}
        />
      ) : null}
      <QueueTabUpcoming
        tracks={upcoming}
        currentIndex={currentIndex}
        locked={jamQueueLocked}
        onJump={jumpTo}
        onRemove={removeFromQueue}
      />
      {upcoming.length === 0 && !currentTrack ? (
        <EmptyState title={t("player.queue.empty")} />
      ) : null}
      <QueueTabPastTracks
        tracks={history}
        currentIndex={currentIndex}
        onJump={jumpTo}
        locked={jamQueueLocked}
      />
    </div>
  );
});
