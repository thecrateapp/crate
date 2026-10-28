import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useTranslation } from "react-i18next";

import type { Track } from "@/contexts/PlayerContext";

import { QueueTrackRow } from "@/components/player/QueueTrackRow";

export function QueueTabUpcoming({
  tracks,
  currentIndex,
  locked,
  onJump,
  onRemove,
}: {
  tracks: Track[];
  currentIndex: number;
  locked: boolean;
  onJump: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation();
  if (!tracks.length) return null;

  return (
    <div className="mb-4">
      <MonoLabel as="p" className="mb-2 px-1">
        {t("player.queue.nextUp", { count: tracks.length })}
      </MonoLabel>
      {tracks.map((track, i) => {
        const index = currentIndex + 1 + i;
        return (
          <QueueTrackRow
            key={`next-${track.id}-${index}`}
            track={track}
            queueIndex={index}
            position={i + 1}
            onJump={onJump}
            onRemove={locked ? undefined : onRemove}
            locked={locked}
          />
        );
      })}
    </div>
  );
}
