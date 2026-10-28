import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  MediaCover,
  type MediaCoverProps,
} from "@crate/ui/domain/media/MediaCover";
import {
  formatTrackAnalysis,
  formatMusicalKey,
} from "@crate/ui/lib/track-meta";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { TrackRowView } from "../../cards/TrackRowView";
import { TrackRowContent } from "../../cards/TrackRowContent";
import { TrackRowPlaybackControl } from "../../cards/TrackRowPlaybackControl";
import {
  formatPlayerTime,
  getQualityBadge,
} from "../../player/bar/player-bar-utils";
import type { StatsRangeTrack } from "../stats-types";

/** Context-free composition of the same row pieces used by the runtime TrackRow.
 * The adapter injects the full controller (menus, likes and active playback). */
export function StatsRangeTrackView({
  track,
  cover,
  renderImage,
  withAlbum,
  onPlay,
  actions,
}: {
  track: StatsRangeTrack;
  cover: string | null;
  renderImage?: MediaCoverProps["renderImage"];
  withAlbum: boolean;
  onPlay: () => void;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const disabled = track.track_id == null;
  return (
    <TrackRowView
      role="group"
      aria-label={track.title ?? ""}
      disabled={disabled}
      density="compact"
    >
      <TrackRowContent
        leading={
          <TrackRowPlaybackControl
            disabled={disabled}
            index=""
            isActive={false}
            isPlaying={false}
            label={t("trackRow.playLabel", { title: track.title })}
            onClick={onPlay}
            artwork={
              <MediaCover
                src={cover}
                alt=""
                renderImage={renderImage}
                size={48}
              />
            }
          />
        }
        title={track.title ?? ""}
        details={
          <p className="m-0 truncate text-xs text-text-secondary">
            {[track.artist, withAlbum ? track.album : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        }
        meta={
          <MonoLabel>
            {t("stats.explorer.plays", { count: track.plays })}
          </MonoLabel>
        }
        quality={getQualityBadge({
          format: track.format,
          path: track.track_path,
          bitDepth: track.bit_depth,
          sampleRate: track.sample_rate,
          bitrate: track.bitrate,
        })}
        tempo={formatTrackAnalysis(track.bpm)}
        musicalKey={formatMusicalKey(track.audio_key, track.audio_scale)}
        duration={
          track.duration != null && track.duration > 0
            ? formatPlayerTime(track.duration)
            : undefined
        }
        actions={actions}
      />
    </TrackRowView>
  );
}
