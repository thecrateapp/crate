import { useMemo } from "react";

import { TrackRow } from "@/components/cards/TrackRow";
import { createPathPlaySource } from "@/components/player/player-source";
import { useTranslation } from "react-i18next";
import { toTrackRowData } from "@/lib/track-row-data";
import type { PathDetail } from "./paths-model";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { getPathPlayback } from "./path-playback";

export function PathTrackList({ path }: { path: PathDetail }) {
  const { t } = useTranslation();
  const { playAll, playSource: currentSource } = usePlayerActions();
  const isCurrentPath =
    currentSource?.type === "path" &&
    String(currentSource.id) === String(path.id);
  const rows = useMemo(
    () =>
      path.tracks.map((track) =>
        toTrackRowData({ ...track, disabled: track.playable === false }),
      ),
    [path.tracks],
  );
  const playSource = useMemo(
    () => createPathPlaySource(path),
    [path.id, path.name],
  );

  return (
    <div className="space-y-1">
      {path.tracks.map((track, index) => (
        <div key={track.step}>
          <TrackRow
            track={rows[index]!}
            rank={index + 1}
            showCoverThumb
            showArtist
            showAlbum
            playSource={playSource}
            isActiveOverride={isCurrentPath ? undefined : false}
            onPlayOverride={() => {
              const playback = getPathPlayback(path, index);
              if (playback)
                playAll(playback.tracks, playback.index, playback.source);
            }}
            disabledLabel={
              track.playable === false
                ? t("paths.warnings.trackUnavailable")
                : undefined
            }
          />
        </div>
      ))}
    </div>
  );
}
