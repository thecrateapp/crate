import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { MobileActionSheet } from "@/components/actions/ItemActionMenu";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { CrateImage } from "@/components/artwork/CrateImage";
import { JamQueueLockedNotice } from "@/components/player/JamQueueLockedNotice";
import { QueueTrackRow } from "@/components/player/QueueTrackRow";

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const { isPlaying } = usePlayerState();
  const {
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
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-quiet px-4 py-3">
        <h2 className="text-sm font-bold text-text-primary">
          {t("player.queue")}
        </h2>
        <button
          onClick={onClose}
          aria-label={t("player.queue.close")}
          className="flex size-10 items-center justify-center text-text-muted transition-colors hover:text-text-primary"
        >
          <X size={CRATE_ICON_SIZE.xl} />
        </button>
      </div>

      {jamQueueLocked ? <JamQueueLockedNotice /> : null}

      {/* Now Playing */}
      {currentTrack && (
        <div className="border-b border-border-quiet px-4 py-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">
            {t("player.queue.nowPlaying")}
          </p>
          <div className="flex items-center gap-3">
            {currentTrack.albumCover ? (
              <CrateImage
                src={currentTrack.albumCover}
                alt=""
                className="size-10  rounded object-cover shrink-0"
              />
            ) : (
              <div className=" size-10 shrink-0 rounded bg-surface-control-hover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-medium text-accent-action">
                {currentTrack.title}
              </p>
              <p className="truncate text-xs text-text-muted">
                {currentTrack.artist}
              </p>
            </div>
            {isPlaying && (
              <div className="flex gap-0.5 items-end h-4">
                <div
                  className="equalizer-bar w-[3px] rounded-sm bg-accent-action"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="equalizer-bar w-[3px] rounded-sm bg-accent-action"
                  style={{ animationDelay: "200ms" }}
                />
                <div
                  className="equalizer-bar w-[3px] rounded-sm bg-accent-action"
                  style={{ animationDelay: "400ms" }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div className="flex-1 overflow-y-auto">
        {upcoming.length > 0 && (
          <div className="px-4 pt-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">
              {t("player.queue.nextUp", { count: upcoming.length })}
            </p>
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
          <div className="px-4 py-8 text-center text-sm text-text-faint">
            {t("player.queue.empty")}
          </div>
        )}

        {/* Previously played */}
        {played.length > 0 && (
          <>
            <div className="px-4 pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-faint">
                {t("player.queue.previous")}
              </p>
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

  return (
    <div className="listen-glass-panel listen-glass-panel--dock z-app-player-drawer fixed right-0 top-0 bottom-[72px] flex w-[360px] animate-in slide-in-from-right flex-col border-l border-border-quiet">
      {content}
    </div>
  );
}
