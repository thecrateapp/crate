import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";
import {
  usePlayerActions,
  usePlayerProgress,
  usePlayerState,
} from "@/contexts/PlayerContext";
import { useOffline } from "@/contexts/OfflineContext";
import {
  buildOfflineLibraryGroups,
  type OfflineLibraryGroup,
} from "@/pages/offline-library-model";
import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { TrackRowPlaybackProgressView } from "@/components/cards/TrackRowPlaybackControl";
import { OfflineLibraryView } from "./OfflineLibraryView";

function sourceForGroup({ item }: OfflineLibraryGroup) {
  return {
    type:
      item.kind === "album"
        ? ("album" as const)
        : item.kind === "playlist"
          ? ("playlist" as const)
          : ("track" as const),
    name: item.title,
    id: item.entityId,
  };
}
/** Only this small leaf and the active ring subscribe to the clock. */
function OfflineProgress({
  durationFallback,
  onSeek,
  disabled,
}: {
  durationFallback: number;
  onSeek: (time: number) => void;
  disabled: boolean;
}) {
  const { currentTime, duration } = usePlayerProgress();
  return (
    <PlayerSeekBar
      currentTime={currentTime}
      duration={Math.max(duration, durationFallback)}
      onSeek={onSeek}
      disabled={disabled}
      thin
      variant="glow"
      showTimes
    />
  );
}
function OfflineActiveRing({ isPlaying }: { isPlaying: boolean }) {
  const { currentTime, duration } = usePlayerProgress();
  return (
    <TrackRowPlaybackProgressView
      currentTime={currentTime}
      duration={duration}
      isPlaying={isPlaying}
    />
  );
}
export function OfflineLibrary() {
  const { items } = useOffline();
  const { playAll, currentTrack, pause, resume, next, prev, seek } =
    usePlayerActions();
  const { isPlaying, isBuffering } = usePlayerState();
  const groups = buildOfflineLibraryGroups(items);
  return (
    <OfflineLibraryView
      renderImage={(image) => (
        <ArtworkSurface
          source={image.src}
          alt={image.alt}
          className={image.className}
          fallback={image.fallback}
          imageProps={{ onError: image.onError }}
        />
      )}
      groups={groups.map((group) => ({
        key: `${group.item.kind}:${group.item.entityId}`,
        title: group.item.title,
        tracks: group.tracks,
      }))}
      currentTrack={currentTrack}
      isPlaying={isPlaying}
      isBuffering={isBuffering}
      onPlay={(group, track) => {
        const selected = groups[group];
        if (selected) playAll(selected.tracks, track, sourceForGroup(selected));
      }}
      onPause={pause}
      onResume={resume}
      onPrevious={prev}
      onNext={next}
      activeGlyph={<OfflineActiveRing isPlaying={isPlaying} />}
      progress={
        <OfflineProgress
          durationFallback={currentTrack?.duration ?? 0}
          onSeek={seek}
          disabled={!currentTrack || isBuffering}
        />
      }
    />
  );
}
