import { useMemo } from "react";

import { TrackRow } from "@/components/cards/TrackRow";
import type { PlaySource } from "@/contexts/PlayerContext";
import { toTrackRowData } from "@/lib/track-row-data";
import type { PathDetail } from "./paths-model";

export function PathTrackList({ path }: { path: PathDetail }) {
  const rows = useMemo(() => path.tracks.map(toTrackRowData), [path.tracks]);
  const playSource = useMemo<PlaySource>(
    () => ({ type: "playlist", name: path.name, id: path.id }),
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
            queueTracks={rows}
            playSource={playSource}
          />
        </div>
      ))}
    </div>
  );
}
