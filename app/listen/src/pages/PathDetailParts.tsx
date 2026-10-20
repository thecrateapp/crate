import { useMemo } from "react";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import type { PlaySource } from "@/contexts/PlayerContext";
import type { PathDetail, PathTrack } from "./paths-model";

function pathTrackRowData(track: PathTrack): TrackRowData {
  return {
    id: track.track_id,
    library_track_id: track.track_id,
    entity_uid: track.entity_uid,
    title: track.title,
    artist: track.artist,
    artist_entity_uid: track.artist_entity_uid,
    album: track.album,
    album_id: track.album_id,
    album_entity_uid: track.album_entity_uid,
    bpm: track.bpm,
    audio_key: track.audio_key,
    audio_scale: track.audio_scale,
    energy: track.energy,
    danceability: track.danceability,
    valence: track.valence,
    bliss_vector: track.bliss_vector,
  };
}

export function PathTrackList({ path }: { path: PathDetail }) {
  const rows = useMemo(() => path.tracks.map(pathTrackRowData), [path.tracks]);
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
            showDuration={false}
            queueTracks={rows}
            playSource={playSource}
            meta={track.distance.toFixed(3)}
          />
        </div>
      ))}
    </div>
  );
}
