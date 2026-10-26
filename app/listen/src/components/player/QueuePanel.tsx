import { memo } from "react";
import { useTranslation } from "react-i18next";

import { MobileActionSheet } from "@/components/actions/ItemActionMenu";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { PlayerQueueHeader } from "./PlayerQueueHeader";
import { PlayerQueueFrame } from "./PlayerQueueFrame";
import { getPlaySourceLabel } from "./player-source";
import { formatPlayerTime } from "./bar/player-bar-utils";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { JamQueueLockedNotice } from "@/components/player/JamQueueLockedNotice";
import { QueueTrackRow } from "@/components/player/QueueTrackRow";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

export const QueuePanel = memo(function QueuePanel({
  open,
  onClose,
}: QueuePanelProps) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const {
    playSource,
    queue,
    currentIndex,
    jumpTo,
    removeFromQueue,
    currentTrack,
    jamQueueLocked,
  } = usePlayerActions();

  if (!open) return null;

  const upcoming = queue.slice(currentIndex + 1);
  const played = queue
    .slice(0, currentIndex)
    .map((track, queueIndex) => ({ track, queueIndex }))
    .reverse();

  const content = (
    <>
      <PlayerQueueHeader
        title={t("player.queue")}
        closeLabel={t("player.queue.close")}
        onClose={onClose}
        summary={`${t("common.trackCount", { count: queue.length })} · ${formatPlayerTime(queue.reduce((sum, track) => sum + (Number.isFinite(track.duration) && track.duration! > 0 ? track.duration! : 0), 0))}`}
        source={getPlaySourceLabel(playSource)}
      />

      {jamQueueLocked ? <JamQueueLockedNotice /> : null}

      {/* Now Playing */}
      {currentTrack && (
        <div className="border-b border-border-quiet px-4 py-3">
          <MonoLabel as="p" className="mb-2">
            {t("player.queue.nowPlaying")}
          </MonoLabel>
          <QueueTrackRow
            track={currentTrack}
            queueIndex={currentIndex}
            onJump={jumpTo}
            isCurrent
            locked={jamQueueLocked}
          />
        </div>
      )}

      {/* Upcoming */}
      <div className="flex-1 overflow-y-auto overscroll-contain pb-2">
        {upcoming.length > 0 && (
          <div className="px-4 pt-3">
            <MonoLabel as="p" className="mb-2">
              {t("player.queue.nextUp", { count: upcoming.length })}
            </MonoLabel>
          </div>
        )}
        <div className="px-2">
          {upcoming.map((track, i) => {
            const idx = currentIndex + 1 + i;
            return (
              <QueueTrackRow
                key={`${track.id}-${idx}`}
                track={track}
                queueIndex={idx}
                position={i + 1}
                onJump={jumpTo}
                onRemove={jamQueueLocked ? undefined : removeFromQueue}
                locked={jamQueueLocked}
              />
            );
          })}
        </div>

        {upcoming.length === 0 && (
          <EmptyState title={t("player.queue.empty")} />
        )}

        {/* Previously played */}
        {played.length > 0 && (
          <>
            <div className="px-4 pt-4">
              <MonoLabel as="p" className="mb-2">
                {t("player.queue.previous")}
              </MonoLabel>
            </div>
            <div className="px-2">
              {played.map(({ track, queueIndex }) => (
                <QueueTrackRow
                  key={`${track.id}-prev-${queueIndex}`}
                  track={track}
                  queueIndex={queueIndex}
                  position={queueIndex + 1}
                  onJump={jumpTo}
                  faded
                  locked={jamQueueLocked}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );

  if (!isDesktop) {
    return (
      <MobileActionSheet open={open} onClose={onClose}>
        <div className="flex max-h-[inherit] flex-col pb-3">{content}</div>
      </MobileActionSheet>
    );
  }

  return <PlayerQueueFrame>{content}</PlayerQueueFrame>;
});
