import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useTranslation } from "react-i18next";

import type { Track } from "@/contexts/PlayerContext";

import { QueueTrackRow } from "@/components/player/QueueTrackRow";

export function QueueTabPastTracks({
  tracks,
  currentIndex,
  onJump,
  locked,
}: {
  tracks: Track[];
  currentIndex: number;
  onJump: (index: number) => void;
  locked: boolean;
}) {
  const { t } = useTranslation();
  if (!tracks.length) return null;

  return (
    <div className="mb-4">
      <MonoLabel as="p" className="mb-2 px-1">
        {t("player.queue.previous")}
      </MonoLabel>
      {tracks.map((track, i) => {
        const realIdx = currentIndex - 1 - i;
        return (
          <QueueTrackRow
            key={`hist-${track.id}-${realIdx}`}
            track={track}
            queueIndex={realIdx}
            position={realIdx + 1}
            onJump={onJump}
            faded
            locked={locked}
          />
        );
      })}
    </div>
  );
}
