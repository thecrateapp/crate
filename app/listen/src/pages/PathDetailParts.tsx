import { useMemo, type RefObject } from "react";
import { CRATE_ICON_SIZE, MapPin } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import type { PlaySource } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import type { PathDetail, PathTrack } from "./paths-model";

export function PathRouteVisualization({
  path,
  activeStep,
  animate,
  onPlayFromStep,
}: {
  path: PathDetail;
  activeStep: number;
  animate: boolean;
  onPlayFromStep: (startIndex: number) => void;
}) {
  const nodeCount = path.tracks.length;
  const travelerPos = activeStep >= 0 ? activeStep : 0;
  const activeTrack = activeStep >= 0 ? path.tracks[activeStep] : undefined;

  return (
    <div className="mb-6 rounded-xl border border-text-primary/8 bg-surface-canvas/20 p-4">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-caps">
        <span className="flex items-center gap-1 text-accent-action/60">
          <MapPin size={CRATE_ICON_SIZE.nano} /> {path.origin.label}
        </span>
        <span className="flex items-center gap-1 text-accent-action/60">
          {path.destination.label} <MapPin size={CRATE_ICON_SIZE.nano} />
        </span>
      </div>

      <div className="relative py-5">
        <div className="relative mx-3">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-text-primary/8" />
          <div
            className={`path-progress-fill absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full ${
              animate ? "transition-[width] duration-[1200ms] ease-out" : ""
            }`}
            style={{
              width: `${(travelerPos / Math.max(1, nodeCount - 1)) * 100}%`,
            }}
          />
          <div className="relative flex items-center justify-between">
            {path.tracks.map((track, index) => {
              const isPast = index <= travelerPos;
              const isActive = index === activeStep;
              return (
                <button
                  key={track.step}
                  type="button"
                  onClick={() => onPlayFromStep(index)}
                  title={`${track.title} — ${track.artist}`}
                  className="group relative flex size-4 shrink-0 items-center justify-center"
                >
                  <div
                    className={`rounded-full transition-[width,height,background-color,box-shadow] duration-300 ${
                      isActive
                        ? "path-node-active h-3 w-3 bg-accent-action"
                        : isPast
                          ? "h-1.5 w-1.5 bg-accent-action/60"
                          : "h-1.5 w-1.5 bg-text-primary/20 group-hover:bg-text-primary/40"
                    }`}
                  />
                </button>
              );
            })}
          </div>
          <div
            className={`pointer-events-none absolute top-1/2 ${
              animate ? "transition-[left] duration-[1200ms] ease-out" : ""
            }`}
            style={{
              left: `${(travelerPos / Math.max(1, nodeCount - 1)) * 100}%`,
            }}
          >
            <div className="absolute -inset-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action/20 blur-md" />
            <div className="path-traveler-node size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-action" />
          </div>
        </div>
      </div>

      {activeTrack ? (
        <div className="border-y border-accent-action/20 bg-accent-action/5 p-3">
          <div className="flex items-center gap-3">
            {activeTrack.album_id ? (
              <CrateImage
                src={albumCoverApiUrl(
                  {
                    albumId: activeTrack.album_id,
                    albumEntityUid: activeTrack.album_entity_uid,
                    artistEntityUid: activeTrack.artist_entity_uid,
                  },
                  { size: 80 },
                )}
                alt=""
                className=" size-10 shrink-0 rounded-lg bg-text-primary/5 object-cover shadow-md"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text-primary">
                {activeTrack.title}
              </div>
              <div className="truncate text-xs text-text-primary/50">
                {activeTrack.artist}
                {activeTrack.album ? <> · {activeTrack.album}</> : null}
              </div>
            </div>
            <span className="font-mono text-xs tabular-nums text-accent-action/70">
              {activeStep + 1}/{nodeCount}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

export function PathTrackList({
  path,
  activeStep,
  activeTrackRef,
}: {
  path: PathDetail;
  activeStep: number;
  activeTrackRef: RefObject<HTMLDivElement | null>;
}) {
  const rows = useMemo(() => path.tracks.map(pathTrackRowData), [path.tracks]);
  const playSource = useMemo<PlaySource>(
    () => ({ type: "playlist", name: path.name, id: path.id }),
    [path.id, path.name],
  );

  return (
    <div className="space-y-1">
      {path.tracks.map((track, index) => (
        <div
          key={track.step}
          ref={index === activeStep ? activeTrackRef : null}
        >
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
