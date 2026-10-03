import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { TrackRow } from "@/components/cards/TrackRow";
import type { Track } from "@/contexts/PlayerContext";
import { triggerHaptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

export const QueueTrackRow = memo(function QueueTrackRow({
  track,
  queueIndex,
  position,
  onJump,
  onRemove,
  faded = false,
  locked = false,
  haptic = false,
  isCurrent = false,
}: {
  track: Track;
  queueIndex: number;
  position?: number;
  onJump: (index: number) => void;
  onRemove?: (index: number) => void;
  faded?: boolean;
  locked?: boolean;
  haptic?: boolean;
  isCurrent?: boolean;
}) {
  const { t } = useTranslation();
  const rowTrack = useMemo(() => trackToMenuData(track), [track]);
  const handleJump = useCallback(() => {
    if (haptic) triggerHaptic("selection");
    onJump(queueIndex);
  }, [haptic, onJump, queueIndex]);
  const extraActions = useMemo<ItemActionMenuEntry[] | undefined>(
    () =>
      onRemove
        ? [
            {
              key: "queue-remove",
              label: t("player.queue.remove"),
              icon: X,
              danger: true,
              onSelect: () => onRemove(queueIndex),
            },
          ]
        : undefined,
    [onRemove, queueIndex, t],
  );

  return (
    <div
      data-testid="queue-track-row"
      inert={locked}
      className={cn(
        locked && "cursor-not-allowed opacity-55 grayscale",
        faded && !locked && "opacity-50",
      )}
    >
      <TrackRow
        track={rowTrack}
        albumCover={track.albumCover}
        rank={position}
        density="compact"
        showCoverThumb
        showArtist
        showLike={false}
        showDuration={false}
        onPlayOverride={handleJump}
        isActiveOverride={isCurrent}
        extraActions={extraActions}
        meta={
          track.isSuggested ? (
            <span className="rounded-full border border-accent-action/20 bg-accent-action/10 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-accent-action">
              {t("player.queue.suggested")}
            </span>
          ) : undefined
        }
      />
    </div>
  );
});
