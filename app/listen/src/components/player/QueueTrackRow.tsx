import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X, Sparkles } from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import { toTrackRowData } from "@/lib/track-row-data";
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
  const rowTrack = useMemo(() => toTrackRowData(track), [track]);
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

  const meta = useMemo(
    () =>
      track.isSuggested ? (
        <InfoBadge icon={Sparkles}>{t("player.queue.suggested")}</InfoBadge>
      ) : undefined,
    [track.isSuggested, t],
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
        onPlayOverride={handleJump}
        isActiveOverride={isCurrent}
        extraActions={extraActions}
        meta={meta}
      />
    </div>
  );
});
